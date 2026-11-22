// Copy to config.h and fill in. config.h is gitignored.
#pragma once

#define WIFI_SSID   "your-2.4GHz-wifi-name"
#define WIFI_PASS   "your-wifi-password"

// The laptop running the backend (same Wi-Fi). Its IP changes between networks.
#define SERVER_HOST "172.20.10.5"
#define SERVER_PORT 8000

// Button wiring: one leg to the GPIO, the other leg to GND.
#define PIN_TRIGGER 4
#define PIN_RELOAD  9

// The board has one GND hole. This pin is held low so it works as a second GND:
// the reload button goes between PIN_RELOAD and this pin. Comment out to use GND.
#define PIN_RELOAD_GND 13
