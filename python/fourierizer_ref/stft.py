r"""Short-time Fourier transform and its least-squares inverse.

Conventions (PLAN.md §4.1). A grid is (w, L, N, H): window w of length L, FFT size N ≥ L
(frames are zero-padded from L to N), hop H. The signal is padded with L//2 zeros at the
start ("centered" frames), so frame m is centered at time t_m = m·H / F_s and

    χ(m, k) = Σ_{n=0}^{L-1} x̃[n + mH] w[n] e^{-2πi k n / N},   k = 0 … N/2,

where x̃ is the padded signal. Bin k sits at f_k = k·F_s / N.

The inverse is the least-squares estimate of Griffin & Lim (1984): given any array Y (not
necessarily a valid STFT, e.g. a masked one), it returns the signal whose STFT is closest to
Y in the Frobenius norm,

    x̂[n] = Σ_m w[n - mH] · y_m[n - mH]  /  Σ_m w²[n - mH],    y_m = IDFT_N(Y_m)[0:L].

It exists iff the denominator never vanishes (NOLA). For an unmodified STFT it is exact.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

from .windows import make_window

_EPS = 1e-10


@dataclass(frozen=True)
class Grid:
    """An STFT analysis/synthesis grid."""

    window: str = "hann"
    L: int = 2048
    N: int | None = None          # FFT size; defaults to L
    H: int = 512
    params: dict = field(default_factory=dict)  # e.g. {"beta": 8.0} for kaiser

    @property
    def n_fft(self) -> int:
        return self.N if self.N is not None else self.L

    def w(self) -> np.ndarray:
        return make_window(self.window, self.L, **self.params)

    def validate(self) -> None:
        if self.n_fft < self.L:
            raise ValueError(f"FFT size N={self.n_fft} must be ≥ window length L={self.L}")
        if not (1 <= self.H <= self.L):
            raise ValueError(f"hop H={self.H} must satisfy 1 ≤ H ≤ L={self.L}")
        if nola_min(self.w(), self.H) <= _EPS:
            raise ValueError(f"{self.window} window with L={self.L}, H={self.H} violates NOLA; "
                             "the inverse STFT does not exist (reduce the hop)")


def nola_min(w: np.ndarray, H: int) -> float:
    """min_n Σ_m w²[n - mH] over one period: NOLA holds iff this is > 0."""
    L = len(w)
    acc = np.zeros(H)
    for start in range(0, L, H):
        seg = w[start:start + H] ** 2
        acc[: len(seg)] += seg
    return float(acc.min())


def _pad(x: np.ndarray, grid: Grid) -> tuple[np.ndarray, int, int]:
    """Center-pad x (…, n) and pad the end so the last frame is complete."""
    L, H = grid.L, grid.H
    left = L // 2
    n = x.shape[-1]
    n_frames = 1 + int(np.ceil(max(n + left - L // 2, 0) / H))      # frames whose center ≤ end
    total = (n_frames - 1) * H + L
    right = total - n - left
    pad = [(0, 0)] * (x.ndim - 1) + [(left, right)]
    return np.pad(x, pad), left, n_frames


def stft(x: np.ndarray, grid: Grid) -> np.ndarray:
    """STFT of x with shape (…, n) → complex array (…, frames, N/2+1)."""
    grid.validate()
    x = np.asarray(x, dtype=np.float64)
    w = grid.w()
    xp, _, M = _pad(x, grid)
    idx = np.arange(grid.L)[None, :] + grid.H * np.arange(M)[:, None]   # (M, L)
    frames = xp[..., idx] * w                                           # (…, M, L)
    return np.fft.rfft(frames, n=grid.n_fft, axis=-1)


def istft(X: np.ndarray, grid: Grid, length: int) -> np.ndarray:
    """Least-squares inverse STFT of X (…, frames, N/2+1) → real signal (…, length)."""
    grid.validate()
    w = grid.w()
    L, H = grid.L, grid.H
    M = X.shape[-2]
    frames = np.fft.irfft(X, n=grid.n_fft, axis=-1)[..., :L] * w        # (…, M, L)
    total = (M - 1) * H + L
    y = np.zeros(X.shape[:-2] + (total,))
    wsum = np.zeros(total)
    for m in range(M):
        y[..., m * H: m * H + L] += frames[..., m, :]
        wsum[m * H: m * H + L] += w ** 2
    y /= np.where(wsum > _EPS, wsum, 1.0)
    left = L // 2
    out = y[..., left: left + length]
    if out.shape[-1] < length:   # signal shorter than requested: pad with silence
        out = np.pad(out, [(0, 0)] * (out.ndim - 1) + [(0, length - out.shape[-1])])
    return out


def frame_times(n_frames: int, grid: Grid, sr: float) -> np.ndarray:
    """Center time of each frame, in seconds."""
    return np.arange(n_frames) * grid.H / sr


def bin_freqs(grid: Grid, sr: float) -> np.ndarray:
    """Frequency of each bin, in Hz."""
    return np.arange(grid.n_fft // 2 + 1) * sr / grid.n_fft
