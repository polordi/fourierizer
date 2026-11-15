r"""Per-layer synthesis (PLAN.md §4.2).

    y[n] = Σ_i g_i · ( ISTFT_i( M_i ⊙ STFT_i( T_i x_i ) ) )[n − τ_i F_s]

Each layer is analysed and resynthesized on its OWN grid (w_i, L_i, N_i, H_i), then the layers
are summed in the time domain. Because the ISTFT is linear, no coefficient matrices are ever
resampled or aligned (the v1 thesis notebook did that, which averaged complex coefficients of
different phases). Pitch (T_i) is applied before analysis, so the selection is drawn on what
you actually hear; the offset τ_i is a pure delay applied after synthesis.

Multiresolution (PLAN.md §3.4). A layer can be resynthesized on three grids instead of one: the
lows on a window 4× longer than the layer's (frequency detail), the mids on the layer's own and
the highs on one 4× shorter (time detail). Each band b is the same masked resynthesis on its grid
with the selection multiplied by a frequency weight w_b(f):

    y = Σ_b ISTFT_b( (M · w_b) ⊙ STFT_b(x) ),    w_low + w_mid + w_high = 1,

where the weights cross over with a raised cosine in log f, one octave wide, centred on
MULTIRES_SPLITS. Without a selection limit (M = 1) the bands add back up to x.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

from .audio import tape_pitch
from .mask import F_FLOOR, Selection
from .stft import Grid, bin_freqs, frame_times, istft, stft

MULTIRES_SPLITS = (300.0, 3000.0)   # Hz: low | mid | high
MULTIRES_WIDTH = 1.0                # octaves of each crossover
MULTIRES_FACTORS = (4.0, 1.0, 0.25) # window size of each band relative to the layer's
MULTIRES_MIN_N, MULTIRES_MAX_N = 128, 32768


def band_weights(freqs: np.ndarray) -> list[np.ndarray]:
    """w_low, w_mid, w_high at each frequency (they sum to 1)."""
    P = np.log2(np.maximum(freqs, F_FLOOR))

    def rise(fc: float) -> np.ndarray:
        u = np.clip((P - np.log2(fc)) / MULTIRES_WIDTH + 0.5, 0.0, 1.0)
        return 0.5 - 0.5 * np.cos(np.pi * u)

    r1, r2 = rise(MULTIRES_SPLITS[0]), rise(MULTIRES_SPLITS[1])
    return [1.0 - r1, r1 - r2, r2]


def band_grid(grid: Grid, factor: float) -> Grid:
    """The layer's grid scaled by `factor` (same window, zero-padding ratio and overlap)."""
    rnd = lambda v: int(np.floor(v + 0.5))   # the same rounding as the TS and C++ engines
    N = int(min(MULTIRES_MAX_N, max(MULTIRES_MIN_N, rnd(grid.n_fft * factor))))
    scale = N / grid.n_fft
    return Grid(grid.window, max(2, rnd(grid.L * scale)), N, max(1, rnd(grid.H * scale)), dict(grid.params))


@dataclass
class Layer:
    audio: np.ndarray                 # (channels, samples) at the project sample rate
    grid: Grid = field(default_factory=Grid)
    selection: Selection = field(default_factory=Selection.everything)
    gain_db: float = 0.0
    offset_s: float = 0.0             # positive = later, negative = earlier (trims the start)
    pitch_st: float = 0.0             # Tape transposition in semitones
    multires: bool = False            # three bands on three grids (see the module docstring)

    def synthesize(self, sr: int) -> tuple[np.ndarray, np.ndarray]:
        """Return (masked resynthesis (ch, n), mask (frames, bins)) before gain and offset.
        With multires, the mask returned is the mid band's (on the layer's own grid)."""
        x = tape_pitch(np.atleast_2d(self.audio), self.pitch_st)
        if not self.multires:
            X = stft(x, self.grid)
            M = self.selection.rasterize(frame_times(X.shape[-2], self.grid, sr), bin_freqs(self.grid, sr))
            return istft(X * M, self.grid, x.shape[-1]), M
        y = np.zeros(x.shape)
        M_mid = None
        for factor, w_fn in zip(MULTIRES_FACTORS, range(3)):
            g = band_grid(self.grid, factor)
            X = stft(x, g)
            freqs = bin_freqs(g, sr)
            M = self.selection.rasterize(frame_times(X.shape[-2], g, sr), freqs) * band_weights(freqs)[w_fn][None, :]
            y = y + istft(X * M, g, x.shape[-1])
            if factor == 1.0:
                M_mid = M
        return y, M_mid


def _place(y: np.ndarray, offset: int) -> tuple[np.ndarray, int]:
    """Shift by `offset` samples: returns the (possibly trimmed) signal and its start index ≥ 0."""
    if offset >= 0:
        return y, offset
    return y[..., -offset:], 0


def render(layers: list[Layer], sr: int, channels: int = 2, normalize_dbfs: float | None = -0.3,
           trim_db: float | None = None) -> np.ndarray:
    """Synthesize all layers and sum them → (channels, samples).

    trim_db: if set (e.g. -80), drop the trailing tail that stays below that level relative to
    the peak (what remains after the selections end).
    """
    parts = []
    for layer in layers:
        y, _ = layer.synthesize(sr)
        if y.shape[0] != channels:  # mono → stereo (or fold to mono)
            y = np.repeat(y[:1], channels, axis=0) if y.shape[0] == 1 else y.mean(axis=0, keepdims=True).repeat(channels, 0)
        y = y * 10 ** (layer.gain_db / 20)
        parts.append(_place(y, int(round(layer.offset_s * sr))))
    length = max((start + y.shape[-1] for y, start in parts), default=0)
    out = np.zeros((channels, length))
    for y, start in parts:
        out[:, start:start + y.shape[-1]] += y
    if trim_db is not None and out.size:
        level = np.max(np.abs(out), axis=0)
        above = np.nonzero(level > level.max() * 10 ** (trim_db / 20))[0]
        out = out[:, : (above[-1] + 1 if above.size else 0)]
    if normalize_dbfs is not None:
        peak = np.max(np.abs(out)) if out.size else 0.0
        if peak > 0:
            out *= 10 ** (normalize_dbfs / 20) / peak
    return out
