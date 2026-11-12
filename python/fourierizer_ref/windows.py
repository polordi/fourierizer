"""Analysis windows.

All windows are *periodic* (DFT-even): w has length L and is one period of a function with
period L, i.e. w[n] = f(n / L) for n = 0..L-1. Periodic windows are the right choice for
STFT analysis/synthesis because their overlap-add sums are exactly constant at the classic
hops (e.g. Hann at H = L/2 or L/4), whereas symmetric windows are not.
"""

from __future__ import annotations

from collections.abc import Callable

import numpy as np


def _cosine_sum(L: int, a: list[float]) -> np.ndarray:
    """Generalized cosine window: w[n] = Σ_k (-1)^k a_k cos(2πkn/L)."""
    n = np.arange(L)
    w = np.zeros(L)
    for k, ak in enumerate(a):
        w += (-1) ** k * ak * np.cos(2 * np.pi * k * n / L)
    return w


def rect(L: int) -> np.ndarray:
    return np.ones(L)


def hann(L: int) -> np.ndarray:
    return _cosine_sum(L, [0.5, 0.5])


def hamming(L: int) -> np.ndarray:
    return _cosine_sum(L, [0.54, 0.46])


def blackman_harris(L: int) -> np.ndarray:
    """4-term Blackman-Harris (−92 dB sidelobes)."""
    return _cosine_sum(L, [0.35875, 0.48829, 0.14128, 0.01168])


def flat_top(L: int) -> np.ndarray:
    """5-term flat-top (amplitude-accurate; very wide main lobe). Takes small negative values."""
    return _cosine_sum(L, [0.21557895, 0.41663158, 0.277263158, 0.083578947, 0.006947368])


def kaiser(L: int, beta: float = 8.0) -> np.ndarray:
    """Kaiser window I0(β√(1-(2n/L-1)²)) / I0(β). β trades main-lobe width for sidelobe level."""
    return np.kaiser(L + 1, beta)[:-1]


def gauss(L: int, sigma: float = 0.4) -> np.ndarray:
    """Gaussian window; sigma is the standard deviation relative to the half-length L/2."""
    n = np.arange(L)
    return np.exp(-0.5 * ((n - L / 2) / (sigma * L / 2)) ** 2)


WINDOWS: dict[str, Callable[..., np.ndarray]] = {
    "rect": rect,
    "hann": hann,
    "hamming": hamming,
    "blackman_harris": blackman_harris,
    "kaiser": kaiser,
    "gauss": gauss,
    "flat_top": flat_top,
}


def make_window(name: str, L: int, **params: float) -> np.ndarray:
    """Build window `name` of length L. Extra params: kaiser(beta=…), gauss(sigma=…)."""
    if name not in WINDOWS:
        raise ValueError(f"unknown window {name!r}; choose from {sorted(WINDOWS)}")
    if L < 2:
        raise ValueError("window length L must be at least 2")
    return WINDOWS[name](L, **params).astype(np.float64)
