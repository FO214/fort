"""Gun pairing and button relay."""
import json

import pytest
import websockets

from app.devices import PAIR_WINDOW_S, Devices
from tests.test_ws_e2e import connect, server, squad  # noqa: F401  (server is a fixture)


def test_claim_needs_an_open_window():
    d = Devices()
    assert d.claim("g1", 0) is None
    d.start_pairing(("ABCD", "p1"), 0)
    assert d.claim("g1", PAIR_WINDOW_S + 1) is None          # window closed
    d.start_pairing(("ABCD", "p1"), 100)
    assert d.claim("g1", 101) == ("ABCD", "p1")
    assert d.owner("g1") == ("ABCD", "p1")
    assert d.claim("g2", 102) is None                        # window is used up


def test_longest_waiting_player_gets_the_gun_and_new_gun_replaces_old():
    d = Devices()
    d.start_pairing(("R", "a"), 0)
    d.start_pairing(("R", "b"), 1)
    assert d.claim("g1", 2) == ("R", "a")
    assert d.claim("g2", 3) == ("R", "b")
    d.start_pairing(("R", "a"), 4)
    assert d.claim("g3", 5) == ("R", "a")
    assert d.owner("g1") is None and d.owner("g3") == ("R", "a")


async def gun(url, gun_id):
    ws = await websockets.connect(url.replace("/ws", "/device"), max_queue=None)
    await ws.send(json.dumps({"t": "hello", "gun_id": gun_id}))
    return ws


async def recv(ws):
    import asyncio
    return json.loads(await asyncio.wait_for(ws.recv(), 3))


async def test_pair_then_relay_buttons(server):  # noqa: F811
    (host,), _ = await squad(server, ["Ann"])
    g = await gun(server, "gun-1")
    assert (await recv(g))["t"] == "unpaired"

    # Pulling the trigger with nobody pairing does nothing.
    await g.send(json.dumps({"t": "btn", "b": "trigger", "down": True}))
    await g.send(json.dumps({"t": "btn", "b": "trigger", "down": False}))

    await host.send(t="pair_gun")
    await host.until("pairing")
    await g.send(json.dumps({"t": "btn", "b": "trigger", "down": True}))
    assert (await recv(g))["t"] == "paired"
    await host.until("gun", on=True)
    # The pairing pull itself is not a shot (only its release is relayed).
    await g.send(json.dumps({"t": "btn", "b": "trigger", "down": False}))
    await g.send(json.dumps({"t": "btn", "b": "trigger", "down": True}))
    await host.until("trigger", down=True)
    await g.send(json.dumps({"t": "btn", "b": "trigger", "down": False}))
    await host.until("trigger", down=False)
    await g.send(json.dumps({"t": "btn", "b": "reload", "down": True}))
    await host.until("reload_btn")
    assert [m["down"] for m in host.inbox if m["t"] == "trigger"] == [False, True, False]   # first is the pairing release

    # A power-cycled gun is recognised without pairing again.
    await g.close()
    await host.until("gun", on=False)
    g2 = await gun(server, "gun-1")
    assert (await recv(g2))["t"] == "paired"
    await host.until("gun", on=True)
    await g2.close()


async def test_dropped_gun_releases_a_held_trigger(server):  # noqa: F811
    (host,), _ = await squad(server, ["Ann"])
    g = await gun(server, "gun-2")
    await recv(g)
    await host.send(t="pair_gun")
    await host.until("pairing")
    await g.send(json.dumps({"t": "btn", "b": "trigger", "down": True}))
    await recv(g)
    await g.send(json.dumps({"t": "btn", "b": "trigger", "down": False}))
    await g.send(json.dumps({"t": "btn", "b": "trigger", "down": True}))
    await host.until("trigger", down=True)
    await g.close()
    await host.until("trigger", down=False)


async def test_gun_whose_player_vanished_can_be_paired_again(server):  # noqa: F811
    """A phone reloads its page: its old player is dropped without `leave`,
    and the gun must not stay bound to that ghost."""
    (old,), _ = await squad(server, ["Old"])
    g = await gun(server, "gun-3")
    await recv(g)
    await old.send(t="pair_gun")
    await old.until("pairing")
    await g.send(json.dumps({"t": "btn", "b": "trigger", "down": True}))
    assert (await recv(g))["t"] == "paired"
    await old.ws.close()                                     # no leave: the page just went away

    (new,), _ = await squad(server, ["New"])
    await new.send(t="pair_gun")
    await new.until("pairing")
    await g.send(json.dumps({"t": "btn", "b": "trigger", "down": False}))
    await g.send(json.dumps({"t": "btn", "b": "trigger", "down": True}))
    assert (await recv(g))["t"] == "paired"
    await new.until("gun", on=True)
