r"""Operations other than the sum (PLAN.md §3.3, §4.6).

They combine layers cell by cell, so they need ONE common time–frequency grid: each layer is
placed on the timeline (gain g, offset τ), analysed on that grid, masked by its selection, and
the masked spectra χ_i are combined before a single inverse STFT:

    max:      Y(m, k) = χ_{i*}(m, k),  i* = argmax_i |χ_i(m, k)|      (spectral collage)
    cross:    Y = |χ_A| · e^{i∠χ_B}                                    (body of A, motion of B)
    product:  Y = |χ_A| · χ_B                                          (A printed on B)

Cross and product use two layers, A and B. Masks are evaluated at t − τ_i (the selection moves
with its layer).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal

import numpy as np

from .mask import Selection
from .stft import Grid, bin_freqs, frame_times, istft, stft

Op = Literal["max", "cross", "product"]
COMMON_GRID = Grid("hann", 4096, 4096, 512)
_EPS = 1e-12


@dataclass
class OpLayer:
    audio: np.ndarray                          # (channels, samples), already transposed (Tape)
    selection: Selection = field(default_factory=Selection.everything)
    gain_db: float = 0.0
    offset_s: float = 0.0


def render_op(layers: list[OpLayer], op: Op, sr: int, a: int = 0, b: int = 1, grid: Grid = COMMON_GRID,
              channels: int = 2, normalize_dbfs: float | None = -0.3) -> np.ndarray:
    used = layers if op == "max" else [layers[a], layers[b]]
    starts = [int(np.floor(l.offset_s * sr + 0.5)) for l in used]   # round half up, like the UI
    length = max(s + np.atleast_2d(l.audio).shape[-1] for s, l in zip(starts, used))
    freqs = bin_freqs(grid, sr)
    spectra = []
    for s, l in zip(starts, used):
        x = np.atleast_2d(l.audio) * 10 ** (l.gain_db / 20)
        placed = np.zeros((x.shape[0], length))
        src = x[:, max(-s, 0):]
        placed[:, max(s, 0): max(s, 0) + src.shape[-1]] = src[:, : length - max(s, 0)]
        X = stft(placed, grid)                                          # (ch, M, B)
        M = l.selection.rasterize(frame_times(X.shape[-2], grid, sr) - l.offset_s, freqs)
        spectra.append(X * M)
    out = np.zeros((channels, length))
    for c in range(channels):
        S = [X[min(c, X.shape[0] - 1)] for X in spectra]
        if op == "max":
            mags = np.stack([Z.real ** 2 + Z.imag ** 2 for Z in S])   # same as the other engines
            best = np.argmax(mags, axis=0)
            Y = np.choose(best, S)
        else:
            A, B = S
            aMag, bMag = np.abs(A), np.abs(B)
            if op == "cross":
                Y = B * np.where(bMag > _EPS, aMag / np.where(bMag > _EPS, bMag, 1.0), 0.0)
            elif op == "product":
                Y = B * aMag
            else:
                raise ValueError(f"unknown operation {op}")
        out[c] = istft(Y, grid, length)
    if normalize_dbfs is not None:
        peak = np.max(np.abs(out)) if out.size else 0.0
        if peak > 0:
            out *= 10 ** (normalize_dbfs / 20) / peak
    return out
