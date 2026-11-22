// Optional. Copy to config.h only to override something; the firmware builds without it.
// config.h is gitignored.
#pragma once

// Development shortcut: a Wi-Fi network to use on first boot, so you can skip the
// setup page. It is saved on the gun like a setup-page save. Players don't need this.
// #define WIFI_SSID   "your-2.4GHz-wifi-name"
// #define WIFI_PASS   "your-wifi-password"

// Port used when a server typed into the setup page has no ":port".
// #define SERVER_PORT 8000

// Button wiring (defaults shown): one leg to the GPIO, the other leg to GND.
// #define PIN_TRIGGER 4
// #define PIN_RELOAD  9
// #define PIN_RELOAD_GND 13   // held low so it works as a second GND for the reload button
