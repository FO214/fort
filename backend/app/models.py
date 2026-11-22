"""Wire protocol and loadouts. Every message is a JSON object with a `t`
(type) field; the rest of the shape is documented per model."""
from __future__ import annotations

import os
from typing import Literal, Optional

from pydantic import BaseModel, Field


# --------------------------------------------------------------------- classes

class GunClass(BaseModel):
    id: str
    name: str
    damage: int
    fire_interval_s: float
    magazine: int
    reload_s: float
    spread_deg: float        # aim forgiveness added to the zombie's angular size
    range_m: float
    automatic: bool
    hp: int                  # the player's health with this loadout


CLASSES: dict[str, GunClass] = {
    "light": GunClass(id="light", name="Light", damage=1, fire_interval_s=0.12, magazine=24,
                      reload_s=2.2, spread_deg=3.0, range_m=25, automatic=True, hp=6),
    "regular": GunClass(id="regular", name="Regular", damage=2, fire_interval_s=0.4, magazine=10,
                        reload_s=2.6, spread_deg=2.0, range_m=35, automatic=False, hp=8),
    "heavy": GunClass(id="heavy", name="Heavy", damage=4, fire_interval_s=0.9, magazine=5,
                      reload_s=3.4, spread_deg=1.0, range_m=50, automatic=False, hp=10),
}
DEFAULT_CLASS = "regular"


# --------------------------------------------------------------------- settings

def default_map() -> str:
    """The map a new squad gets. Set LOONIE_DEFAULT_MAP on the server to start
    every lobby on the building instead of the open arena."""
    return os.environ.get("LOONIE_DEFAULT_MAP", "arena")


class Settings(BaseModel):
    max_players: int = Field(4, ge=1, le=4)
    map: str = Field(default_factory=default_map, pattern=r"^[a-z0-9_-]{1,32}$")


# ----------------------------------------------------------- phone -> server

class Create(BaseModel):
    t: Literal["create"]
    name: str = Field(min_length=1, max_length=20)
    settings: Settings = Settings()


class Join(BaseModel):
    t: Literal["join"]
    code: str = Field(min_length=4, max_length=4)
    name: str = Field(min_length=1, max_length=20)


class Resume(BaseModel):
    t: Literal["resume"]
    code: str
    player_id: str
    token: str


class Ready(BaseModel):
    t: Literal["ready"]
    ready: bool


class SetClass(BaseModel):
    t: Literal["set_class"]
    cls: str


class SetMap(BaseModel):
    """Host only, in the lobby: which map the mission is played on."""
    t: Literal["set_map"]
    map: str = Field(pattern=r"^[a-z0-9_-]{1,32}$")


class Start(BaseModel):
    """Host starts the mission. On a map with no fixed real-world origin (the
    open arena) the host's current GPS fix becomes the origin for everyone."""
    t: Literal["start"]
    lat: Optional[float] = Field(None, ge=-90, le=90)
    lon: Optional[float] = Field(None, ge=-180, le=180)


class Pos(BaseModel):
    """Where this phone thinks it is, in map metres, ~8 Hz."""
    t: Literal["pos"]
    x: float = Field(ge=-5000, le=5000)
    y: float = Field(ge=-5000, le=5000)
    acc: float = Field(10.0, ge=0, le=500)       # horizontal accuracy, metres
    heading: float = 0.0                         # map heading the camera faces
    pitch: float = Field(0.0, ge=-90, le=90)     # camera elevation, degrees


class Fire(BaseModel):
    """One trigger pull. `hits` are the zombies the phone saw under its
    crosshair, nearest first; `heading` is where the gun pointed."""
    t: Literal["fire"]
    seq: int
    hits: list[int] = Field(default_factory=list, max_length=8)
    heading: float = 0.0


class Reload(BaseModel):
    t: Literal["reload"]


class Revive(BaseModel):
    """Hold (`on`) or release the Revive button for a knocked teammate."""
    t: Literal["revive"]
    target: str
    on: bool


class Extract(BaseModel):
    """`on` while this phone has the helicopter's QR code in view and the
    player is holding the screen."""
    t: Literal["extract"]
    on: bool


class Arrived(BaseModel):
    """Host only: "we're here", for when GPS will not admit it."""
    t: Literal["arrived"]


class PairGun(BaseModel):
    """Open a 10 s window: the first gun to pull its trigger becomes mine."""
    t: Literal["pair_gun"]


class Leave(BaseModel):
    t: Literal["leave"]


class Reset(BaseModel):
    """Host only. After a mission: back to the lobby. During one: abort it."""
    t: Literal["reset"]


class Ping(BaseModel):
    t: Literal["ping"]
    ts: float


# ------------------------------------------------------------- gun -> server

class DeviceHello(BaseModel):
    t: Literal["hello"]
    gun_id: str = Field(min_length=1, max_length=32, pattern=r"^[A-Za-z0-9_:-]+$")


class DeviceBtn(BaseModel):
    """A button went down or up on the gun."""
    t: Literal["btn"]
    b: Literal["trigger", "reload"]
    down: bool
