// Two buttons -> game server. Sends {"t":"hello","gun_id":...} on connect, then
// {"t":"btn","b":"trigger"|"reload","down":true|false} on every change.
//
// Nothing about the network is built in:
// - Wi-Fi is set from a phone. With no saved network, or with reload held at
//   power-on, the gun opens its own network "LOONIE-gun-xxxxxx" with a setup page.
// - The server is found by UDP broadcast (backend/app/discovery.py) unless a
//   server was typed into the setup page.
#include <Arduino.h>
#include <WiFi.h>
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
    case WStype_DISCONNECTED:
      if (online) offlineSince = millis();
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

// Broadcast "LOONIE?" and take the first "LOONIE <port>" reply.
static void discover(uint32_t now) {
  static uint32_t lastProbe = 0;
  if (now - lastProbe >= PROBE_EVERY_MS) {
    lastProbe = now;
    for (IPAddress to : {WiFi.broadcastIP(), IPAddress(255, 255, 255, 255)}) {
      udp.beginPacket(to, DISCOVERY_PORT);
      udp.print("LOONIE?");
      udp.endPacket();
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
  WiFi.macAddress(mac);
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

  WiFi.setSleep(false);                                   // lower latency
  Serial.printf("wifi: joining [%s]\n", wm.getWiFiSSID(true).c_str());
  WiFi.begin();                                           // the saved network
  WiFi.setTxPower(WIFI_POWER_8_5dBm);                     // the hotspot phone is within arm's reach; full power only makes heat
  udp.begin(0);

  ws.onEvent(onEvent);
  ws.setReconnectInterval(2000);
  ws.enableHeartbeat(10000, 3000, 2);
  Serial.printf("server: %s\n", fixedServer.length() ? fixedServer.c_str() : "auto (broadcast)");
}

void loop() {
  uint32_t now = millis();
  static uint32_t lastWifiLog = 0;
  static wl_status_t lastStatus = WL_IDLE_STATUS;
  wl_status_t st = WiFi.status();
  bool joined = st == WL_CONNECTED, wasJoined = lastStatus == WL_CONNECTED;
  if (joined != wasJoined || (!joined && now - lastWifiLog > 5000)) {
    lastStatus = st; lastWifiLog = now;
    if (st == WL_CONNECTED) Serial.printf("wifi: connected, ip %s\n", WiFi.localIP().toString().c_str());
    else Serial.printf("wifi: not connected (status %d)\n", (int)st);
  }
  // Still not on Wi-Fi after a while: list what is in range, then try again.
  static uint32_t lastScan = 0;
  if (!joined && now - lastScan > 30000) {                // long enough for a join to finish
    lastScan = now;
    WiFi.disconnect();
    int n = WiFi.scanNetworks();
    Serial.printf("wifi: %d networks in range\n", n);
    for (int i = 0; i < n; i++) Serial.printf("  [%s] %d dBm ch %d\n", WiFi.SSID(i).c_str(), WiFi.RSSI(i), WiFi.channel(i));
    WiFi.begin();
  }

  if (joined) {
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
  if (now - lastTemp > 10000) { lastTemp = now; Serial.printf("temp: %.1f C  rssi %d dBm\n", temperatureRead(), (int)WiFi.RSSI()); }
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
