# Gun firmware (ESP32-S3 Super Mini)

## Wiring (no solder: jumper pins pushed into the holes and taped)

| Button  | One leg  | Diagonal leg |
|---------|----------|--------------|
| Trigger | hole 4   | hole G (GND) |
| Reload  | hole 9   | hole 13 (firmware holds it low as a second GND) |

Pins can be overridden in `include/config.h` (see `config.example.h`).

## Flash

Every gun gets the same build; nothing network-specific is compiled in.

```sh
python3 -m venv ~/pio && ~/pio/bin/pip install platformio      # once
~/pio/bin/pio run -t upload                                    # board plugged in by USB
~/pio/bin/pio device monitor                                   # see what it is doing
```

If upload can't find the board: hold BOOT, plug in, release, retry.
`platformio.ini` also has an `esp32-c3` env for C3 boards.

## Set up Wi-Fi (once per network, no reflash)

1. Power the gun **with reload held down** (a new gun opens setup by itself).
2. On any phone, join the Wi-Fi network `LOONIE-gun-xxxxxx`. The setup page
   opens; if not, browse to `192.168.4.1`.
3. Tap **Configure WiFi**, pick the network the game will run on, type its
   password, and save. Leave **Game server** blank.
4. The gun restarts, joins that network and finds the server by itself.

The gun remembers the network through power cycles. To move to another
hotspot, repeat with reload held.

Don't use the hotspot phone itself for step 2: an iPhone turns its hotspot
off while it is joined to another Wi-Fi network.

## Finding the server

The gun broadcasts `LOONIE?` on UDP 8001 and the backend replies with its
WebSocket port, so whichever laptop runs the backend on that network is found
automatically. If the server can't be reached for 15 s, the gun looks again
(say the host laptop changed).

If broadcast doesn't get through (some routers and guest networks block it),
type the server into **Game server** on the setup page, as `192.168.1.50` or
`192.168.1.50:8000`. A typed server is used as-is with no searching. Clear the
field to go back to automatic.

On macOS the firewall may ask to allow incoming connections for Python the
first time the backend starts. Allow it, or guns won't find the server.

## Wi-Fi notes

2.4 GHz only, no login pages (eduroam and captive-portal guest Wi-Fi don't work).

iPhone hotspot: turn on Maximise Compatibility, and keep the Personal Hotspot
screen open while the gun joins (the iPhone only advertises itself there).
Once joined it stays joined.

The Mac may take only IPv6 on an iPhone hotspot. Give it a manual IPv4
address for that network (e.g. 172.20.10.5, mask 255.255.255.240, router
172.20.10.1), or guns can't reach it.

## Pair

Lobby → "Pair gun" → pull the trigger within 10 s.

## A button does nothing

Watch the log while pressing it (`~/pio/bin/pio device monitor`). A working
press prints `trigger down` / `reload down`. If nothing prints, flash the
wiring check, which reports every exposed pin that gets pulled to ground:

```sh
PLATFORMIO_BUILD_FLAGS=-DPIN_PROBE ~/pio/bin/pio run -t upload
```

Press the button and look for `probe: pin N LOW`. No line at all means the
circuit isn't closing (usually a jumper that lost contact, or two button legs
on the same side, which are always connected). A different pin means it is
wired to the wrong hole. Flash the normal build again afterwards.
