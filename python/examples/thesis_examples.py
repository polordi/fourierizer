"""Re-create the 8 examples of the v1 thesis with the v2 engine.

Same sounds, windows sizes, hops and rectangular selections as the thesis notebook
(v1/Fourierizer Notebook.ipynb, "Pruebas"), but synthesized the v2 way: each layer on its own
grid, soft-edged masks, summed in the time domain. Each selection is moved to start at t = 0,
as the thesis results did.

    python examples/thesis_examples.py [--hard]

Needs the thesis sounds in v1/Documentadas/ (kept out of git). Writes WAVs and spectrogram
figures to build/python-out/thesis/.
"""

from __future__ import annotations

import argparse
from dataclasses import dataclass
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
from matplotlib.colors import LinearSegmentedColormap

from fourierizer_ref import Grid, Layer, Rect, Selection, render, stft
from fourierizer_ref.audio import load, save
from fourierizer_ref.stft import bin_freqs, frame_times

REPO = Path(__file__).resolve().parents[2]
SOUNDS = REPO / "v1" / "Documentadas"
OUT = REPO / "build" / "python-out" / "thesis"
SR = 44100  # the thesis used 44.1 kHz throughout

# Layer colors from the design system (display → layer → layer-deep).
LAYER_RAMPS = [("#FFFFFF", "#F28C28", "#B85A00"), ("#FFFFFF", "#10A04A", "#0B7A36"), ("#FFFFFF", "#16181A", "#16181A")]


@dataclass
class Sel:
    file: str
    L: int
    H: int
    start: float
    dur: float
    fmin: float
    fmax: float


# (name, layer 1, layer 2) — parameters copied from the notebook calls.
EXAMPLES = [
    ("fourierized kick", Sel("Kick Acústico.wav", 8000, 2000, 0, 0.6, 200, 8000), Sel("Kick Distorsionado.wav", 4000, 1000, 0, 2.8, 20, 200)),
    ("fourierized lead", Sel("Lead Piano.wav", 1000, 250, 0, 3.8, 120, 1050), Sel("Lead Sintetizador.wav", 4000, 1000, 0, 4.2, 500, 8200)),
    ("fourierized snare", Sel("Snare Agresivo.wav", 2000, 1000, 0, 0.3, 50, 550), Sel("Snare Agudo.wav", 4000, 500, 0, 0.2, 200, 16300)),
    ("fourierized pad", Sel("Pad Grave.wav", 4000, 500, 0, 16, 60, 500), Sel("Pad Tranquilo.wav", 1000, 500, 0, 16, 700, 4000)),
    ("fourierized pluck", Sel("Pluck Campana.wav", 4000, 500, 0, 4.5, 0, 200), Sel("Pluck Sintetizador.wav", 1000, 125, 0, 3.0, 200, 4000)),
    ("fourierized kicksynth", Sel("Kick Distorsionado.wav", 6000, 1500, 0, 2.7, 0, 120), Sel("Lead Sintetizador.wav", 2000, 500, 0, 4.2, 50, 4000)),
    ("fourierized attack pad", Sel("Pluck Campana.wav", 1000, 500, 0, 4.2, 70, 600), Sel("Pad Tranquilo.wav", 2000, 500, 0.3, 16.0, 400, 4000)),
    ("fourierized percussion", Sel("Kick Acústico.wav", 6000, 300, 0, 0.8, 0, 120), Sel("Snare Agudo.wav", 6000, 300, 0, 0.2, 200, 8000)),
]


def make_layer(s: Sel, hard: bool) -> Layer:
    feather_s, feather_oct = (0.0, 0.0) if hard else (0.01, 1 / 12)
    rect = Rect(t=(s.start, s.start + s.dur), f=(s.fmin, s.fmax), feather_s=feather_s, feather_oct=feather_oct)
    return Layer(audio=load(SOUNDS / s.file, SR), grid=Grid("hann", L=s.L, H=s.H),
                 selection=Selection((rect,)), offset_s=-s.start)


def spectrogram(ax, x: np.ndarray, grid: Grid, ramp, title: str, sel: Sel | None = None):
    X = stft(x.mean(axis=0), grid)
    t, f = frame_times(X.shape[0], grid, SR), bin_freqs(grid, SR)
    db = 20 * np.log10(np.abs(X).T + 1e-9)
    db = np.clip(db - db.max(), -80, 0)
    cmap = LinearSegmentedColormap.from_list("layer", [(0, ramp[0]), (0.6, ramp[1]), (1, ramp[2])])
    ax.pcolormesh(t, np.maximum(f, 20), (db + 80) / 80, cmap=cmap, shading="auto", vmin=0, vmax=1)
    ax.set_yscale("log"); ax.set_ylim(30, SR / 2); ax.set_title(title, fontsize=9, loc="left")
    ax.set_xlabel("s", fontsize=8); ax.tick_params(labelsize=7)
    if sel:
        ax.add_patch(plt.Rectangle((sel.start, max(sel.fmin, 30)), sel.dur, sel.fmax - max(sel.fmin, 30),
                                   fill=False, ls="--", lw=1.2, ec="#16181A"))


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--hard", action="store_true", help="binary masks, like the thesis (no feather)")
    args = ap.parse_args()
    if not SOUNDS.exists():
        raise SystemExit(f"Thesis sounds not found in {SOUNDS} (they are kept out of git).")
    suffix = " (hard)" if args.hard else ""
    for name, s1, s2 in EXAMPLES:
        l1, l2 = make_layer(s1, args.hard), make_layer(s2, args.hard)
        y = render([l1, l2], SR, trim_db=-80)
        save(OUT / f"{name}{suffix}.wav", y, SR)

        fig, axes = plt.subplots(1, 3, figsize=(13, 3.6), sharey=True, constrained_layout=True)
        spectrogram(axes[0], l1.audio, l1.grid, LAYER_RAMPS[0], f"L1 · {s1.file} · Hann L={s1.L} H={s1.H}", s1)
        spectrogram(axes[1], l2.audio, l2.grid, LAYER_RAMPS[1], f"L2 · {s2.file} · Hann L={s2.L} H={s2.H}", s2)
        spectrogram(axes[2], y, Grid("hann", L=2048, H=512), LAYER_RAMPS[2], f"Result · {name}{suffix}")
        axes[0].set_ylabel("Hz", fontsize=8)
        fig.savefig(OUT / f"{name}{suffix}.png", dpi=110)
        plt.close(fig)
        print(f"✓ {name}{suffix}: {y.shape[-1] / SR:.2f} s")


if __name__ == "__main__":
    main()
