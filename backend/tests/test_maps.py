"""Map files: AR anchors, and maps uploaded to the server."""
import copy
import json

import pytest
from fastapi.testclient import TestClient

from app import mapdata
from app.main import app
from app.mapdata import MapData, load_map, save_map

KEY = "test-upload-key"


def small_map(**extra):
    """A 20 x 20 m room with one marker on its north wall."""
    return {
        "id": "room", "name": "Test room", "origin": None,
        "start": [0, 0], "helicopter": {"x": 5, "y": 5},
        "outline": [[-10, -10], [10, -10], [10, 10], [-10, 10]],
        "walls": [[-10, -10, 10, -10], [10, -10, 10, 10], [10, 10, -10, 10], [-10, 10, -10, -10]],
        "anchors": [{"id": "north", "x": 0, "y": 10, "facing": 180, "size_m": 0.2}],
        **extra,
    }


# ------------------------------------------------------------------ anchors

def test_anchors_load_and_go_to_the_phones():
    m = MapData.from_dict(small_map())
    assert [(a.id, a.x, a.y, a.facing, a.size_m) for a in m.anchors] == [("north", 0.0, 10.0, 180.0, 0.2)]
    assert m.public()["anchors"] == [{"id": "north", "x": 0.0, "y": 10.0, "facing": 180.0, "size_m": 0.2}]


def test_a_map_without_anchors_still_loads():
    d = small_map()
    del d["anchors"]
    assert MapData.from_dict(d).public()["anchors"] == []


def test_facing_is_a_compass_heading():
    d = small_map(anchors=[{"id": "a", "x": 0, "y": 0, "facing": -90}])
    a = MapData.from_dict(d).anchors[0]
    assert a.facing == 270.0 and a.size_m == 0.2           # default printed size


@pytest.mark.parametrize("anchors, why", [
    ([{"id": "a", "x": 0, "y": 0, "facing": 0}, {"id": "a", "x": 1, "y": 0, "facing": 0}], "used twice"),
    ([{"id": "", "x": 0, "y": 0, "facing": 0}], "empty"),
    ([{"id": "a", "x": 0, "y": 0, "facing": 0, "size_m": 0}], "wide"),
    ([{"id": "a", "x": 30, "y": 0, "facing": 0}], "outside the building"),
])
def test_bad_anchors_are_refused(anchors, why):
    with pytest.raises(ValueError, match=why):
        MapData.from_dict(small_map(anchors=anchors))


def test_schmeichel_has_its_markers():
    ids = [a.id for a in load_map("schmeichel").anchors]
    assert ids == ["cafe", "atrium"]


# ------------------------------------------------------------------ uploads

@pytest.fixture
def uploads(tmp_path, monkeypatch):
    monkeypatch.setenv("LOONIE_MAPS_DIR", str(tmp_path))
    monkeypatch.setenv("LOONIE_UPLOAD_KEY", KEY)
    saved = copy.copy(mapdata._cache)
    yield tmp_path
    mapdata._cache.clear()
    mapdata._cache.update(saved)


def post(client, map_id, body, key=KEY):
    headers = {"X-Upload-Key": key} if key is not None else {}
    return client.post(f"/maps/{map_id}", content=json.dumps(body), headers=headers)


def test_upload_needs_the_key(uploads):
    c = TestClient(app)
    assert post(c, "room", small_map(), key=None).status_code == 403
    assert post(c, "room", small_map(), key="wrong").status_code == 403
    assert not list(uploads.glob("*.json"))


def test_no_key_on_the_server_means_no_uploads(uploads, monkeypatch):
    monkeypatch.delenv("LOONIE_UPLOAD_KEY")
    assert post(TestClient(app), "room", small_map(), key="").status_code == 403


def test_a_good_map_is_kept_listed_and_playable(uploads):
    c = TestClient(app)
    r = post(c, "room-1", small_map())
    assert r.status_code == 200 and r.json()["id"] == "room-1"     # the URL names it, not the body
    assert (uploads / "room-1.json").is_file()
    assert "room-1" in c.get("/maps").json()
    mapdata._cache.pop("room-1")                                    # as after a restart: read back from disk
    assert load_map("room-1").anchors[0].id == "north"


def test_a_bad_map_is_refused_and_not_kept(uploads):
    c = TestClient(app)
    bad = small_map(anchors=[{"id": "a", "x": 99, "y": 0, "facing": 0}])
    r = post(c, "room", bad)
    assert r.status_code == 400 and "outside the building" in r.json()["detail"]
    assert post(c, "room", {"name": "no start"}).status_code == 400
    assert c.post("/maps/room", content=b"{not json", headers={"X-Upload-Key": KEY}).status_code == 400
    assert not list(uploads.glob("*.json"))


def test_the_servers_own_maps_cannot_be_replaced(uploads):
    c = TestClient(app)
    assert post(c, "schmeichel", small_map()).status_code == 409
    assert post(c, "walked", small_map()).status_code == 409
    assert load_map("schmeichel").name.startswith("Schmeichel")


def test_map_ids_cannot_escape_the_folder(uploads):
    with pytest.raises(ValueError):
        save_map("../evil", small_map())
    with pytest.raises(KeyError):
        load_map("../maps/arena")
    assert post(TestClient(app), "Bad_Id", small_map()).status_code == 400
