"""Golden files: reference outputs that every other implementation (TypeScript UI engine,
C++ core) must reproduce. Run from python/:  .venv/Scripts/python golden/make_golden.py

Small sizes on purpose: the files are committed and read by the test suites.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from fourierizer_ref.windows import WINDOWS, make_window          # noqa: E402
from fourierizer_ref.stft import Grid                              # noqa: E402
from fourierizer_ref.mask import Rect, Polygon, Selection          # noqa: E402
from fourierizer_ref.render import Layer, render                   # noqa: E402
from fourierizer_ref.audio import resample_by_step                 # noqa: E402

OUT = Path(__file__).resolve().parent / "data"
SR = 8000


def arr(x: np.ndarray) -> list:
    return np.asarray(x, dtype=np.float64).tolist()


def shape_json(s) -> dict:
    base = {"mode": s.mode, "gain": s.gain, "featherS": s.feather_s, "featherOct": s.feather_oct,
            "fadeIn": s.fade_in, "fadeOut": s.fade_out}
    if isinstance(s, Rect):
        return {"kind": "rect", "t": list(s.t), "f": list(s.f), **base}
    return {"kind": "poly", "points": [list(p) for p in s.points], **base}


def grid_json(g: Grid) -> dict:
    return {"window": g.window, "L": g.L, "N": g.n_fft, "H": g.H}


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    rng = np.random.default_rng(2025)

    windows = {name: arr(make_window(name, 32)) for name in WINDOWS}
    (OUT / "windows.json").write_text(json.dumps({"L": 32, "windows": windows}))

    n = 4000
    t = np.arange(n) / SR
    x = (0.5 * np.sin(2 * np.pi * 440 * t) + 0.3 * np.sin(2 * np.pi * 1700 * t + 1.0)
         + 0.2 * rng.standard_normal(n))
    stereo = np.stack([x, np.roll(x, 37) * 0.8])

    sel = Selection((
        Rect(t=(0.05, 0.3), f=(200, 1500), feather_s=0.02, feather_oct=1 / 6),
        Polygon(points=((0.15, 300), (0.4, 2500), (0.45, 800)), mode="add", feather_s=0.015, feather_oct=1 / 12),
        Rect(t=(0.2, 0.25), f=(0, 600), mode="subtract", gain=0.8, feather_s=0.005, feather_oct=1 / 24),
    ))
    grids = [
        Grid("hann", 256, 512, 64),
        Grid("kaiser", 200, 256, 50),
        Grid("blackman_harris", 256, 256, 64),
        Grid("flat_top", 256, 256, 32),
        Grid("gauss", 128, 128, 32),
    ]
    cases = []
    for g in grids:
        y, M = Layer(stereo, g, sel).synthesize(SR)
        cases.append({"grid": grid_json(g), "y": [arr(c) for c in y]})
    layer_doc = {"sr": SR, "x": [arr(c) for c in stereo], "shapes": [shape_json(s) for s in sel.shapes], "cases": cases}
    (OUT / "layers.json").write_text(json.dumps(layer_doc))

    x2 = 0.4 * np.sin(2 * np.pi * 300 * t[:3000]) * np.exp(-t[:3000] * 3)
    layers = [
        Layer(stereo, grids[0], sel, gain_db=-3.0, offset_s=0.05),
        Layer(x2[None], grids[2], Selection((Rect(t=(0.0, 0.3), f=(100, 1000)),)), gain_db=0.0, offset_s=-0.02),
    ]
    mixed = render(layers, SR, channels=2, normalize_dbfs=-0.3)
    render_doc = {
        "sr": SR,
        "layers": [
            {"x": [arr(c) for c in stereo], "grid": grid_json(grids[0]), "shapes": [shape_json(s) for s in sel.shapes], "gainDb": -3.0, "offsetS": 0.05},
            {"x": [arr(x2)], "grid": grid_json(grids[2]), "shapes": [shape_json(s) for s in layers[1].selection.shapes], "gainDb": 0.0, "offsetS": -0.02},
        ],
        "y": [arr(c) for c in mixed],
    }
    (OUT / "render.json").write_text(json.dumps(render_doc))

    # Masks with time fades: a rectangle, a concave lasso and a faded eraser.
    fades = Selection((
        Rect(t=(0.1, 1.2), f=(80, 2000), feather_s=0.01, feather_oct=1 / 12, fade_in=0.15, fade_out=0.6),
        Polygon(points=((0.3, 300), (1.5, 400), (1.0, 900), (1.6, 3000), (0.5, 2500), (0.8, 1000)),
                feather_s=0.02, feather_oct=1 / 8, fade_in=0.0, fade_out=0.4),
        Rect(t=(0.6, 0.9), f=(500, 1500), mode="subtract", gain=0.9, feather_s=0.005, feather_oct=1 / 24,
             fade_in=0.1, fade_out=0.1),
    ))
    times = np.linspace(-0.1, 1.8, 77)
    freqs = np.concatenate([[0.0], np.geomspace(40, 6000, 90)])
    mask_doc = {"shapes": [shape_json(s) for s in fades.shapes], "times": arr(times), "freqs": arr(freqs),
                "M": arr(fades.rasterize(times, freqs))}
    (OUT / "masks.json").write_text(json.dumps(mask_doc))

    # Resampler: Tape transpositions and sample-rate conversions (import of 44.1 kHz files).
    xr = 0.6 * np.sin(2 * np.pi * 0.031 * np.arange(1500)) + 0.3 * rng.standard_normal(1500)
    steps = [2 ** (7 / 12), 2 ** (-5 / 12), 2.0, 44100 / 48000, 48000 / 44100]
    resample_doc = {"x": arr(xr), "cases": [{"step": s, "y": arr(resample_by_step(xr, s))} for s in steps]}
    (OUT / "resample.json").write_text(json.dumps(resample_doc))
    print("golden files written to", OUT)


if __name__ == "__main__":
    main()
