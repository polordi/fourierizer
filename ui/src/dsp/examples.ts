// Four synthetic example sounds (no third-party audio): piano arpeggio, drum break,
// a sung "aah" with glide and vibrato, and rain. 3.84 s at the project rate.

export const EXAMPLE_NAMES = ["Upright Piano Arp", "Break 125", "Vox Aah A3", "Rain on Tin"];

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussian(r: () => number): () => number {
  return () => Math.sqrt(-2 * Math.log(r() + 1e-12)) * Math.cos(2 * Math.PI * r());
}

/** RBJ biquad (direct form I), applied in place. */
function biquad(x: Float64Array, type: "lp" | "hp", f: number, q: number, sr: number): void {
  const w = 2 * Math.PI * f / sr, cw = Math.cos(w), alpha = Math.sin(w) / (2 * q);
  let b0, b1, b2;
  if (type === "lp") { b0 = (1 - cw) / 2; b1 = 1 - cw; b2 = (1 - cw) / 2; }
  else { b0 = (1 + cw) / 2; b1 = -(1 + cw); b2 = (1 + cw) / 2; }
  const a0 = 1 + alpha, a1 = -2 * cw, a2 = 1 - alpha;
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const y = (b0 * x[i] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2) / a0;
    x2 = x1; x1 = x[i]; y2 = y1; y1 = y; x[i] = y;
  }
}
/** 4th-order Butterworth as two biquads. */
function butter4(x: Float64Array, type: "lp" | "hp", f: number, sr: number): Float64Array {
  const y = Float64Array.from(x);
  biquad(y, type, f, 0.5412, sr); biquad(y, type, f, 1.3066, sr);
  return y;
}

function normalized(x: Float64Array, peak = 0.9): Float32Array {
  let m = 0;
  for (let i = 0; i < x.length; i++) m = Math.max(m, Math.abs(x[i]));
  const out = new Float32Array(x.length), s = m > 0 ? peak / m : 0;
  for (let i = 0; i < x.length; i++) out[i] = x[i] * s;
  return out;
}

export function makeExamples(sr: number, dur = 3.84): Float32Array[] {
  const n = Math.round(sr * dur), r = rng(7), g = gaussian(r);
  const env = (out: Float64Array, t0: number, a: number, d: number, fn: (t: number, i: number) => number, amp = 1) => {
    for (let i = Math.floor(t0 * sr); i < n; i++) {
      const u = i / sr - t0, e = Math.min(1, u / a) * Math.exp(-u / d);
      if (e < 1e-5 && u > a) break;
      out[i] += amp * e * fn(i / sr, i);
    }
  };

  // 1 · piano arpeggio C3 E3 G3 C4, slightly inharmonic partials
  const piano = new Float64Array(n);
  for (const [t0, f0] of [[0, 130.81], [0.96, 164.81], [1.92, 196.0], [2.88, 261.63]]) {
    for (let k = 1; k <= 35; k++) {
      const fk = f0 * k * Math.sqrt(1 + 0.0004 * k * k);
      if (fk > 16000) break;
      const ph = r() * 2 * Math.PI;
      env(piano, t0, 0.004, 2.2 / (1 + 0.18 * k), (t) => Math.sin(2 * Math.PI * fk * t + ph) / k ** 0.9);
    }
    env(piano, t0, 0.001, 0.012, () => g() * 0.3);
  }

  // 2 · drum break at 125 BPM: kicks, snares, hats
  const drums = new Float64Array(n), beat = 0.48;
  for (const t0 of [0, 1.5 * beat, 4 * beat, 5.5 * beat]) {
    let ph = 0;
    for (let i = Math.floor(t0 * sr); i < n; i++) {
      const u = i / sr - t0; if (u > 1.5) break;
      ph += 2 * Math.PI * (45 + 80 * Math.exp(-u / 0.04)) / sr;
      drums[i] += Math.sin(ph) * Math.exp(-u / 0.35);
    }
  }
  const noise = new Float64Array(n);
  for (let i = 0; i < n; i++) noise[i] = g();
  const band = butter4(butter4(noise, "hp", 900, sr), "lp", 6000, sr), air = butter4(noise, "hp", 7000, sr);
  for (const t0 of [2 * beat, 6 * beat]) env(drums, t0, 0.001, 0.12, (t, i) => band[i] * 1.6 + Math.sin(2 * Math.PI * 190 * t) * 0.6);
  for (let k = 0; k < 16; k++) env(drums, k * beat / 2, 0.0005, k % 2 ? 0.03 : 0.06, (_t, i) => air[i] * 0.9);

  // 3 · vowel "aah" on A3 with a two-semitone glide and vibrato (additive, formant-weighted)
  const vox = new Float64Array(n), formants = [[750, 1.0], [1200, 0.7], [2650, 0.35], [3500, 0.2]];
  let phase = 0;
  const weights = new Float64Array(40);
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const f0 = 220 * 2 ** (Math.min(1, Math.max(0, (t - 1.6) / 0.4)) * 2 / 12) * (1 + 0.012 * Math.sin(2 * Math.PI * 5.2 * t) * Math.min(1, Math.max(0, t - 0.8)));
    phase += 2 * Math.PI * f0 / sr;
    if (i % 128 === 0) {
      // The formant weights move slowly with f0: refresh them every 128 samples.
      for (let k = 1; k < 40; k++) {
        const fk = k * f0;
        let w = fk > sr / 2 ? 0 : 0.02;
        if (w) for (const [F, a] of formants) w += a * Math.exp(-0.5 * (Math.log2(fk / F) / 0.18) ** 2);
        weights[k] = w / k ** 0.3;
      }
    }
    let s = 0;
    for (let k = 1; k < 40; k++) if (weights[k]) s += weights[k] * Math.sin(k * phase);
    vox[i] = s * Math.min(1, t / 0.25) * Math.min(1, Math.max(0, (dur - t) / 0.3));
  }

  // 4 · rain: band-limited noise with slow motion plus droplets
  const rain = butter4(butter4(noise.map((v, i) => v * (0.4 + 0.3 * Math.sin(2 * Math.PI * 0.3 * i / sr))), "hp", 1500, sr), "lp", 14000, sr);
  for (let i = 0; i < n; i++) rain[i] *= 0.6;
  for (let d = 0; d < 60; d++) {
    const t0 = r() * dur, fr = 2000 + r() * 5000, a = 0.3 + r() * 0.7;
    env(rain, t0, 0.0005, 0.02, (t) => Math.sin(2 * Math.PI * fr * t), a);
  }

  return [piano, drums, vox, rain].map((x) => normalized(x));
}
