"""Builds maps/schmeichel.json: the ground floor of the Schmeichel Building,
and docs/schmeichel-map.svg, a picture of it to check against the real place.

Run from backend/:   python tools/build_schmeichel.py

WHERE THE NUMBERS COME FROM
The outline, position and orientation are real: OpenStreetMap way 1300081894,
with its two mapped entrances (the curved west side, and the south-east).
Map (0, 0) is the centre of the footprint; x is east, y is north, in metres.

The interior was reconstructed from a 56-second walkthrough video, not a
floor plan, so treat every interior wall as good to a few metres:

* The video starts in the atrium at the building's elbow, where the helicopter
  goes. A full turn there shows the main entrance front-left and a second set
  of glass doors directly behind, which matches the two OSM entrances and
  fixes the spot.
* It then walks one straight concourse about 50 m long up the north wing:
  full-height windows and a row of columns on the left (west, the courtyard
  side), a dark brick wall of rooms on the right (east).
* About a third of the way along, a white-brick side corridor leads right to
  exit doors and washrooms, and a lounge nook sits in the curved corner on
  the left.
* The concourse ends in the Founders Café seating area, which fills the north
  end of the wing. That is where the squad starts.

Distances along the concourse come from walking time and counting column
bays. If the game feels off on site, the numbers to adjust are just below.
"""
from __future__ import annotations

import json
import math
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "maps" / "schmeichel.json"
PLAN = Path(__file__).resolve().parent.parent.parent / "docs" / "schmeichel-map.svg"

# ---- the real outline (metres from the footprint's centre) -----------------
OUTLINE = [
    (16.4, 15.7), (-15.0, 62.5), (-31.0, 52.7), (-6.2, 15.3), (-1.9, 6.9), (-3.5, -4.6), (-10.2, -10.7),
    (-30.2, -13.1), (-28.5, -33.3), (21.2, -31.6), (20.8, -25.9), (30.1, -19.6), (38.0, -14.3),
]
ENTRANCE_WEST = (-3.5, -4.6)        # OSM node 12042258954, in the curved wall
ENTRANCE_SOUTH_EAST = (30.1, -19.6)  # OSM node 14142996338
WEST_CORNER, NORTH_WEST_CORNER = OUTLINE[3], OUTLINE[2]     # the straight west face of the north wing

# ---- the north wing's own axes ---------------------------------------------
# `a` runs along the wing from its south-west corner toward the north end;
# `c` runs across it from the west (window) face to the east face.
_len = math.dist(WEST_CORNER, NORTH_WEST_CORNER)
U = ((NORTH_WEST_CORNER[0] - WEST_CORNER[0]) / _len, (NORTH_WEST_CORNER[1] - WEST_CORNER[1]) / _len)
V = (U[1], -U[0])


def wing(a: float, c: float) -> tuple[float, float]:
    """A point given along/across the north wing, in map metres."""
    return (round(WEST_CORNER[0] + a * U[0] + c * V[0], 2), round(WEST_CORNER[1] + a * U[1] + c * V[1], 2))


# ---- what the video shows (metres; adjust here) ----------------------------
WING_LEN = _len                 # 44.9 m of straight window wall
WING_WIDTH = 19.0
CONCOURSE = 5.0                 # walking line, this far inside the window wall
DARK_WALL = 8.5                 # the dark brick wall of rooms on the east side of the concourse
HELI_A = -25.3                  # the atrium spot where the video starts, on the concourse line
SIDE_CORRIDOR = (-9.5, -6.5)    # where the white-brick corridor leaves the concourse, along `a`
DARK_WALL_FROM = -22.0          # the dark wall starts just north of the helicopter spot
CAFE_FROM = 24.7                # the concourse opens into the café here
CAFE_EAST = 14.0                # café counter / back-of-house wall
ATRIUM_SOUTH_Y = -17.0          # wall behind the registration desks
ATRIUM_EAST_X = 22.0            # glass-fronted rooms east of the atrium


def seg(p, q):
    return [p[0], p[1], q[0], q[1]]


def build() -> dict:
    outline_walls = [seg(p, q) for p, q in zip(OUTLINE, OUTLINE[1:] + OUTLINE[:1])]
    dark_south = wing(DARK_WALL_FROM, DARK_WALL)
    inner = [
        # dark brick wall, with the gap where the side corridor leaves
        seg(dark_south, wing(SIDE_CORRIDOR[0], DARK_WALL)),
        seg(wing(SIDE_CORRIDOR[1], DARK_WALL), wing(CAFE_FROM, DARK_WALL)),
        # the side corridor to the exit doors
        seg(wing(SIDE_CORRIDOR[0], DARK_WALL), wing(SIDE_CORRIDOR[0], WING_WIDTH)),
        seg(wing(SIDE_CORRIDOR[1], DARK_WALL), wing(SIDE_CORRIDOR[1], WING_WIDTH)),
        # the café widens east of the dark wall, up to its counter wall
        seg(wing(CAFE_FROM, DARK_WALL), wing(CAFE_FROM, CAFE_EAST)),
        seg(wing(CAFE_FROM, CAFE_EAST), wing(WING_LEN - 0.4, CAFE_EAST)),
        # the atrium: rooms to the east, desks and the south wing behind a wall to the south
        seg(dark_south, (ATRIUM_EAST_X, -6.0)),
        seg((ATRIUM_EAST_X, -6.0), (ATRIUM_EAST_X, ATRIUM_SOUTH_Y)),
        seg((ATRIUM_EAST_X, ATRIUM_SOUTH_Y), (-9.0, ATRIUM_SOUTH_Y)),
        seg((-9.0, ATRIUM_SOUTH_Y), OUTLINE[6]),
    ]
    c = CONCOURSE
    side_a = sum(SIDE_CORRIDOR) / 2
    nodes = {
        "cafe_far": wing(40, 6), "cafe": wing(33, 7), "cafe_counter": wing(33, 11.5), "cafe_door": wing(CAFE_FROM + 1.8, c),
        "concourse_north": wing(18, c), "concourse_mid": wing(9, c), "concourse_south": wing(0, c),
        "junction": wing(side_a, c), "side_corridor": wing(side_a, 12.5), "exit_doors": wing(side_a, 17.5),
        "atrium_north": wing(-17, c), "helicopter": wing(HELI_A, c),
        "main_entrance": wing(-20, -4.5), "atrium_south_west": (0.0, -12.0), "atrium_south_east": (17.0, -12.0),
    }
    edges = [
        ["cafe_far", "cafe"], ["cafe", "cafe_counter"], ["cafe", "cafe_door"], ["cafe_door", "concourse_north"],
        ["concourse_north", "concourse_mid"], ["concourse_mid", "concourse_south"], ["concourse_south", "junction"],
        ["junction", "side_corridor"], ["side_corridor", "exit_doors"], ["junction", "atrium_north"],
        ["atrium_north", "helicopter"], ["atrium_north", "main_entrance"], ["helicopter", "main_entrance"],
        ["helicopter", "atrium_south_west"], ["helicopter", "atrium_south_east"],
        ["atrium_south_west", "atrium_south_east"], ["main_entrance", "atrium_south_west"],
    ]
    spawn_points = [
        wing(side_a, 17.0),                                  # the exit doors at the end of the side corridor
        wing(-15, 7.4), wing(-2, 7.4), wing(6, 7.4), wing(14, 7.4), wing(21, 7.4),   # doors along the dark wall
        wing(42, 3), wing(42, 11), wing(30, 12.5),           # far corners of the café
        wing(-18.5, -6.5),                                   # just inside the main entrance
        wing(-24, 0.8),                                      # foot of the black staircase
        (19.5, -14.5), (-5.0, -14.0),                        # the glass doors behind the atrium; the desk corner
    ]
    heli = nodes["helicopter"]
    return {
        "id": "schmeichel",
        "name": "Schmeichel Building, ground floor",
        "note": ("Outline and position are real (OpenStreetMap way 1300081894). The interior was reconstructed from a "
                 "walkthrough video and is good to a few metres, not a survey. Generated by backend/tools/build_schmeichel.py: "
                 "edit the numbers there, not this file."),
        "origin": [43.007272, -81.2763278],
        "rotation_deg": 0,
        "start": list(wing(34, 7)),
        "helicopter": {"x": heli[0], "y": heli[1], "radius_m": 6, "qr": "LOONIE:HELI"},
        "outline": [list(p) for p in OUTLINE],
        "walls": outline_walls + inner,
        "labels": [
            {"text": "Café", "x": wing(38, 7)[0], "y": wing(38, 7)[1]},
            {"text": "Rooms", "x": wing(8, 14.2)[0], "y": wing(8, 14.2)[1]},
            {"text": "Atrium", "x": 8.0, "y": -10.5},
            {"text": "South wing (closed)", "x": -12.0, "y": -25.0},
        ],
        "graph": {"nodes": {k: list(p) for k, p in nodes.items()}, "edges": edges},
        "spawn": {"mode": "points", "min_m": 9},
        "spawn_points": [list(p) for p in spawn_points],
    }


def render_plan(data: dict) -> str:
    """A picture of the map to check against the real building: walls, the
    corridor routes zombies use, where they spawn, the start and the helicopter."""
    scale, margin = 9.0, 9.0                      # pixels per metre; metres of border
    xs, ys = [p[0] for p in data["outline"]], [p[1] for p in data["outline"]]
    min_x, max_y = min(xs) - margin, max(ys) + margin
    width, height = (max(xs) - min(xs) + margin * 2) * scale, (max(ys) - min(ys) + margin * 2) * scale + 60

    def px(p):
        return f"{(p[0] - min_x) * scale:.1f},{(max_y - p[1]) * scale + 60:.1f}"

    def xy(p):
        return (p[0] - min_x) * scale, (max_y - p[1]) * scale + 60

    font = 'font-family="Helvetica, Arial, sans-serif"'
    out = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{width:.0f}" height="{height:.0f}" viewBox="0 0 {width:.0f} {height:.0f}">',
           f'<title>{data["name"]}</title>', f'<rect width="{width:.0f}" height="{height:.0f}" fill="#ffffff"/>',
           f'<text x="16" y="26" {font} font-size="18" font-weight="700">{data["name"]}</text>',
           f'<text x="16" y="46" {font} font-size="12" fill="#555555">Outline from OpenStreetMap. Interior from a walkthrough video: right to a few metres, not a survey. North is up.</text>',
           f'<polygon points="{" ".join(px(p) for p in data["outline"])}" fill="#f1f3f5" stroke="none"/>']
    nodes = data["graph"]["nodes"]
    for a, b in data["graph"]["edges"]:
        (x1, y1), (x2, y2) = xy(nodes[a]), xy(nodes[b])
        out.append(f'<line x1="{x1:.1f}" y1="{y1:.1f}" x2="{x2:.1f}" y2="{y2:.1f}" stroke="#2563eb" stroke-width="1.5" stroke-dasharray="5 4"/>')
    for w in data["walls"]:
        (x1, y1), (x2, y2) = xy(w[:2]), xy(w[2:])
        out.append(f'<line x1="{x1:.1f}" y1="{y1:.1f}" x2="{x2:.1f}" y2="{y2:.1f}" stroke="#111111" stroke-width="2.5" stroke-linecap="round"/>')
    for p in data["spawn_points"]:
        x, y = xy(p)
        out.append(f'<path d="M {x:.1f} {y - 5:.1f} L {x + 4.5:.1f} {y + 4:.1f} L {x - 4.5:.1f} {y + 4:.1f} Z" fill="#dc2626"/>')
    for lb in data["labels"]:
        x, y = xy((lb["x"], lb["y"]))
        out.append(f'<text x="{x:.1f}" y="{y:.1f}" text-anchor="middle" {font} font-size="12" fill="#444444">{lb["text"]}</text>')
    for name, p, dx in (("Main entrance (courtyard side)", ENTRANCE_WEST, -8), ("South-east entrance", ENTRANCE_SOUTH_EAST, 8)):
        x, y = xy(p)
        anchor = "end" if dx < 0 else "start"
        out.append(f'<circle cx="{x:.1f}" cy="{y:.1f}" r="4" fill="#ffffff" stroke="#111111" stroke-width="2"/>')
        out.append(f'<text x="{x + dx:.1f}" y="{y + 4:.1f}" text-anchor="{anchor}" {font} font-size="11" fill="#111111">{name}</text>')
    x, y = xy(data["start"])
    out.append(f'<circle cx="{x:.1f}" cy="{y:.1f}" r="8" fill="#059669"/>')
    out.append(f'<text x="{x - 12:.1f}" y="{y + 4:.1f}" text-anchor="end" {font} font-size="12" font-weight="700" fill="#059669">START (café)</text>')
    h = data["helicopter"]
    x, y = xy((h["x"], h["y"]))
    out.append(f'<circle cx="{x:.1f}" cy="{y:.1f}" r="{h["radius_m"] * scale:.1f}" fill="#facc15" fill-opacity="0.25" stroke="#ca8a04" stroke-dasharray="4 3"/>')
    out.append(f'<rect x="{x - 9:.1f}" y="{y - 9:.1f}" width="18" height="18" rx="4" fill="#facc15" stroke="#111111"/>')
    out.append(f'<text x="{x:.1f}" y="{y + 4.5:.1f}" text-anchor="middle" {font} font-size="13" font-weight="800">H</text>')
    out.append(f'<text x="{x + 14:.1f}" y="{y - 12:.1f}" {font} font-size="12" font-weight="700" fill="#854d0e">HELICOPTER (tape the QR sign here)</text>')
    # legend, scale bar, north arrow
    ly = height - 74
    out.append(f'<path d="M 20 {ly - 5} L 24.5 {ly + 4} L 15.5 {ly + 4} Z" fill="#dc2626"/><text x="32" y="{ly + 4}" {font} font-size="11">zombie spawn point</text>')
    out.append(f'<line x1="14" y1="{ly + 18}" x2="27" y2="{ly + 18}" stroke="#2563eb" stroke-width="1.5" stroke-dasharray="5 4"/><text x="32" y="{ly + 22}" {font} font-size="11">route zombies follow</text>')
    out.append(f'<line x1="14" y1="{ly + 36}" x2="27" y2="{ly + 36}" stroke="#111111" stroke-width="2.5"/><text x="32" y="{ly + 40}" {font} font-size="11">wall (zombies cannot pass)</text>')
    out.append(f'<line x1="16" y1="{ly + 58}" x2="{16 + 10 * scale:.0f}" y2="{ly + 58}" stroke="#111111" stroke-width="2"/><text x="{22 + 10 * scale:.0f}" y="{ly + 62}" {font} font-size="11">10 m</text>')
    out.append(f'<path d="M {width - 30:.0f} 78 l 7 20 l -7 -5 l -7 5 Z" fill="#111111"/><text x="{width - 30:.0f}" y="72" text-anchor="middle" {font} font-size="12" font-weight="700">N</text>')
    out.append("</svg>")
    return "\n".join(out) + "\n"


if __name__ == "__main__":
    data = build()
    OUT.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n")
    PLAN.write_text(render_plan(data))
    h = data["helicopter"]
    print(f"wrote {OUT.name}: {len(data['walls'])} walls, {len(data['graph']['nodes'])} corridor nodes, "
          f"{len(data['spawn_points'])} spawn points")
    print(f"start {data['start']}, helicopter ({h['x']}, {h['y']}), "
          f"{math.dist(data['start'], (h['x'], h['y'])):.0f} m apart in a straight line")
