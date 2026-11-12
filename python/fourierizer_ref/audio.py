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


def tape_pitch(x: np.ndarray, semitones: float) -> np.ndarray:
    """'Tape' transposition: play faster/slower. +12 st → one octave up, half the duration."""
    if semitones == 0:
        return x
    r = 2.0 ** (semitones / 12.0)
    return resample(x, r, 1.0)  # sr_out / sr_in = 1/r → fewer samples when r > 1
