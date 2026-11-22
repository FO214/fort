// Two buttons -> game server. Sends {"t":"hello","gun_id":...} on connect, then
// {"t":"btn","b":"trigger"|"reload","down":true|false} on every change.
#include <Arduino.h>
#include <WiFi.h>
#include <WebSocketsClient.h>
#include "config.h"

static const uint32_t DEBOUNCE_MS = 12;

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
static String gunId;
static bool online = false;

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
      online = false;
      Serial.println("server: disconnected");
      break;
    case WStype_TEXT:
      Serial.printf("server: %.*s\n", (int)len, (const char*)payload);   // "paired" / "unpaired"
      break;
    default: break;
  }
}

void setup() {
  Serial.begin(115200);
  for (auto& b : buttons) pinMode(b.pin, INPUT_PULLUP);
#ifdef PIN_RELOAD_GND
  pinMode(PIN_RELOAD_GND, OUTPUT);                        // a second ground for the reload button
  digitalWrite(PIN_RELOAD_GND, LOW);
#endif

  WiFi.mode(WIFI_STA);
  WiFi.setSleep(false);                                   // lower latency
  delay(1500);                                            // let the USB serial come up
  int n = WiFi.scanNetworks();
  Serial.printf("wifi: %d networks in range\n", n);
  for (int i = 0; i < n; i++) Serial.printf("  [%s] %d dBm\n", WiFi.SSID(i).c_str(), WiFi.RSSI(i));
  Serial.printf("wifi: joining [%s]\n", WIFI_SSID);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  uint8_t mac[6];
  WiFi.macAddress(mac);
  char id[16];
  snprintf(id, sizeof id, "gun-%02x%02x%02x", mac[3], mac[4], mac[5]);
  gunId = id;
  Serial.printf("gun id: %s\n", id);

  ws.begin(SERVER_HOST, SERVER_PORT, "/device");
  ws.onEvent(onEvent);
  ws.setReconnectInterval(2000);
  ws.enableHeartbeat(10000, 3000, 2);
}

void loop() {
  ws.loop();                                              // reconnects on its own once Wi-Fi is up
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
    WiFi.begin(WIFI_SSID, WIFI_PASS);
  }
#ifdef PIN_PROBE
  // Wiring check: report any exposed pin that gets pulled to GND.
  static const uint8_t probe[] = {1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13};
  static bool probeLow[sizeof probe] = {};
  static uint32_t lastAlive = 0;
  for (size_t i = 0; i < sizeof probe; i++) {
    if (now < 3000) pinMode(probe[i], INPUT_PULLUP);
    bool low = digitalRead(probe[i]) == LOW;
    if (low != probeLow[i]) { probeLow[i] = low; Serial.printf("probe: pin %d %s\n", probe[i], low ? "LOW" : "high"); }
  }
  if (now - lastAlive > 3000) { lastAlive = now; Serial.println("alive"); }
#endif
  for (auto& b : buttons) {
    bool raw = digitalRead(b.pin) == LOW;                 // pressed pulls the pin to ground
    if (raw != b.lastRaw) { b.lastRaw = raw; b.changedAt = now; }
    if (raw != b.down && now - b.changedAt >= DEBOUNCE_MS) {
      b.down = raw;
      Serial.printf("%s %s\n", b.name, raw ? "down" : "up");
      sendBtn(b);
    }
  }
}
