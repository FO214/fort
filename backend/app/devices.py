"""Gun pairing. A gun (ESP32) knows only its own id. A player taps "Pair gun"
on the phone, which opens a short window; the first gun to pull its trigger
inside that window is bound to that player. The binding lives in memory, so a
gun that reconnects (Wi-Fi blip, power cycle) is recognised straight away."""
from __future__ import annotations

from typing import Optional

PAIR_WINDOW_S = 10.0

Owner = tuple[str, str]          # (room code, player id)


class Devices:
    def __init__(self) -> None:
        self.bound: dict[str, Owner] = {}                 # gun id -> owner
        self.pairing: dict[Owner, float] = {}             # owner -> window closes at

    def start_pairing(self, owner: Owner, now: float) -> float:
        until = now + PAIR_WINDOW_S
        self.pairing[owner] = until
        return until

    def cancel_pairing(self, owner: Owner) -> None:
        self.pairing.pop(owner, None)

    def claim(self, gun_id: str, now: float) -> Optional[Owner]:
        """A gun just pulled its trigger. Bind it to whoever has been waiting
        longest, if anyone is. Returns the owner, or None."""
        for owner, until in list(self.pairing.items()):
            if until < now:
                del self.pairing[owner]
        if not self.pairing:
            return None
        owner = min(self.pairing, key=lambda o: self.pairing[o])
        del self.pairing[owner]
        # One gun per player: a newly paired gun replaces the old one.
        for gid, o in list(self.bound.items()):
            if o == owner:
                del self.bound[gid]
        self.bound[gun_id] = owner
        return owner

    def owner(self, gun_id: str) -> Optional[Owner]:
        return self.bound.get(gun_id)

    def gun_of(self, owner: Owner) -> Optional[str]:
        return next((g for g, o in self.bound.items() if o == owner), None)

    def forget_player(self, owner: Owner) -> None:
        self.pairing.pop(owner, None)
        for gid, o in list(self.bound.items()):
            if o == owner:
                del self.bound[gid]
