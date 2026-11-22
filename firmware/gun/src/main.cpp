// Two buttons -> game server. Sends {"t":"hello","gun_id":...} on connect, then
// {"t":"btn","b":"trigger"|"reload","down":true|false} on every change.
//
// Nothing about the network is built in:
// - Wi-Fi is set from a phone. With no saved network, or with reload held at
//   power-on, the gun opens its own network "LOONIE-gun-xxxxxx" with a setup page.
// - The server is found over UDP (backend/app/discovery.py) unless a
//   server was typed into the setup page.
#include <Arduino.h>
#include <WiFi.h>
#include <esp_mac.h>
#include <WiFiUdp.h>
#include <WiFiManager.h>
#include <Preferences.h>
#include <WebSocketsClient.h>
#if __has_include("config.h")
#include "config.h"            // optional: pin overrides, or a first-boot Wi-Fi for development
#endif

#ifndef PIN_TRIGGER
#define PIN_TRIGGER 4
#endif
#ifndef PIN_RELOAD
#define PIN_RELOAD 9
#endif
#ifndef PIN_RELOAD_GND
#define PIN_RELOAD_GND 13      // held low as a second GND for the reload button
#endif
#ifndef SERVER_PORT
#define SERVER_PORT 8000       // used when a typed-in server has no ":port"
#endif

static const uint32_t DEBOUNCE_MS = 12;
static const uint16_t DISCOVERY_PORT = 8001;
static const uint32_t PROBE_EVERY_MS = 2000;
static const uint32_t REDISCOVER_AFTER_MS = 15000;   // server unreachable this long: look again
static const uint32_t PORTAL_TIMEOUT_S = 300;

// Wi-Fi modem sleep: the radio naps between the hotspot's beacons. Sends (the
// buttons) still go out at once; only messages *to* the gun wait for a beacon.
// 0 = off, 1 = wake for every hotspot beacon, 2 = sleep across several beacons.
#ifndef GUN_POWER_SAVE
#define GUN_POWER_SAVE 2
#endif

// Transmit power follows the signal: just enough to reach the hotspot. RSSI is
// what we hear from it; the link is roughly symmetric, so if we hear it at R dBm
// and it transmits at ~17 dBm, the path loses ~17-R dB and we need about
// (17-R) - 70 dBm (+ margin) to land at a solid -70 dBm on its side.
static const wifi_power_t TX_LEVELS[] = {WIFI_POWER_2dBm, WIFI_POWER_5dBm, WIFI_POWER_8_5dBm,
                                         WIFI_POWER_11dBm, WIFI_POWER_13dBm, WIFI_POWER_15dBm,
                                         WIFI_POWER_17dBm, WIFI_POWER_19_5dBm};
static const float TX_DBM[] = {2, 5, 8.5, 11, 13, 15, 17, 19.5};
static const int TX_MAX = sizeof TX_DBM / sizeof TX_DBM[0] - 1;
static int txIdx = TX_MAX;                 // join at full power, then settle
static uint32_t txHoldUntil = 0;           // after a drop, don't lower for a while
static float rssiAvg = 0;

static void setTx(int idx) {
  idx = constrain(idx, 0, TX_MAX);
  if (idx != txIdx) Serial.printf("tx: %.1f -> %.1f dBm (rssi %.0f)\n", TX_DBM[txIdx], TX_DBM[idx], rssiAvg);
  txIdx = idx;
  WiFi.setTxPower(TX_LEVELS[idx]);
}

static void adaptTx(uint32_t now) {
  static uint32_t last = 0;
  if (now - last < 2000) return;
  last = now;
  int r = WiFi.RSSI();
  if (r == 0) return;                                     // no reading yet
  // With power save on, RSSI swings ~10 dB between beacons: smooth hard, and
  // only lower with real headroom and not more often than every 10 s.
  rssiAvg = rssiAvg == 0 ? r : rssiAvg * 0.85f + r * 0.15f;
  float need = (17 - rssiAvg) - 70 + 3;
  static uint32_t lastLower = 0;
  int want = 0;
  while (want < TX_MAX && TX_DBM[want] < need) want++;
  if (want > txIdx) setTx(want);                          // raise at once
  else if (want < txIdx && now > txHoldUntil && now - lastLower > 10000 && TX_DBM[txIdx] - need > 6) {
    setTx(txIdx - 1);                                     // lower one step at a time
    lastLower = now;
  }
}

// Round trip to the server, for checking what power saving costs.
static uint32_t pingSentAt = 0, rttMs = 0;

struct Button {
  uint8_t pin;
  const char* name;
  bool down;              // debounced state
  bool lastRaw;
  uint32_t changedAt;
};

static Button buttons[] = {
  {PIN_TRIGGER, "trigger", false, false, 0},
  {PIN_RELOAD,  "reload",  false, false, 0},
};

static WebSocketsClient ws;
static WiFiUDP udp;
static Preferences prefs;
static String gunId;
static String fixedServer;         // from the setup page; empty = discover
static bool online = false;
static bool haveTarget = false;    // ws.begin() has been called for the current server
static uint32_t offlineSince = 0;

static void sendBtn(const Button& b) {
  if (!online) return;
  String msg = String("{\"t\":\"btn\",\"b\":\"") + b.name + "\",\"down\":" + (b.down ? "true" : "false") + "}";
  ws.sendTXT(msg);
}

static void onEvent(WStype_t type, uint8_t* payload, size_t len) {
  switch (type) {
    case WStype_CONNECTED: {
      online = true;
      ws.sendTXT(String("{\"t\":\"hello\",\"gun_id\":\"") + gunId + "\"}");
      Serial.println("server: connected");
      for (auto& b : buttons) if (b.down) sendBtn(b);     // held through a reconnect
      break;
    }
    case WStype_PONG:
      if (len == 3 && memcmp(payload, "rtt", 3) == 0 && pingSentAt) { rttMs = millis() - pingSentAt; pingSentAt = 0; }
      break;
    case WStype_DISCONNECTED:
      if (online) {
        offlineSince = millis();
        setTx(txIdx + 2);                                 // maybe we were too quiet; hold it up for a while
        txHoldUntil = millis() + 30000;
      }
      online = false;
      Serial.println("server: disconnected");
      break;
    case WStype_TEXT:
      Serial.printf("server: %.*s\n", (int)len, (const char*)payload);   // "paired" / "unpaired"
      break;
    default: break;
  }
}

static void connectTo(const String& host, uint16_t port) {
  Serial.printf("server: trying %s:%u\n", host.c_str(), port);
  ws.disconnect();
  ws.begin(host, port, "/device");
  haveTarget = true;
  offlineSince = millis();
}

static void useFixedServer() {
  String host = fixedServer;
  uint16_t port = SERVER_PORT;
  int colon = host.lastIndexOf(':');
  if (colon > 0) { port = host.substring(colon + 1).toInt(); host = host.substring(0, colon); }
  connectTo(host, port);
}

static void probe(IPAddress to) {
  udp.beginPacket(to, DISCOVERY_PORT);
  udp.print("LOONIE?");
  udp.endPacket();
}

// Send "LOONIE?" and take the first "LOONIE <port>" reply. Broadcast first;
// iPhone hotspots don't pass broadcast between clients, so also walk the
// subnet one address at a time (a hotspot /28 is 14 hosts, a home /24 is 254).
static void discover(uint32_t now) {
  // One round every PROBE_EVERY_MS: two broadcasts, then one pass over the
  // subnet. Between rounds the radio can rest.
  static uint32_t lastRound = 0, lastUnicast = 0, sweepHost = 0;
  static bool sweeping = false;
  if (!sweeping && now - lastRound >= PROBE_EVERY_MS) {
    lastRound = now;
    probe(WiFi.broadcastIP());
    probe(IPAddress(255, 255, 255, 255));
    sweeping = true;
    sweepHost = 0;
  }
  uint32_t mask = (uint32_t)WiFi.subnetMask(), self = (uint32_t)WiFi.localIP();  // network byte order
  uint32_t hosts = ~ntohl(mask);                          // e.g. 15 for /28
  if (sweeping && now - lastUnicast >= 20) {               // paced so ARP keeps up
    lastUnicast = now;
    if (hosts < 2 || hosts > 1023 || ++sweepHost >= hosts) {   // too big to walk, or done
      sweeping = false;
      lastRound = now;
    } else {
      uint32_t ip = htonl((ntohl(self) & ntohl(mask)) | sweepHost);
      if (ip != self) probe(IPAddress(ip));
    }
  }
  int n = udp.parsePacket();
  if (n <= 0) return;
  char buf[32] = {};
  udp.read(buf, sizeof buf - 1);
  int port = 0;
  if (sscanf(buf, "LOONIE %d", &port) == 1 && port > 0 && port < 65536) {
    Serial.printf("server: found at %s\n", udp.remoteIP().toString().c_str());
    connectTo(udp.remoteIP().toString(), port);
  }
}

// Blocks until the setup page is saved (or times out), then reboots.
static void runSetupPortal() {
  String ap = "LOONIE-" + gunId;
  Serial.printf("setup: join Wi-Fi [%s] on a phone; the setup page opens (or go to 192.168.4.1)\n", ap.c_str());
  WiFiManager wm;
  WiFiManagerParameter server("server", "Game server (leave blank to find it automatically)",
                              fixedServer.c_str(), 63);
  wm.addParameter(&server);
  wm.setTitle("LOONIE gun");
  wm.setBreakAfterConfig(true);           // save even if the network is out of reach right now
  wm.setConfigPortalTimeout(PORTAL_TIMEOUT_S);
  bool saved = false;
  wm.setSaveConfigCallback([&saved]() { saved = true; });
  wm.startConfigPortal(ap.c_str());
  if (saved) {
    String s = server.getValue();
    s.trim();
    prefs.putString("server", s);
    Serial.printf("setup: saved wifi [%s], server [%s]\n", wm.getWiFiSSID(true).c_str(),
                  s.length() ? s.c_str() : "auto");
  } else {
    Serial.println("setup: timed out");
  }
  ESP.restart();
}

void setup() {
  setCpuFrequencyMhz(80);                                 // plenty for two buttons; Wi-Fi needs >= 80
  Serial.begin(115200);
  for (auto& b : buttons) pinMode(b.pin, INPUT_PULLUP);
  pinMode(PIN_RELOAD_GND, OUTPUT);
  digitalWrite(PIN_RELOAD_GND, LOW);

  WiFi.mode(WIFI_STA);
  uint8_t mac[6];
  esp_read_mac(mac, ESP_MAC_WIFI_STA);                    // from eFuse; WiFi.macAddress() is zeros until Wi-Fi starts
  char id[16];
  snprintf(id, sizeof id, "gun-%02x%02x%02x", mac[3], mac[4], mac[5]);
  gunId = id;

  delay(1500);                                            // let the USB serial come up
  Serial.printf("gun id: %s\n", id);

  prefs.begin("gun", false);
  fixedServer = prefs.getString("server", "");

  WiFiManager wm;
  bool saved = wm.getWiFiIsSaved();
#ifdef WIFI_SSID
  if (!saved) { WiFi.begin(WIFI_SSID, WIFI_PASS); saved = true; }    // dev default from config.h; stored like a setup-page save
#endif
  bool reloadHeld = digitalRead(PIN_RELOAD) == LOW;
  if (!saved || reloadHeld) runSetupPortal();             // does not return

  static const wifi_ps_type_t PS_MODES[] = {WIFI_PS_NONE, WIFI_PS_MIN_MODEM, WIFI_PS_MAX_MODEM};
  WiFi.setSleep(PS_MODES[GUN_POWER_SAVE]);
  Serial.printf("wifi: joining [%s], power save %d\n", wm.getWiFiSSID(true).c_str(), GUN_POWER_SAVE);
  WiFi.begin();                                           // the saved network
  setTx(TX_MAX);
  Serial.printf("udp: listening on %u: %s\n", DISCOVERY_PORT + 1, udp.begin(DISCOVERY_PORT + 1) ? "ok" : "FAILED");

  ws.onEvent(onEvent);
  ws.setReconnectInterval(2000);
  ws.enableHeartbeat(10000, 3000, 2);
  Serial.printf("server: %s\n", fixedServer.length() ? fixedServer.c_str() : "auto (discovery)");
}

void loop() {
  uint32_t now = millis();
  static uint32_t lastWifiLog = 0;
  static wl_status_t lastStatus = WL_IDLE_STATUS;
  wl_status_t st = WiFi.status();
  bool joined = st == WL_CONNECTED, wasJoined = lastStatus == WL_CONNECTED;
  if (joined != wasJoined || (!joined && now - lastWifiLog > 5000)) {
    if (!joined && wasJoined) { setTx(TX_MAX); rssiAvg = 0; }       // lost the hotspot: rejoin loud
    lastStatus = st; lastWifiLog = now;
    if (st == WL_CONNECTED) Serial.printf("wifi: connected, ip %s\n", WiFi.localIP().toString().c_str());
    else Serial.printf("wifi: not connected (status %d)\n", (int)st);
  }
  // Still not on Wi-Fi after a while: try again. A full scan is heavy on the
  // radio, so only list what is in range on the first retry and every 5 min.
  static uint32_t lastRetry = 0, lastList = 0;
  static bool listed = false;
  if (!joined && now - lastRetry > 30000) {               // long enough for a join to finish
    lastRetry = now;
    WiFi.disconnect();
    if (!listed || now - lastList > 300000) {
      listed = true; lastList = now;
      int n = WiFi.scanNetworks();
      Serial.printf("wifi: %d networks in range\n", n);
      for (int i = 0; i < n; i++) Serial.printf("  [%s] %d dBm ch %d\n", WiFi.SSID(i).c_str(), WiFi.RSSI(i), WiFi.channel(i));
    }
    WiFi.begin();
  }

  if (joined) {
    adaptTx(now);
    if (!haveTarget) {
      if (fixedServer.length()) useFixedServer();
      else discover(now);
    } else if (!online && !fixedServer.length() && now - offlineSince > REDISCOVER_AFTER_MS) {
      Serial.println("server: not reachable, looking again");
      ws.disconnect();
      haveTarget = false;                                 // the host may have changed IP or laptop
    }
  }
  if (haveTarget) ws.loop();                              // reconnects on its own once Wi-Fi is up

  static uint32_t lastTemp = 0;
  if (now - lastTemp > 10000) {
    lastTemp = now;
    Serial.printf("temp: %.1f C  rssi %d dBm  tx %.1f dBm  rtt %u ms\n", temperatureRead(), (int)WiFi.RSSI(), TX_DBM[txIdx], rttMs);
  }
  static uint32_t lastPing = 0;
  if (online && now - lastPing > 10000) { lastPing = now; pingSentAt = now; ws.sendPing((uint8_t*)"rtt", 3); }
  for (auto& b : buttons) {
    bool raw = digitalRead(b.pin) == LOW;                 // pressed pulls the pin to ground
    if (raw != b.lastRaw) { b.lastRaw = raw; b.changedAt = now; }
    if (raw != b.down && now - b.changedAt >= DEBOUNCE_MS) {
      b.down = raw;
      Serial.printf("%s %s\n", b.name, raw ? "down" : "up");
      sendBtn(b);
    }
  }
  delay(1);                                               // let the CPU idle between polls
}
