# Fourierizer

**Fourierizer** is a sound-design instrument built on the Short-Time Fourier Transform (STFT).
Load any audio files, look at their time–frequency coefficient matrices, select the parts you want
from each sound, and synthesize a brand-new sound from those selections — then play it on your keyboard.

> 🇲🇽 *¿Llegaste desde la tesis "Fourierizer: combinaciones de sonidos a través de la transformada de
> Fourier de tiempo corto" (ITAM, 2025)? El notebook original está en [`v1/`](v1/).*

## Status

| Version | What it is | Where |
|---|---|---|
| **v1** | Undergraduate thesis prototype: a Python/Jupyter notebook that combines rectangular STFT selections of two sounds | [`v1/`](v1/) |
| **v2** | *In development.* A VST3 instrument plugin (Windows & macOS) with up to 4 layers, multiple windows, freeform selections and a sampler engine | this repository |

## v2 at a glance

- **Up to 4 layers**, each with its own window (Hann, Blackman-Harris, Kaiser, Gauss, …), window length, FFT size and hop.
- **Freeform selections** on the spectrogram: rectangles, lasso, eraser, soft edges — defined in seconds and Hz, so they survive resolution changes.
- **Per-layer reconstruction**: each layer is resynthesized on its own time–frequency grid and summed in the time domain (no coefficient resampling).
- **Playable result**: polyphonic sampler with *Tape* (resampling) and *Spectral* (duration-preserving) keytracking modes.
- **Iterations**: feed a result back as a source for the next synthesis.

## Repository layout

```
core/      C++ synthesis engine (no framework dependency) + golden tests
plugin/    JUCE plugin: processor, sampler, engine service (renders, state), WebView editor
ui/        Web UI (TypeScript) used by the plugin and by the browser demo
python/    Reference implementation and golden test vectors
docs/      Plan, architecture decisions, learning notes, design, theory
v1/        Thesis version (notebook)
```

See [`docs/plan/PLAN.md`](docs/plan/PLAN.md) for the full plan (in Spanish).

## Author

Leopoldo Rodríguez Díaz Infante
