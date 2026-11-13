"""Audio I/O and band-limited resampling."""

from __future__ import annotations

from fractions import Fraction
from pathlib import Path

import numpy as np
import soundfile as sf
from scipy.signal import resample_poly


def load(path: str | Path, sr: int) -> np.ndarray:
    """Read a file as float64 (channels, samples), resampled to `sr`."""
    data, file_sr = sf.read(str(path), dtype="float64", always_2d=True)
    x = data.T
    return resample(x, file_sr, sr) if file_sr != sr else x


def save(path: str | Path, x: np.ndarray, sr: int) -> None:
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    sf.write(str(path), np.atleast_2d(x).T, sr, subtype="FLOAT")


def resample(x: np.ndarray, sr_in: float, sr_out: float) -> np.ndarray:
    """Polyphase (windowed-sinc) resampling along the last axis by sr_out/sr_in."""
    ratio = Fraction(sr_out / sr_in).limit_denominator(2000)
    if ratio == 1:
        return x
    return resample_poly(x, ratio.numerator, ratio.denominator, axis=-1)


# ---- Kaiser-windowed sinc resampler (the one the instrument uses) ---------------------------
# Output sample j reads the input at position j·step through a sinc low-passed at the new
# Nyquist (when step > 1), windowed by a Kaiser of 24 zero crossings and read from a table with
# linear interpolation. The TypeScript and C++ engines implement exactly this.
ZERO_CROSSINGS = 24
STEPS = 512      # table points per zero crossing
BETA = 8.0


def _bessel_i0(x: np.ndarray | float) -> np.ndarray:
    """Modified Bessel function I₀ by its power series (same terms as the other engines)."""
    x = np.asarray(x, dtype=np.float64)
    total, term = np.ones_like(x), np.ones_like(x)
    for k in range(1, 200):
        term = term * (x / (2 * k)) ** 2
        total = total + term
        if np.all(term < total * 1e-17):
            break
    return total


def _kernel_table() -> np.ndarray:
    v = np.arange(ZERO_CROSSINGS * STEPS + 2) / STEPS
    with np.errstate(invalid="ignore", divide="ignore"):
        sinc = np.where(v == 0, 1.0, np.sin(np.pi * v) / (np.pi * v))
    r = v / ZERO_CROSSINGS
    win = _bessel_i0(BETA * np.sqrt(np.clip(1 - r * r, 0, None))) / _bessel_i0(BETA)
    return np.where(r >= 1, 0.0, sinc * win)


_TABLE = _kernel_table()


def resample_by_step(x: np.ndarray, step: float) -> np.ndarray:
    """Resample along the last axis so that output j reads input position j·step."""
    x = np.atleast_1d(np.asarray(x, dtype=np.float64))
    if x.ndim > 1:
        return np.stack([resample_by_step(c, step) for c in x])
    n, t = x.shape[-1], _TABLE
    fc = min(1.0, 1.0 / step)
    reach = ZERO_CROSSINGS / fc
    out_len = int(np.ceil(n / step))
    y = np.zeros(out_len)
    width = int(np.ceil(2 * reach)) + 3
    for a in range(0, out_len, 2048):
        j = np.arange(a, min(out_len, a + 2048))
        pos = j * step
        base = np.ceil(pos - reach)
        k = base[:, None] + np.arange(width)[None, :]
        k0 = np.maximum(0, base)[:, None]
        k1 = np.minimum(n - 1, np.floor(pos + reach))[:, None]
        valid = (k >= k0) & (k <= k1)
        v = np.abs(pos[:, None] - k) * fc * STEPS
        i = np.floor(v).astype(np.int64)
        valid &= i < len(t) - 1
        i = np.where(valid, i, 0)
        f = v - i
        kern = t[i] + (t[i + 1] - t[i]) * f
        xs = x[np.clip(k, 0, n - 1).astype(np.int64)]
        y[j] = np.sum(np.where(valid, xs * kern, 0.0), axis=1) * fc
    return y


def resample_rate(x: np.ndarray, sr_in: float, sr_out: float) -> np.ndarray:
    """Sample-rate conversion with the instrument's resampler (used when importing files)."""
    return x if sr_in == sr_out else resample_by_step(x, sr_in / sr_out)


def tape_pitch(x: np.ndarray, semitones: float) -> np.ndarray:
    """'Tape' transposition: play faster/slower. +12 st → one octave up, half the duration."""
    if semitones == 0:
        return x
    return resample_by_step(x, 2.0 ** (semitones / 12.0))
