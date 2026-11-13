// Band-limited resampling with a Kaiser-windowed sinc read from a table.
// Used for "Tape" transposition: +12 st plays twice as fast (half the samples).

import { besselI0 } from "./windows.ts";

const ZERO_CROSSINGS = 24;
const STEPS = 512; // table points per zero crossing
const BETA = 8;

let table: Float64Array | null = null;
function kernelTable(): Float64Array {
  if (table) return table;
  const n = ZERO_CROSSINGS * STEPS + 2, t = new Float64Array(n), d = besselI0(BETA);
  for (let i = 0; i < n; i++) {
    const v = i / STEPS; // distance in zero crossings of the (scaled) sinc
    const sinc = v === 0 ? 1 : Math.sin(Math.PI * v) / (Math.PI * v);
    const r = v / ZERO_CROSSINGS;
    t[i] = r >= 1 ? 0 : sinc * besselI0(BETA * Math.sqrt(1 - r * r)) / d;
  }
  return (table = t);
}

/** Resample x so that output sample j reads input position j·step (step > 1 shortens). */
export function resampleByStep(x: ArrayLike<number>, step: number): Float64Array {
  const t = kernelTable(), n = x.length;
  const fc = Math.min(1, 1 / step);           // low-pass at the new Nyquist when shortening
  const reach = ZERO_CROSSINGS / fc;          // kernel half-width in input samples
  const outLen = Math.ceil(n / step);
  const y = new Float64Array(outLen);
  for (let j = 0; j < outLen; j++) {
    const pos = j * step;
    const k0 = Math.max(0, Math.ceil(pos - reach)), k1 = Math.min(n - 1, Math.floor(pos + reach));
    let acc = 0;
    for (let k = k0; k <= k1; k++) {
      const v = Math.abs(pos - k) * fc * STEPS, i = v | 0, f = v - i;
      if (i >= t.length - 1) continue;
      acc += x[k] * (t[i] + (t[i + 1] - t[i]) * f);
    }
    y[j] = acc * fc;
  }
  return y;
}

/** Tape transposition by `semitones` (positive = higher and shorter). */
export function tapePitch(x: ArrayLike<number>, semitones: number): Float64Array {
  if (semitones === 0) return Float64Array.from(x);
  return resampleByStep(x, 2 ** (semitones / 12));
}
