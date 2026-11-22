# Gun firmware (ESP32-S3 Super Mini)

## Wiring (no solder: jumper pins pushed into the holes and taped)

| Button  | One leg  | Diagonal leg |
|---------|----------|--------------|
| Trigger | hole 4   | hole G (GND) |
| Reload  | hole 9   | hole 13 (firmware holds it low as a second GND) |

Pins are set in `include/config.h`.

## Flash

```sh
python3 -m venv ~/pio && ~/pio/bin/pip install platformio      # once
cp include/config.example.h include/config.h                   # once; set Wi-Fi + laptop IP
~/pio/bin/pio run -t upload                                    # board plugged in by USB
~/pio/bin/pio device monitor                                   # see what it is doing
```

If upload can't find the board: hold BOOT, plug in, release, retry.
`platformio.ini` also has an `esp32-c3` env for C3 boards.

## Wi-Fi

2.4 GHz only. iPhone hotspot: turn on Maximise Compatibility, and keep the
Personal Hotspot screen open while the gun boots (the iPhone only advertises
itself there). Once joined it stays joined. Eduroam does not work.

The Mac may take only IPv6 on an iPhone hotspot. Give it a manual IPv4
address for that network (e.g. 172.20.10.5, mask 255.255.255.240, router
172.20.10.1) and put that address in `SERVER_HOST`.

## Pair

Lobby → "Pair gun" → pull the trigger within 10 s.
