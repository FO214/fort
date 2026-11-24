"""Walkable floor as a grid, for maps that know where people can stand
rather than (or as well as) where the walls are.

A floor grid is a field of 0.5 m cells, each either open or blocked. Two
kinds of map make one:

* A building with obstacles: everything inside the outline is open, except
  cells too close to a wall, or under a table, counter, pillar, stairwell...
  (any polygon in the map's `obstacles`). Too close means a zombie's body
  would overlap it, so a zombie's centre on an open cell never clips anything.
* A walked area (free play): the host walks the space before the game, and
  everything within arm's reach of where they walked is open. Somewhere a
  person walked is somewhere a person can walk; everything else (walls,
  furniture, the road) is simply not open.

Zombies still steer with `Nav` (corners to walk to, worked out once at load):
`GridNav` is a `Nav` whose corridor graph is laid out over the open cells
automatically and whose line of sight is "only open cells in between".
"""
from __future__ import annotations

import math
from collections import deque
from typing import Optional, Sequence

from .nav import Nav, Point, Wall

CELL_M = 0.5
BODY_M = 0.4                # half a zombie's width: open cells keep this clear of walls and furniture
NODE_SPACING_M = 2.5        # corridor nodes are laid this far apart over open floor
LINK_M = 6.0                # and linked to every other node in sight up to this far away
TRAIL_REACH_M = 0.9         # a walked path counts as open this far either side
SNAP_CELLS = 6              # a point off the open floor counts as its nearest open cell this many cells away


def _seg_dist(p: Point, x1: float, y1: float, x2: float, y2: float) -> float:
    dx, dy = x2 - x1, y2 - y1
    span = dx * dx + dy * dy
    t = 0.0 if span == 0 else max(0.0, min(1.0, ((p[0] - x1) * dx + (p[1] - y1) * dy) / span))
    return math.hypot(p[0] - x1 - t * dx, p[1] - y1 - t * dy)


def resample(path: Sequence[Point], step: float) -> list[Point]:
    """Points every `step` metres along a path, its two ends included."""
    out = [tuple(path[0])]
    need = step
    for a, b in zip(path, path[1:]):
        seg, pos = math.dist(a, b), 0.0
        while seg - pos >= need:
            pos += need
            out.append((a[0] + (b[0] - a[0]) * pos / seg, a[1] + (b[1] - a[1]) * pos / seg))
            need = step
        need -= seg - pos
    if len(path) > 1 and math.dist(out[-1], path[-1]) > 1e-6:
        out.append(tuple(path[-1]))
    return out  # type: ignore[return-value]


def _inside(poly: Sequence[Point], p: Point) -> bool:
    odd = False
    for (x1, y1), (x2, y2) in zip(poly, list(poly[1:]) + list(poly[:1])):
        if (y1 > p[1]) != (y2 > p[1]) and p[0] < x1 + (p[1] - y1) * (x2 - x1) / (y2 - y1):
            odd = not odd
    return odd


def _edges(poly: Sequence[Point]) -> list[Wall]:
    return [(a[0], a[1], b[0], b[1]) for a, b in zip(poly, list(poly[1:]) + list(poly[:1]))]


class GridNav(Nav):
    def __init__(self, x0: float, y0: float, cols: int, rows: int, open_cells: bytearray,
                 walls: Sequence[Wall] = (), cell: float = CELL_M,
                 seeds: Sequence[Sequence[Point]] = ()) -> None:
        self.x0, self.y0, self.cols, self.rows, self.cell = x0, y0, cols, rows, cell
        self.open = open_cells
        nodes = self._lay_nodes(seeds)
        edges = self._link(nodes)
        # Nav works out every route once, using our line of sight.
        super().__init__(walls, nodes, edges)
        self._nearest = self._nearest_node_field()

    # ---- construction -----------------------------------------------------
    @classmethod
    def from_building(cls, walls: Sequence[Wall], obstacles: Sequence[Sequence[Point]] = (),
                      outline: Sequence[Point] = (), cell: float = CELL_M) -> "GridNav":
        """Open floor inside the outline, kept clear of walls and obstacles."""
        blockers = list(walls) + [e for poly in obstacles for e in _edges(poly)]
        pts = list(outline) + [(w[0], w[1]) for w in walls] + [(w[2], w[3]) for w in walls] \
            + [p for poly in obstacles for p in poly]
        if not pts:
            raise ValueError("a floor grid needs walls, an outline or obstacles to size it")
        x0, y0, cols, rows = cls._frame(pts, cell)
        cells = bytearray(cols * rows)
        for r in range(rows):
            for c in range(cols):
                p = (x0 + (c + 0.5) * cell, y0 + (r + 0.5) * cell)
                if outline and not _inside(outline, p):
                    continue
                if any(_inside(poly, p) for poly in obstacles):
                    continue
                if any(_seg_dist(p, *w) < BODY_M for w in blockers):
                    continue
                cells[r * cols + c] = 1
        return cls(x0, y0, cols, rows, cells, walls, cell)

    @classmethod
    def from_paths(cls, paths: Sequence[Sequence[Point]], reach: float = TRAIL_REACH_M,
                   cell: float = CELL_M) -> "GridNav":
        """Open floor wherever someone walked, `reach` either side of it."""
        pts = [p for path in paths for p in path]
        if not pts:
            raise ValueError("nothing was walked")
        x0, y0, cols, rows = cls._frame(pts, cell, reach + cell)
        cells = bytearray(cols * rows)
        span = int(math.ceil(reach / cell)) + 1
        for path in paths:
            segs = list(zip(path, path[1:])) or [(path[0], path[0])]
            for a, b in segs:
                lo_c, hi_c = int((min(a[0], b[0]) - x0) / cell) - span, int((max(a[0], b[0]) - x0) / cell) + span
                lo_r, hi_r = int((min(a[1], b[1]) - y0) / cell) - span, int((max(a[1], b[1]) - y0) / cell) + span
                for r in range(max(0, lo_r), min(rows, hi_r + 1)):
                    for c in range(max(0, lo_c), min(cols, hi_c + 1)):
                        p = (x0 + (c + 0.5) * cell, y0 + (r + 0.5) * cell)
                        if _seg_dist(p, a[0], a[1], b[0], b[1]) <= reach:
                            cells[r * cols + c] = 1
        # Lay corridor nodes along the walk itself: it is the shape of the place.
        return cls(x0, y0, cols, rows, cells, (), cell, seeds=paths)

    @staticmethod
    def _frame(pts: Sequence[Point], cell: float, pad: float = 1.0) -> tuple[float, float, int, int]:
        x0, y0 = min(p[0] for p in pts) - pad, min(p[1] for p in pts) - pad
        x1, y1 = max(p[0] for p in pts) + pad, max(p[1] for p in pts) + pad
        return x0, y0, int(math.ceil((x1 - x0) / cell)), int(math.ceil((y1 - y0) / cell))

    # ---- cells --------------------------------------------------------------
    def _cell(self, p: Point) -> tuple[int, int]:
        return int(math.floor((p[0] - self.x0) / self.cell)), int(math.floor((p[1] - self.y0) / self.cell))

    def _centre(self, c: int, r: int) -> Point:
        return (round(self.x0 + (c + 0.5) * self.cell, 2), round(self.y0 + (r + 0.5) * self.cell, 2))

    def is_open(self, p: Point) -> bool:
        c, r = self._cell(p)
        return 0 <= c < self.cols and 0 <= r < self.rows and self.open[r * self.cols + c] == 1

    def open_area_m2(self) -> float:
        return sum(self.open) * self.cell * self.cell

    def standable(self, p: Point, clearance: float = BODY_M) -> bool:
        # Open cells already keep a body's width from anything solid.
        return self.is_open(p)

    def snap(self, p: Point) -> Optional[Point]:
        """`p` if it is on open floor, else the nearest open cell close by."""
        if self.is_open(p):
            return p
        c0, r0 = self._cell(p)
        best, best_d = None, math.inf
        for r in range(r0 - SNAP_CELLS, r0 + SNAP_CELLS + 1):
            for c in range(c0 - SNAP_CELLS, c0 + SNAP_CELLS + 1):
                if 0 <= c < self.cols and 0 <= r < self.rows and self.open[r * self.cols + c]:
                    q = self._centre(c, r)
                    d = math.dist(p, q)
                    if d < best_d:
                        best, best_d = q, d
        return best

    # ---- line of sight --------------------------------------------------------
    def clear(self, p: Point, q: Point) -> bool:
        """Only open floor between p and q. A point that is itself just off the
        floor (a player whose GPS has wandered) does not block its own end."""
        d = math.dist(p, q)
        n = max(1, int(d / (self.cell * 0.5)))
        a, b = self.is_open(p), self.is_open(q)
        for i in range(n + 1):
            t = i / n
            s = (p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t)
            if self.is_open(s):
                continue
            # Let the ends hang off the floor, but not the middle.
            if (not a and t * d < self.cell * 2) or (not b and (1 - t) * d < self.cell * 2):
                continue
            return False
        return True

    def wall_distance(self, p: Point) -> float:
        return math.inf if self.is_open(p) else 0.0

    # ---- the corridor graph ----------------------------------------------------
    def _lay_nodes(self, seeds: Sequence[Sequence[Point]]) -> dict[str, Point]:
        nodes: dict[str, Point] = {}
        near: dict[tuple[int, int], list[Point]] = {}        # nodes by square, to check spacing quickly

        def gap(p: Point) -> float:
            bx, by = int(p[0] // NODE_SPACING_M), int(p[1] // NODE_SPACING_M)
            return min((math.dist(p, q) for dx in (-1, 0, 1) for dy in (-1, 0, 1)
                        for q in near.get((bx + dx, by + dy), ())), default=math.inf)

        def far_from_all(p: Point) -> bool:
            return gap(p) >= NODE_SPACING_M * 0.6

        def add(p: Point) -> None:
            nodes[f"n{len(nodes)}"] = p
            near.setdefault((int(p[0] // NODE_SPACING_M), int(p[1] // NODE_SPACING_M)), []).append(p)

        # Along the walked paths first, every NODE_SPACING_M.
        for path in seeds:
            for p in resample(path, NODE_SPACING_M):
                q = self.snap(p)
                if q and far_from_all(q):
                    add(q)
        # Every corner of the open floor: the shortest way round anything
        # passes its corners, and a narrow gap (beside a table, a doorway)
        # always has corners at both ends.
        for r in range(self.rows):
            for c in range(self.cols):
                if self._corner(c, r):
                    p = self._centre(c, r)
                    if gap(p) >= self.cell * 1.5:
                        add(p)
        # Then a lattice over whatever open floor is not covered yet, so
        # anywhere on the floor has a node in sight.
        step = max(1, int(round(NODE_SPACING_M / self.cell)))
        for r in range(step // 2, self.rows, step):
            for c in range(step // 2, self.cols, step):
                if self.open[r * self.cols + c]:
                    p = self._centre(c, r)
                    if far_from_all(p):
                        add(p)
        return nodes

    def _at(self, c: int, r: int) -> bool:
        return 0 <= c < self.cols and 0 <= r < self.rows and self.open[r * self.cols + c] == 1

    def _corner(self, c: int, r: int) -> bool:
        """An open cell at an outside corner of something solid: blocked
        diagonally, open on both sides of that diagonal."""
        if not self._at(c, r):
            return False
        for dc, dr in ((1, 1), (1, -1), (-1, 1), (-1, -1)):
            if not self._at(c + dc, r + dr) and self._at(c + dc, r) and self._at(c, r + dr):
                return True
        return False

    def _link(self, nodes: dict[str, Point]) -> list[tuple[str, str]]:
        bucket: dict[tuple[int, int], list[str]] = {}
        for k, p in nodes.items():
            bucket.setdefault((int(p[0] // LINK_M), int(p[1] // LINK_M)), []).append(k)
        edges: list[tuple[str, str]] = []
        for k, p in nodes.items():
            bx, by = int(p[0] // LINK_M), int(p[1] // LINK_M)
            for dx in (-1, 0, 1):
                for dy in (-1, 0, 1):
                    for j in bucket.get((bx + dx, by + dy), ()):
                        if j > k and math.dist(p, nodes[j]) <= LINK_M and self.clear(p, nodes[j]):
                            edges.append((k, j))
        return edges

    def _nearest_node_field(self) -> dict[int, str]:
        """For every open cell, the corridor node nearest to it by walking:
        one sweep at load, so `nearest_node` is a lookup while zombies move."""
        owner: dict[int, str] = {}
        queue: deque[int] = deque()
        for name, p in self.nodes.items():
            c, r = self._cell(p)
            i = r * self.cols + c
            if 0 <= c < self.cols and 0 <= r < self.rows and i not in owner:
                owner[i] = name
                queue.append(i)
        while queue:
            i = queue.popleft()
            r, c = divmod(i, self.cols)
            for dc, dr in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                cc, rr = c + dc, r + dr
                j = rr * self.cols + cc
                if 0 <= cc < self.cols and 0 <= rr < self.rows and self.open[j] and j not in owner:
                    owner[j] = owner[i]
                    queue.append(j)
        return owner

    def nearest_node(self, p: Point) -> Optional[str]:
        s = self.snap(p)
        if s is not None:
            c, r = self._cell(s)
            name = self._nearest.get(r * self.cols + c)
            if name is not None:
                return name
        return super().nearest_node(p)
