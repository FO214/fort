"""Getting around a map that has walls.

Two questions are answered here:

* Can you walk in a straight line from here to there? (No wall in the way.)
* If not, where should you walk next? (Along the corridor graph.)

Zombies ask both every fraction of a second. Maps without walls or a graph
do not use this module at all; the open arena is one of those.
"""
from __future__ import annotations

import heapq
from collections import OrderedDict
import math
from typing import Optional, Sequence

Point = tuple[float, float]
Wall = tuple[float, float, float, float]

AT_NODE_M = 0.6
TREES_KEPT = 32           # route trees kept: a few per player, as they move from node to node            # this close to a corridor node counts as standing on it


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
        # Routes are worked out on demand (see `toward`), not for every pair up front:
        # that grows with the square of the map and a big walked area has thousands of nodes.
        self._trees: OrderedDict[str, tuple[dict[str, str], dict[str, float]]] = OrderedDict()
        self.next_hop = _Hops(self)

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

    def standable(self, p: Point, clearance: float = 0.5) -> bool:
        """Could a zombie stand here without overlapping a wall?"""
        return not self.walls or self.wall_distance(p) >= clearance

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

    def toward(self, goal: str) -> tuple[dict[str, str], dict[str, float]]:
        """Every node that can reach `goal`: the neighbour to step to on the
        shortest way there, and how far it is. Worked out the first time a
        goal is asked for and kept for the last few goals, which is what a
        wave needs: zombies only ever head for the nodes the players are near."""
        tree = self._trees.get(goal)
        if tree is None:
            tree = self._tree(goal)
            self._trees[goal] = tree
            if len(self._trees) > TREES_KEPT:
                self._trees.popitem(last=False)
        else:
            self._trees.move_to_end(goal)
        return tree

    def waypoint(self, frm: Point, to: Point) -> Point:
        """Where to walk next to get from `frm` to `to`. Straight there if
        nothing is in the way, otherwise the next corner on the way round."""
        if not self.nodes or self.clear(frm, to):
            return to
        a, b = self.nearest_node(frm), self.nearest_node(to)
        if a is None or b is None:
            return to
        here = self.nodes[a]
        step, _ = self.toward(b)
        if a == b or a not in step:
            # Last stretch (or no route at all): finish in a straight line, so
            # a player whose GPS puts them inside a wall can still be reached.
            return to if math.dist(frm, here) < AT_NODE_M else here
        nxt = step[a]
        if not self.clear(frm, self.nodes[nxt]):
            return here                                # get onto the corridor first
        # Cut the corner: aim at the furthest node of the route still in view.
        while nxt != b and self.clear(frm, self.nodes[step[nxt]]):
            nxt = step[nxt]
        return self.nodes[nxt]

    def route_length(self, frm: Point, to: Point) -> float:
        """Walking distance from `frm` to `to`, for picking spawn points that
        are near by corridor rather than near through a wall."""
        if not self.nodes or self.clear(frm, to):
            return math.dist(frm, to)
        a, b = self.nearest_node(frm), self.nearest_node(to)
        if a is None or b is None:
            return math.dist(frm, to)
        _, far = self.toward(b)
        if a not in far:
            return math.dist(frm, to)
        return math.dist(frm, self.nodes[a]) + far[a] + math.dist(self.nodes[b], to)

    def _tree(self, goal: str) -> tuple[dict[str, str], dict[str, float]]:
        """Dijkstra out from `goal`. The graph runs both ways, so the node a
        search reached each node from is that node's next step toward `goal`."""
        far: dict[str, float] = {goal: 0.0}
        step: dict[str, str] = {}
        heap: list[tuple[float, str]] = [(0.0, goal)]
        done: set[str] = set()
        while heap:
            d, node = heapq.heappop(heap)
            if node in done:
                continue
            done.add(node)
            for nb, w in self._adj[node]:
                nd = d + w
                if nd < far.get(nb, math.inf):
                    far[nb] = nd
                    step[nb] = node
                    heapq.heappush(heap, (nd, nb))
        return step, far


class _Hops:
    """`next_hop[a][b]`: the neighbour of a on the shortest way to b, and
    `b in next_hop[a]` if there is a way at all. A view over `Nav.toward`."""

    def __init__(self, nav: Nav) -> None:
        self._nav = nav

    def __getitem__(self, a: str) -> "_From":
        return _From(self._nav, a)


class _From:
    def __init__(self, nav: Nav, a: str) -> None:
        self._nav, self._a = nav, a

    def __contains__(self, b: str) -> bool:
        return self._a in self._nav.toward(b)[0]

    def __getitem__(self, b: str) -> str:
        return self._nav.toward(b)[0][self._a]
