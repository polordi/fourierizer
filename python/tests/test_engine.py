"""Properties the engine must satisfy. Each test states the math it checks."""

import numpy as np
import pytest

from fourierizer_ref import Grid, Layer, Polygon, Rect, Selection, istft, nola_min, render, stft
from fourierizer_ref.audio import tape_pitch
from fourierizer_ref.windows import WINDOWS, make_window

SR = 48000
rng = np.random.default_rng(0)


# ---- windows ---------------------------------------------------------------------------
@pytest.mark.parametrize("name", sorted(WINDOWS))
def test_window_is_periodic_and_peaks_at_center(name):
    """w[n] = f(n/L) with period L: the center sample n = L/2 is the maximum (or flat)."""
    w = make_window(name, 1024)
    assert w.shape == (1024,)
    assert np.argmax(w) == 512 or np.allclose(w, w.max())


@pytest.mark.parametrize("name,H", [("hann", 512), ("hann", 256), ("hamming", 512), ("blackman_harris", 256), ("rect", 1024)])
def test_cola(name, H):
    """COLA: Σ_m w[n − mH] is constant for the classic (window, hop) pairs."""
    L = 1024
    w = make_window(name, L)
    s = np.zeros(H)
    for start in range(0, L, H):
        s += w[start:start + H]
    assert np.ptp(s) < 1e-9 * s.mean()


def test_nola_detects_impossible_hop():
    """Hann with H = L has Σ w² = 0 at the frame edges: no inverse exists."""
    assert nola_min(make_window("hann", 1024), 1024) < 1e-12
    with pytest.raises(ValueError, match="NOLA"):
        Grid("hann", L=1024, H=1024).validate()


# ---- STFT / ISTFT ----------------------------------------------------------------------
GRIDS = [
    Grid("hann", L=2048, H=512),
    Grid("hann", L=1000, N=4096, H=250),           # zero-padding, non power of two L
    Grid("blackman_harris", L=4096, H=1024),
    Grid("kaiser", L=1536, H=384, params={"beta": 8.0}),
    Grid("gauss", L=2048, H=256, params={"sigma": 0.4}),
    Grid("rect", L=1024, H=1024),
    Grid("flat_top", L=2048, H=256),
]


@pytest.mark.parametrize("grid", GRIDS, ids=lambda g: f"{g.window}-L{g.L}-N{g.n_fft}-H{g.H}")
def test_perfect_reconstruction(grid):
    """ISTFT(STFT(x)) = x for every grid that satisfies NOLA (least-squares inverse is exact)."""
    x = rng.standard_normal((2, 30011))
    y = istft(stft(x, grid), grid, x.shape[-1])
    assert np.max(np.abs(y - x)) < 1e-10


def test_bin_of_a_sinusoid():
    """A 1 kHz sine peaks at bin k = round(1000 · N / F_s)."""
    grid = Grid("hann", L=4096, H=1024)
    t = np.arange(SR) / SR
    X = stft(np.sin(2 * np.pi * 1000 * t), grid)
    assert np.argmax(np.abs(X[20])) == round(1000 * 4096 / SR)


# ---- masks -----------------------------------------------------------------------------
def test_hard_rect_mask_is_binary_inside_and_outside():
    sel = Selection((Rect(t=(0.5, 1.0), f=(200, 2000), feather_s=0, feather_oct=0),))
    M = sel.rasterize(np.array([0.2, 0.75, 1.5]), np.array([100.0, 1000.0, 5000.0]))
    assert M[1, 1] == 1.0 and M[0, 1] == 0.0 and M[1, 0] == 0.0 and M[1, 2] == 0.0 and M[2, 1] == 0.0


def test_feather_is_half_on_the_boundary():
    """The raised-cosine ramp is centered on the edge: M = ½ exactly at the boundary."""
    sel = Selection((Rect(t=(1.0, 2.0), f=(100, 10000), feather_s=0.05, feather_oct=0.1),))
    M = sel.rasterize(np.array([1.0, 1.5]), np.array([1000.0]))
    assert M[0, 0] == pytest.approx(0.5) and M[1, 0] == pytest.approx(1.0)


def test_subtract_and_order():
    """add then subtract carves a hole: M ← M·(1 − M_s)."""
    big = Rect(t=(0, 4), f=(50, 10000), feather_s=0, feather_oct=0)
    hole = Rect(t=(1, 2), f=(400, 800), mode="subtract", feather_s=0, feather_oct=0)
    M = Selection((big, hole)).rasterize(np.array([0.5, 1.5]), np.array([600.0]))
    assert M[0, 0] == 1.0 and M[1, 0] == 0.0


def test_polygon_matches_rect():
    """A 4-vertex polygon equals the rectangle with the same corners (hard edges)."""
    t, f = (0.5, 1.5), (200.0, 3000.0)
    rect = Rect(t=t, f=f, feather_s=0, feather_oct=0)
    poly = Polygon(points=((t[0], f[0]), (t[1], f[0]), (t[1], f[1]), (t[0], f[1])), feather_s=1e-6, feather_oct=1e-6)
    times, freqs = np.linspace(0, 2, 101), np.geomspace(50, 10000, 97)
    a, b = Selection((rect,)).rasterize(times, freqs), Selection((poly,)).rasterize(times, freqs)
    assert np.mean(a != b) < 0.01  # only boundary samples may differ


# ---- rendering -------------------------------------------------------------------------
def test_full_selection_reproduces_input():
    x = rng.standard_normal((2, 20000))
    y = render([Layer(audio=x, grid=Grid("hann", L=2048, H=512))], SR, normalize_dbfs=None)
    assert np.max(np.abs(y - x)) < 1e-10


def test_layers_on_different_grids_sum_linearly():
    """Different windows/resolutions per layer, summed in time (no matrix resampling)."""
    a, b = rng.standard_normal((2, 15000)), rng.standard_normal((2, 15000))
    la = Layer(audio=a, grid=Grid("hann", L=4096, H=1024))
    lb = Layer(audio=b, grid=Grid("blackman_harris", L=512, H=128), gain_db=-6)
    y = render([la, lb], SR, normalize_dbfs=None)
    assert np.max(np.abs(y - (a + b * 10 ** (-6 / 20)))) < 1e-10


def test_offset_delays_and_advances():
    x = np.zeros((1, 1000)); x[0, 100] = 1.0
    late = render([Layer(audio=x, offset_s=50 / SR, grid=Grid("rect", L=64, H=64))], SR, channels=1, normalize_dbfs=None)
    early = render([Layer(audio=x, offset_s=-50 / SR, grid=Grid("rect", L=64, H=64))], SR, channels=1, normalize_dbfs=None)
    assert np.argmax(late[0]) == 150 and np.argmax(early[0]) == 50


def test_trim_removes_trailing_silence_only():
    x = np.zeros((1, 10000)); x[0, 1000:3000] = rng.standard_normal(2000)
    y = render([Layer(audio=x, grid=Grid("hann", L=256, H=64))], SR, channels=1, normalize_dbfs=None, trim_db=-80)
    assert 2990 <= y.shape[-1] <= 3300 and np.allclose(y[0, :1000], 0, atol=1e-9)


def test_tape_pitch_octave_up_halves_length_and_doubles_frequency():
    t = np.arange(SR) / SR
    y = tape_pitch(np.sin(2 * np.pi * 440 * t)[None], 12)
    assert abs(y.shape[-1] - SR // 2) <= 1
    spectrum = np.abs(np.fft.rfft(y[0] * np.hanning(y.shape[-1])))
    assert abs(np.argmax(spectrum) * SR / y.shape[-1] - 880) < 3


def test_band_selection_removes_out_of_band_energy():
    """Selecting 900–1100 Hz from 440 Hz + 1 kHz keeps the 1 kHz tone and drops 440 Hz."""
    t = np.arange(SR) / SR
    x = (np.sin(2 * np.pi * 440 * t) + np.sin(2 * np.pi * 1000 * t))[None]
    sel = Selection((Rect(t=(0, 1), f=(900, 1100), feather_s=0, feather_oct=1 / 24),))
    y = render([Layer(audio=x, grid=Grid("hann", L=4096, H=1024), selection=sel)], SR, channels=1, normalize_dbfs=None)
    seg = y[0, SR // 4: 3 * SR // 4] * np.hanning(SR // 2)
    S = np.abs(np.fft.rfft(seg))
    f = np.fft.rfftfreq(SR // 2, 1 / SR)
    assert S[np.argmin(abs(f - 1000))] > 1000 * S[np.argmin(abs(f - 440))]
