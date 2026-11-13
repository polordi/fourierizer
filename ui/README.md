# Fourierizer UI

The instrument's interface, written once for two hosts:

- **Browser demo** (claude.ai artifact): the engine runs in a Web Worker (`src/worker.ts`).
- **Plugin** (JUCE 8 WebView): the same page, with the engine requests answered by the C++ core
  through the JUCE bridge (milestone H5). The UI only talks to the `Host` interface in `src/host.ts`.

## Layout

```
src/
  dsp/        TypeScript engine: FFT, windows, STFT/ISTFT, masks, render, operations, spectrogram
  view/       controls (Knob, Stepper, Segmented, Fader) and the layer module (grid ↔ focus)
  audio/      browser sampler (Tape keytracking, ADSR)
  main.ts     app state, layout, render scheduling, keyboard and MIDI
  worker.ts   engine worker; protocol.ts holds its messages
test/         engine tests against python/golden/data (Python is the reference)
```

## Commands

```
npm install
npm test          # TypeScript engine must match the Python reference to 1e-9
npm run typecheck
npm run build     # → dist/index.html (plugin) and dist/artifact.html (demo), single files
```

To regenerate the golden files after changing the Python reference:
`python/.venv/Scripts/python python/golden/make_golden.py`.
