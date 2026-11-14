r"""Spectral pitch shift: change the pitch, keep the duration (the instrument's "Spectral" mode).

Two steps, both band-limited:

1. **Time stretch by r = 2^(s/12)** with a phase vocoder. Synthesis frames sit every H output
   samples; frame j reads the input centred at round(j·H/r). Each bin's phase must advance by
   ω_k·H between frames, where ω_k is the bin's *instantaneous frequency*. ω_k is measured
   from a second analysis frame δ samples earlier, so it stays exact whatever the analysis
   hop H/r is:

       ω_k = 2πk/N + princarg(∠X_k(a) − ∠X_k(a−δ) − 2πkδ/N) / δ.

2. **Resample by r** with the Kaiser-sinc resampler (audio.resample_by_step): the stretched
   signal is r times longer and is read r times faster, so the duration comes back and every
   frequency is multiplied by r.

Phase vocoders smear ("phasiness") because each bin's phase drifts on its own. Two fixes:

* **Identity phase locking** (Laroche & Dolson, 1999). Only spectral peaks are propagated
  with ω_k·H; every other bin keeps its *analysis* phase relation to the nearest peak, i.e.
  it is rotated by the same angle θ as its peak. The sinusoid's main lobe stays coherent.
* **Stereo linking.** Phases are computed once, on the mid signal (sum of the channels), and
  the same rotation e^{iθ_k} is applied to every channel, so inter-channel phase differences
  (the stereo image) are kept.

Attacks are the weak spot: a frame that straddles an attack spreads it over the whole window
(pre-echo). The window size is therefore the user's choice (WINDOWS): 4096 keeps pads and
chords smooth, 1024 keeps drums tight (pre-echo −21 dB vs −39 dB on a click train at +7 st).

The C++ core (core/src/spectral.cpp) produces the output progressively in chunks and must
match this function to ~1e-9; so must the TypeScript port (ui/src/dsp/spectral.ts).
"""

from __future__ import annotations

import numpy as np

from .audio import resample_by_step
from .windows import hann

WINDOWS = {"tonal": 4096, "mixed": 2048, "punchy": 1024}   # at 48 kHz: 85 / 43 / 21 ms
N_FFT = 4096        # default window; hop and δ are N/8 (overlap 8)
PEAK_FLOOR = 1e-6   # peaks must be within −120 dB of the frame's loudest bin
SILENCE = 1e-9      # a frame whose loudest bin is below this is silent (phases reset)


def princarg(x: np.ndarray | float) -> np.ndarray | float:
    """Wrap an angle to [−π, π)."""
    return x - 2 * np.pi * np.floor((x + np.pi) / (2 * np.pi))


def find_peaks(mag: np.ndarray, floor: float) -> np.ndarray:
    """Bins that beat their two neighbours on each side (strictly on the left, ≥ on the right)."""
    B = len(mag)
    ok = mag > floor
    for d in (1, 2):
        left = np.full(B, True)
        left[d:] = mag[d:] > mag[:-d]
        right = np.full(B, True)
        right[:-d] = mag[:-d] >= mag[d:]
        ok &= left & right
    return np.flatnonzero(ok)


def owners(peaks: np.ndarray, B: int) -> np.ndarray:
    """Nearest peak of every bin; a bin exactly halfway goes to the lower peak."""
    k = np.arange(B)
    bounds = (peaks[:-1] + peaks[1:]) // 2          # last bin owned by peaks[i]
    return peaks[np.searchsorted(bounds, k, side="left")]


def _segment(sig: np.ndarray, centre: int, w: np.ndarray) -> np.ndarray:
    n = len(w)
    seg = np.zeros(n)
    lo = centre - n // 2
    s0, s1 = max(lo, 0), min(lo + n, len(sig))
    if s1 > s0:
        seg[s0 - lo:s1 - lo] = sig[s0:s1]
    return seg * w


def stretch_frames(semitones: float, length: int, n: int = N_FFT):
    """Ratio r, stretched length M and frame indices j0..j1 (frame j is centred at j·N/8)."""
    hop = n // 8
    r = 2.0 ** (semitones / 12.0)
    M = int(np.ceil(length * r))
    j0 = -(n // 2) // hop + 1
    j1 = (M - 1 + n // 2) // hop
    return r, M, j0, j1


def spectral_pitch(x: np.ndarray, semitones: float, n: int = N_FFT) -> np.ndarray:
    """Shift (channels, samples) by `semitones` keeping the length. Returns (channels, samples)."""
    x = np.atleast_2d(np.asarray(x, dtype=np.float64))
    if semitones == 0:
        return x.copy()
    C, L = x.shape
    hop = delta = n // 8
    r, M, j0, j1 = stretch_frames(semitones, L, n)
    ha = hop / r
    w = hann(n)
    B = n // 2 + 1
    k = np.arange(B)
    omega_bin = 2 * np.pi * k / n
    mono = x.sum(axis=0) if C > 1 else x[0]
    norm = float(np.sum(w * w)) / hop

    def centre(j: int) -> int:
        return int(np.floor(j * ha + 0.5))

    y = np.zeros((C, M))
    phi = np.zeros(B)
    for j in range(j0, j1 + 1):
        a = centre(j)
        ref = np.fft.rfft(_segment(mono, a, w))
        mag, ph = np.abs(ref), np.angle(ref)
        peak = float(mag.max())
        if j == j0 or peak < SILENCE:   # nothing to continue from: take the analysis phases
            theta = np.zeros(B)
        else:
            prev = np.fft.rfft(_segment(mono, a - delta, w))
            omega = omega_bin + princarg(ph - np.angle(prev) - omega_bin * delta) / delta
            prop = princarg(phi + hop * omega)
            pk = find_peaks(mag, PEAK_FLOOR * peak)
            theta = prop - ph
            if len(pk):
                theta = theta[owners(pk, B)]
        phi = princarg(ph + theta)
        rot = np.exp(1j * theta)
        lo = j * hop - n // 2
        s0, s1 = max(lo, 0), min(lo + n, M)
        for c in range(C):
            X = np.fft.rfft(_segment(x[c], a, w))
            frame = np.fft.irfft(X * rot, n) * w
            if s1 > s0:
                y[c, s0:s1] += frame[s0 - lo:s1 - lo]
    y /= norm

    out = np.zeros((C, L))
    for c in range(C):
        z = resample_by_step(y[c], r)[:L]
        out[c, :len(z)] = z
    return out
