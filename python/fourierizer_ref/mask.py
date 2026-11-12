r"""Resolution-independent selections (PLAN.md §4.3).

A selection lives in the physical plane (t [s], φ = log₂ f [octaves]); it never refers to
matrix indices, so changing the window, L, N or H keeps it intact.

Each shape s has a signed distance d_s(t, φ) to its boundary (positive inside), measured in a
*scaled* plane where one unit equals the shape's feather: Δt / feather_t and Δφ / feather_oct.
Its soft mask is a raised-cosine ramp centered on the boundary:

    M_s = a_s · ρ(d_s),   ρ(d) = 0 if d ≤ -½,  1 if d ≥ ½,  ½ + ½·sin(π d) otherwise.

With feather → 0 the ramp becomes a hard (binary) edge. Shapes combine in order, like layers
in an image editor:

    add:       M ← M + (1 − M) · M_s
    subtract:  M ← M · (1 − M_s)
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal

import numpy as np

F_FLOOR = 1.0  # Hz; log₂ needs f > 0 (the DC bin is mapped here)


def _ramp(d: np.ndarray) -> np.ndarray:
    return np.where(d <= -0.5, 0.0, np.where(d >= 0.5, 1.0, 0.5 + 0.5 * np.sin(np.pi * np.clip(d, -0.5, 0.5))))


@dataclass(frozen=True)
class _Shape:
    mode: Literal["add", "subtract"] = "add"
    gain: float = 1.0
    feather_s: float = 0.01      # time feather, seconds
    feather_oct: float = 1 / 12  # frequency feather, octaves (1/12 = one semitone)

    def signed_distance(self, T: np.ndarray, P: np.ndarray) -> np.ndarray:  # pragma: no cover
        raise NotImplementedError

    def soft(self, T: np.ndarray, P: np.ndarray) -> np.ndarray:
        return self.gain * _ramp(self.signed_distance(T, P))


@dataclass(frozen=True)
class Rect(_Shape):
    """Axis-aligned rectangle [t0, t1] × [f0, f1] (seconds × Hz)."""

    t: tuple[float, float] = (0.0, 1.0)
    f: tuple[float, float] = (20.0, 20000.0)

    def signed_distance(self, T, P):
        ft = max(self.feather_s, 1e-9)
        fp = max(self.feather_oct, 1e-9)
        # A bound at or below 0 Hz means "include DC": map it to -∞ instead of clamping it to the
        # floor, otherwise the DC bin would sit exactly on the edge and get M = ½.
        p0 = np.log2(self.f[0]) if self.f[0] > 0 else -np.inf
        p1 = np.log2(self.f[1]) if self.f[1] > 0 else -np.inf
        # Distance to an axis-aligned box in the scaled plane (exact, including corners).
        dt = np.minimum(T - self.t[0], self.t[1] - T) / ft
        dp = np.minimum(P - p0, p1 - P) / fp
        inside = np.minimum(dt, dp)
        outside = -np.hypot(np.minimum(dt, 0), np.minimum(dp, 0))
        return np.where((dt >= 0) & (dp >= 0), inside, outside)


@dataclass(frozen=True)
class Polygon(_Shape):
    """Closed polygon (lasso) with vertices [(t, f), …] in seconds and Hz."""

    points: tuple[tuple[float, float], ...] = ()

    def signed_distance(self, T, P):
        if len(self.points) < 3:
            raise ValueError("a polygon needs at least 3 points")
        ft = max(self.feather_s, 1e-9)
        fp = max(self.feather_oct, 1e-9)
        vx = np.array([p[0] for p in self.points]) / ft
        vy = np.log2(np.maximum([p[1] for p in self.points], F_FLOOR)) / fp
        X, Y = T / ft, P / fp
        d2 = np.full(X.shape, np.inf)
        inside = np.zeros(X.shape, dtype=bool)
        for i in range(len(vx)):
            ax, ay, bx, by = vx[i - 1], vy[i - 1], vx[i], vy[i]
            ex, ey = bx - ax, by - ay
            seg = ex * ex + ey * ey
            u = np.clip(((X - ax) * ex + (Y - ay) * ey) / (seg if seg > 0 else 1.0), 0.0, 1.0)
            d2 = np.minimum(d2, (X - ax - u * ex) ** 2 + (Y - ay - u * ey) ** 2)
            # even-odd rule (ray casting toward +x)
            straddles = (ay > Y) != (by > Y)   # horizontal edges never straddle, so ey ≠ 0 below
            with np.errstate(divide="ignore", invalid="ignore"):
                x_cross = ax + (Y - ay) * ex / ey
            inside ^= straddles & (X < x_cross)
        d = np.sqrt(d2)
        return np.where(inside, d, -d)


@dataclass(frozen=True)
class Selection:
    """An ordered list of shapes for one layer."""

    shapes: tuple[_Shape, ...] = field(default_factory=tuple)

    def rasterize(self, times: np.ndarray, freqs: np.ndarray) -> np.ndarray:
        """Mask M(m, k) ∈ [0, 1] sampled at frame times (s) × bin frequencies (Hz)."""
        T, F = np.meshgrid(times, freqs, indexing="ij")
        P = np.log2(np.maximum(F, F_FLOOR))
        M = np.zeros(T.shape)
        for s in self.shapes:
            Ms = s.soft(T, P)
            M = M + (1 - M) * Ms if s.mode == "add" else M * (1 - Ms)
        return M

    @staticmethod
    def everything() -> "Selection":
        return Selection((Rect(t=(-1e9, 1e9), f=(0.0, 1e9), feather_s=0, feather_oct=0),))
