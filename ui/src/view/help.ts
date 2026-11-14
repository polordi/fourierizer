// One-line explanations for the controls that are not self-evident. Kept together so the wording
// stays consistent (and can be translated in one place). A second line, after "\n", says how to
// operate the control; the tooltip shows it muted.

import type { WindowName } from "../dsp/windows.ts";

export const HELP = {
  window: "The window fades each slice of sound in and out before the FFT. It trades sharp pitch detail against leakage (energy bleeding into nearby frequencies).",
  windows: {
    rect: "Rectangular: no fade at all. Sharpest peaks but the most leakage: loud tones smear across the spectrum.",
    hann: "Hann: the all-round default. Clean and smooth, with a good balance of detail and leakage.",
    hamming: "Hamming: like Hann with slightly narrower peaks, but its faint leakage spreads farther.",
    blackman_harris: "Blackman–Harris: very low leakage, so quiet sounds next to loud ones stay clean. Peaks are wider.",
    kaiser: "Kaiser (β = 8): close to Blackman–Harris, with a tunable trade-off between peak width and leakage.",
    gauss: "Gaussian: a smooth bell, the best balance between time and frequency sharpness. Good for glides.",
    flat_top: "Flat top: reads levels exactly but blurs pitch a lot. More for measuring than for sound.",
  } satisfies Record<WindowName, string>,
  fftSize: "Length of each analysis slice. Larger: finer pitch, blurrier timing (tonal sounds). Smaller: sharp transients, coarse pitch (drums).",
  hop: "Step between slices. A smaller hop means more overlap: smoother, more accurate result, but slower to compute.",
  offset: "Moves this layer in time within the result. Positive starts it later, negative earlier.",
  pitch: "Transposes the source before the analysis, like changing tape speed: pitch and length change together.",
  feather: "Softens the edges of every selection on this layer, in time and pitch. Soft edges avoid clicks and metallic artifacts.",
  fadeIn: "Gradual start inside this selection, for each frequency, so the sound does not come in abruptly.",
  fadeOut: "Gradual ending inside this selection, for each frequency, so the sound does not cut off abruptly.",
  keytrack: "How the result is transposed when you play different keys.",
  tape: "Tape: plays faster or slower for each note, like a classic sampler. Higher notes are also shorter.",
  spectral: "Spectral: changes pitch without changing length. Every note is computed in the background; the bar fills as the octave around the root gets ready. A note played before it is ready waits a few milliseconds.",
  spectralWindow: "Analysis window for Spectral. Tonal (85 ms) keeps pads and chords smooth. Punchy (21 ms) keeps attacks tight but thins out low notes. Mixed is in between.",
  root: "The key that plays the result at its original pitch.",
  attack: "Attack: time to reach full level after a key is pressed.",
  decay: "Decay: time to fall from full level to the sustain level.",
  sustain: "Sustain: level held while the key stays down.",
  release: "Release: time to fade to silence after the key is released.",
  level: "Level of this layer in the result.",
  playLayer: "Play only this layer's selection, as it enters the result (at its own pitch, without offset or level). Press again to stop.",
  original: "Compare (A/B): while ▶ plays, switch between the selection and the original sound of this layer, in sync and at the same level.",
  remove: "Remove this layer's sound and leave the slot empty. Click twice to confirm.",
  fresh: "New project: empty all four layers and the result. Click twice to confirm.",
  display: "How the spectrograms look: frequency scale and range, dB range (contrast) and gain (brightness). Only the picture changes, not the sound.",
  scale: "Log spreads the octaves evenly (like hearing); Lin gives every Hz the same space (like Wave Candy's linear view).",
  lowHz: "Lowest frequency shown.",
  highHz: "Highest frequency shown.",
  rangeDb: "How many dB below the loudest point are still visible. Smaller shows only the strongest partials (more contrast).",
  gainDb: "Brightens or darkens every spectrogram, to see quiet detail or tame loud sounds.",
  mute: "Mute: leave this layer out of the result.",
  solo: "Solo: hear only the soloed layers in the result.",
};

export const HOW = {
  knob: "Drag up or down · Shift for fine · double-click resets",
  stepper: "Drag the value, scroll, or use − +",
  fader: "Drag · double-click for 0 dB",
  chip: "Click to edit in the focus view",
};

export const tip = (what: string, how?: string) => how ? `${what}\n${how}` : what;
