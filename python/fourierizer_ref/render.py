r"""Per-layer synthesis (PLAN.md §4.2).

    y[n] = Σ_i g_i · ( ISTFT_i( M_i ⊙ STFT_i( T_i x_i ) ) )[n − τ_i F_s]

Each layer is analysed and resynthesized on its OWN grid (w_i, L_i, N_i, H_i), then the layers
are summed in the time domain. Because the ISTFT is linear, no coefficient matrices are ever
resampled or aligned (the v1 thesis notebook did that, which averaged complex coefficients of
different phases). Pitch (T_i) is applied before analysis, so the selection is drawn on what
you actually hear; the offset τ_i is a pure delay applied after synthesis.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

from .audio import tape_pitch
from .mask import Selection
from .stft import Grid, bin_freqs, frame_times, istft, stft


@dataclass
class Layer:
    audio: np.ndarray                 # (channels, samples) at the project sample rate
    grid: Grid = field(default_factory=Grid)
    selection: Selection = field(default_factory=Selection.everything)
    gain_db: float = 0.0
    offset_s: float = 0.0             # positive = later, negative = earlier (trims the start)
    pitch_st: float = 0.0             # Tape transposition in semitones

    def synthesize(self, sr: int) -> tuple[np.ndarray, np.ndarray]:
        """Return (masked resynthesis (ch, n), mask (frames, bins)) before gain and offset."""
        x = tape_pitch(np.atleast_2d(self.audio), self.pitch_st)
        X = stft(x, self.grid)
        M = self.selection.rasterize(frame_times(X.shape[-2], self.grid, sr), bin_freqs(self.grid, sr))
        return istft(X * M, self.grid, x.shape[-1]), M


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
