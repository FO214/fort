"""Wire protocol and game configuration. Every message is a JSON object
with a `t` (type) field; the rest of the shape is documented per model."""
from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, Field


# --------------------------------------------------------------------- weapons

class Weapon(BaseModel):
    id: str
    name: str
    damage: int
    fire_interval_s: float
    magazine: int
    reload_s: float
    cone_deg: float          # half-angle off boresight
    range_m: float
    automatic: bool
    acquire_ms: int          # how long the reticle must sit on a target to lock


WEAPONS: dict[str, Weapon] = {
    "light": Weapon(id="light", name="Light", damage=1, fire_interval_s=0.12, magazine=18,
                    reload_s=2.5, cone_deg=14, range_m=45, automatic=True, acquire_ms=250),
    "regular": Weapon(id="regular", name="Regular", damage=2, fire_interval_s=0.45, magazine=10,
                      reload_s=2.8, cone_deg=11, range_m=70, automatic=False, acquire_ms=400),
    "heavy": Weapon(id="heavy", name="Heavy", damage=3, fire_interval_s=1.0, magazine=5,
                    reload_s=4.0, cone_deg=8, range_m=110, automatic=False, acquire_ms=650),
}

WEAPON_HP: dict[str, int] = {"light": 6, "regular": 8, "heavy": 10}


# --------------------------------------------------------------------- settings

Mode = Literal["ffa", "teams"]
Aim = Literal["gps", "manual"]     # gps: bearing lock outdoors · manual: tap a target (indoors)


class Settings(BaseModel):
    mode: Mode = "ffa"
    aim: Aim = "gps"
    duration_s: int = Field(300, ge=60, le=1800)
    respawn_s: int = Field(6, ge=0, le=60)
    spawn_protect_s: float = Field(1.5, ge=0, le=10)
    max_players: int = Field(8, ge=2, le=32)


# ----------------------------------------------------------- client -> server

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


class SetTeam(BaseModel):
    t: Literal["set_team"]
    team: Literal["alpha", "bravo"]


class SetWeapon(BaseModel):
    t: Literal["set_weapon"]
    weapon: str


class UpdateSettings(BaseModel):
    t: Literal["settings"]
    settings: Settings


class Start(BaseModel):
    t: Literal["start"]


class Pos(BaseModel):
    t: Literal["pos"]
    lat: float
    lon: float
    acc: float = 10.0            # horizontal accuracy, metres (1σ-ish)
    heading: Optional[float] = None
    heading_acc: Optional[float] = None
    ts: float                    # client wall clock, unix seconds


class Fire(BaseModel):
    t: Literal["fire"]
    seq: int
    target_id: Optional[str] = None
    ts: float                    # client wall clock at trigger pull


class Reload(BaseModel):
    t: Literal["reload"]


class Leave(BaseModel):
    t: Literal["leave"]


class End(BaseModel):
    t: Literal["end"]


class Reset(BaseModel):
    """Host sends after a match to put the room back in the lobby."""
    t: Literal["reset"]


class Ping(BaseModel):
    t: Literal["ping"]
    ts: float
