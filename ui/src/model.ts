// Project state. Selections are stored in physical units (seconds, Hz), so they survive any
// change of window, N or H (PLAN §4.3).

import type { WindowName } from "./dsp/windows.ts";
import type { Shape } from "./dsp/mask.ts";
import type { Grid } from "./dsp/stft.ts";
import type { Op } from "./dsp/ops.ts";
import type { Axis } from "./dsp/spectrogram.ts";
import type { SpectralWindow } from "./dsp/spectral.ts";

export const SR = 48000;
export const MAX_SECONDS = 60;

export type Tool = "rect" | "lasso" | "erase" | "move";

export interface LayerState {
  index: number;
  name: string;
  loaded: boolean;
  samples: number;      // source length before pitch
  channels: number;
  window: WindowName;
  N: number;            // FFT size = window length L
  hopDiv: number;       // H = N / hopDiv
  offset: number;       // s
  pitch: number;        // st (Tape)
  feather: number;      // knob position 0..1
  levelDb: number;
  mute: boolean;
  solo: boolean;
  shapes: Shape[];
}

/** How every spectrogram is drawn (the Display panel), like Wave Candy's spectrum settings. */
export interface Display { scale: "log" | "lin"; fmin: number; fmax: number; rangeDb: number; gainDb: number; }
export const DEFAULT_DISPLAY: Display = { scale: "log", fmin: 30, fmax: 20000, rangeDb: 58, gainDb: 0 };
export const LOW_HZ = [0, 20, 30, 40, 50, 80, 100, 150, 200, 300, 500, 1000];
export const HIGH_HZ = [1000, 2000, 3000, 4000, 5000, 8000, 10000, 12000, 16000, 20000, 24000];
/** The axis for a display (a log axis cannot start at 0 Hz). */
export function axisOf(d: Display): Axis {
  return { scale: d.scale, fmin: d.scale === "log" ? Math.max(20, d.fmin) : d.fmin, fmax: Math.max(d.fmax, d.fmin + 100) };
}

export interface State {
  layers: LayerState[];
  focus: number;        // 0 = 2×2 grid, 1..4 = focused layer
  tool: Tool;
  op: Op;
  opA: number;          // layer index for pair operations
  opB: number;
  keytrack: "tape" | "spectral";
  spectralWindow: SpectralWindow;   // Spectral mode's analysis window
  root: number;         // MIDI note
  adsr: { a: number; d: number; s: number; r: number }; // knob positions 0..1
  auto: boolean;
  display: Display;
}

export const WINDOW_LABELS: Record<WindowName, string> = {
  rect: "Rect", hann: "Hann", hamming: "Hamm", blackman_harris: "B-H", kaiser: "Kaiser", gauss: "Gauss", flat_top: "Flat",
};

export function gridOf(l: LayerState): Grid { return { window: l.window, L: l.N, N: l.N, H: l.N / l.hopDiv }; }

/** Feather knob → time and frequency feather. 0.54 ≈ one semitone and 24 ms. */
export function featherOf(v: number): { s: number; oct: number } {
  return { oct: (1 / 96) * 2 ** (v * Math.log2(48)), s: 0.002 * 2 ** (v * Math.log2(100)) };
}
export function featherLabel(v: number): string {
  const st = featherOf(v).oct * 12;
  return st < 0.995 ? `${st.toFixed(2)} st` : `${st.toFixed(1)} st`;
}

/** Fade knob (0..1) ↔ seconds: quadratic, so short fades get most of the travel; 0.5 → 1 s, 1 → 4 s. */
export const FADE_MAX_S = 4;
export function knobToFade(v: number): number { return Math.round(FADE_MAX_S * v * v * 1000) / 1000; }
export function fadeToKnob(s: number): number { return Math.sqrt(Math.max(0, s) / FADE_MAX_S); }
export function fadeLabel(s: number): string { return s <= 0 ? "Off" : s < 1 ? `${Math.round(s * 1000)} ms` : `${s.toFixed(2)} s`; }

export function pitchedSeconds(l: LayerState): number {
  return Math.ceil(l.samples / 2 ** (l.pitch / 12)) / SR;
}

export function activeLayers(s: State): LayerState[] {
  const solo = s.layers.some((l) => l.loaded && l.solo);
  return s.layers.filter((l) => l.loaded && (solo ? l.solo : !l.mute));
}

/** ADSR knob positions → seconds / level. */
export const adsrMap = {
  a: (v: number) => 0.001 + v * v * 1.999,
  d: (v: number) => 0.005 + v * v * 3.995,
  s: (v: number) => v,
  r: (v: number) => 0.005 + v * v * 4.995,
};

const NOTE_NAMES = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"];
export function noteName(n: number): string { return NOTE_NAMES[((n % 12) + 12) % 12] + (Math.floor(n / 12) - 1); }

/** A layer slot with no sound and default parameters. */
export function emptyLayer(index: number): LayerState { return layer(index, "", []); }

function layer(index: number, name: string, shapes: Shape[], extra: Partial<LayerState> = {}): LayerState {
  return {
    index, name, loaded: false, samples: 0, channels: 1, window: "hann", N: 4096, hopDiv: 8,
    offset: 0, pitch: 0, feather: 0.537, levelDb: 0, mute: false, solo: false, shapes, ...extra,
  };
}

/** A new, empty project (the plugin starts here). */
export function emptyState(): State {
  return {
    layers: [0, 1, 2, 3].map((i) => layer(i, "", [])),
    focus: 0, tool: "rect", op: "sum", opA: 0, opB: 1, keytrack: "tape", spectralWindow: "tonal", root: 48,
    adsr: { a: 0.18, d: 0.33, s: 0.7, r: 0.4 }, auto: true, display: { ...DEFAULT_DISPLAY },
  };
}

/** The example project: the same selections as the layout mockups. */
export function exampleState(): State {
  return {
    layers: [
      layer(0, "Upright Piano Arp", [
        { kind: "rect", mode: "add", t: [0, 2.4], f: [120, 1000] },
        { kind: "rect", mode: "add", t: [2.88, 3.84], f: [250, 2000] },
      ]),
      layer(1, "Break 125", [
        { kind: "rect", mode: "add", t: [0, 3.84], f: [0, 160] },
        { kind: "rect", mode: "add", t: [0, 3.84], f: [7000, 20000] },
      ], { levelDb: -3 }),
      layer(2, "Vox Aah A3", [
        { kind: "poly", mode: "add", points: [[0.4, 500], [1.2, 3200], [2.6, 3600], [3.5, 1800], [2.4, 600]] },
      ], { levelDb: -1.5, offset: 0.48 }),
      layer(3, "Rain on Tin", [
        { kind: "rect", mode: "add", t: [0.8, 3.84], f: [3000, 16000] },
        { kind: "rect", mode: "subtract", t: [2.0, 2.6], f: [5000, 10000] },
      ], { levelDb: -6 }),
    ],
    focus: 0, tool: "rect", op: "sum", opA: 0, opB: 1, keytrack: "tape", spectralWindow: "tonal", root: 48,
    adsr: { a: 0.18, d: 0.33, s: 0.7, r: 0.4 }, auto: true, display: { ...DEFAULT_DISPLAY },
  };
}

export function cloneShapes(s: Shape[]): Shape[] { return JSON.parse(JSON.stringify(s)) as Shape[]; }
