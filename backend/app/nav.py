"""Getting around a map that has walls.

Two questions are answered here:

* Can you walk in a straight line from here to there? (No wall in the way.)
* If not, where should you walk next? (Along the corridor graph.)

Zombies ask both every fraction of a second. Maps without walls or a graph
do not use this module at all; the open arena is one of those.
"""
from __future__ import annotations

import heapq
import math
from typing import Optional, Sequence

Point = tuple[float, float]
Wall = tuple[float, float, float, float]

AT_NODE_M = 0.6            # this close to a corridor node counts as standing on it


def _orient(a: Point, b: Point, c: Point) -> float:
    return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])


def segments_cross(p: Point, q: Point, a: Point, b: Point) -> bool:
    """True if segment p–q properly crosses segment a–b. Touching an end of
    a wall, or running along it, does not count as crossing."""
    d1, d2 = _orient(a, b, p), _orient(a, b, q)
    d3, d4 = _orient(p, q, a), _orient(p, q, b)
    return (d1 > 0) != (d2 > 0) and (d3 > 0) != (d4 > 0) and d1 != 0 and d2 != 0 and d3 != 0 and d4 != 0


class Nav:
    def __init__(self, walls: Sequence[Wall] = (), nodes: Optional[dict[str, Point]] = None,
                 edges: Sequence[tuple[str, str]] = ()) -> None:
        self.walls: list[Wall] = [tuple(map(float, w)) for w in walls]            # type: ignore[misc]
        self.nodes: dict[str, Point] = {k: (float(v[0]), float(v[1])) for k, v in (nodes or {}).items()}
        self._adj: dict[str, list[tuple[str, float]]] = {k: [] for k in self.nodes}
        for a, b in edges:
            if a not in self.nodes or b not in self.nodes:
                raise ValueError(f"corridor edge {a}-{b} names a node that does not exist")
            if not self.clear(self.nodes[a], self.nodes[b]):
                raise ValueError(f"corridor edge {a}-{b} runs through a wall")
            d = math.dist(self.nodes[a], self.nodes[b])
            self._adj[a].append((b, d))
            self._adj[b].append((a, d))
        # next_hop[a][b]: the neighbour of a to walk to on the shortest way to b.
        self.next_hop: dict[str, dict[str, str]] = {a: self._routes_from(a) for a in self.nodes}

    # ---- line of sight -----------------------------------------------------
    def clear(self, p: Point, q: Point) -> bool:
        """No wall between p and q."""
        lo_x, hi_x = (p[0], q[0]) if p[0] <= q[0] else (q[0], p[0])
        lo_y, hi_y = (p[1], q[1]) if p[1] <= q[1] else (q[1], p[1])
        for x1, y1, x2, y2 in self.walls:
            if (x1 < lo_x and x2 < lo_x) or (x1 > hi_x and x2 > hi_x) \
                    or (y1 < lo_y and y2 < lo_y) or (y1 > hi_y and y2 > hi_y):
                continue                               # nowhere near: skip the arithmetic
            if segments_cross(p, q, (x1, y1), (x2, y2)):
                return False
        return True

    def wall_distance(self, p: Point) -> float:
        """How far `p` is from the nearest wall, in metres."""
        best = math.inf
        for x1, y1, x2, y2 in self.walls:
            dx, dy = x2 - x1, y2 - y1
            span = dx * dx + dy * dy
            t = 0.0 if span == 0 else max(0.0, min(1.0, ((p[0] - x1) * dx + (p[1] - y1) * dy) / span))
            best = min(best, math.hypot(p[0] - x1 - t * dx, p[1] - y1 - t * dy))
        return best

    # ---- routes ------------------------------------------------------------
    def nearest_node(self, p: Point) -> Optional[str]:
        """The closest corridor node that can be walked to in a straight
        line. If none can (a GPS fix inside a wall, say), simply the closest."""
        best: Optional[str] = None
        best_d = math.inf
        fallback: Optional[str] = None
        fallback_d = math.inf
        for name, n in self.nodes.items():
            d = math.dist(p, n)
            if d < fallback_d:
                fallback, fallback_d = name, d
            if d < best_d and self.clear(p, n):
                best, best_d = name, d
        return best or fallback

    def waypoint(self, frm: Point, to: Point) -> Point:
        """Where to walk next to get from `frm` to `to`. Straight there if
        nothing is in the way, otherwise the next corner on the way round."""
        if not self.nodes or self.clear(frm, to):
            return to
        a, b = self.nearest_node(frm), self.nearest_node(to)
        if a is None or b is None:
            return to
        here = self.nodes[a]
        if a == b or b not in self.next_hop[a]:
            # Last stretch (or no route at all): finish in a straight line, so
            # a player whose GPS puts them inside a wall can still be reached.
            return to if math.dist(frm, here) < AT_NODE_M else here
        nxt = self.next_hop[a][b]
        if not self.clear(frm, self.nodes[nxt]):
            return here                                # get onto the corridor first
        # Cut the corner: aim at the furthest node of the route still in view.
        while nxt != b and self.clear(frm, self.nodes[self.next_hop[nxt][b]]):
            nxt = self.next_hop[nxt][b]
        return self.nodes[nxt]

    def route_length(self, frm: Point, to: Point) -> float:
        """Walking distance from `frm` to `to`, for picking spawn points that
        are near by corridor rather than near through a wall."""
        if not self.nodes or self.clear(frm, to):
            return math.dist(frm, to)
        a, b = self.nearest_node(frm), self.nearest_node(to)
        if a is None or b is None or (a != b and b not in self.next_hop[a]):
            return math.dist(frm, to)
        total, cur = math.dist(frm, self.nodes[a]), a
        while cur != b:
            nxt = self.next_hop[cur][b]
            total += math.dist(self.nodes[cur], self.nodes[nxt])
            cur = nxt
        return total + math.dist(self.nodes[b], to)

    def _routes_from(self, start: str) -> dict[str, str]:
        """Dijkstra from `start`: for every reachable node, the first step."""
        dist: dict[str, float] = {start: 0.0}
        first: dict[str, str] = {}
        heap: list[tuple[float, str, Optional[str]]] = [(0.0, start, None)]
        done: set[str] = set()
        while heap:
            d, node, via = heapq.heappop(heap)
            if node in done:
                continue
            done.add(node)
            if via is not None:
                first[node] = via
            for nb, w in self._adj[node]:
                nd = d + w
                if nd < dist.get(nb, math.inf):
                    dist[nb] = nd
                    heapq.heappush(heap, (nd, nb, via if via is not None else nb))
        return first
