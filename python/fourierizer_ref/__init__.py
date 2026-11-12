"""Fourierizer reference engine.

The numerically careful, readable implementation of the synthesis described in
docs/plan/PLAN.md §4. The C++ core is tested against the outputs of this package.

    windows  - analysis windows w[n]
    stft     - STFT / least-squares ISTFT on a (window, L, N, H) grid
    mask     - resolution-independent selections in (seconds, Hz) rasterized to a grid
    render   - per-layer synthesis  y = Σ_i g_i · ISTFT_i(M_i ⊙ STFT_i(T_i x_i)) delayed by τ_i
    audio    - file I/O and band-limited resampling
"""

from .windows import WINDOWS, make_window
from .stft import Grid, stft, istft, nola_min, frame_times, bin_freqs
from .mask import Rect, Polygon, Selection
from .render import Layer, render

__all__ = [
    "WINDOWS", "make_window",
    "Grid", "stft", "istft", "nola_min", "frame_times", "bin_freqs",
    "Rect", "Polygon", "Selection",
    "Layer", "render",
]
