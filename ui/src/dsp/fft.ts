// Radix-2 FFT (in place) and a real-signal wrapper with the same conventions as numpy:
// rfft returns bins 0..N/2 unnormalized; irfft divides by N.

interface Plan { n: number; cos: Float64Array; sin: Float64Array; rev: Uint32Array; }
const plans = new Map<number, Plan>();

function plan(n: number): Plan {
  let p = plans.get(n);
  if (p) return p;
  if (n < 2 || (n & (n - 1)) !== 0) throw new Error(`FFT size must be a power of two, got ${n}`);
  const bits = Math.log2(n);
  const rev = new Uint32Array(n);
  for (let i = 0; i < n; i++) {
    let r = 0;
    for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b);
    rev[i] = r;
  }
  const cos = new Float64Array(n / 2), sin = new Float64Array(n / 2);
  for (let i = 0; i < n / 2; i++) { cos[i] = Math.cos(2 * Math.PI * i / n); sin[i] = Math.sin(2 * Math.PI * i / n); }
  p = { n, cos, sin, rev };
  plans.set(n, p);
  return p;
}

/** In-place complex FFT. Forward uses e^{-2πikn/N}; inverse uses e^{+2πikn/N} without 1/N. */
export function fft(re: Float64Array, im: Float64Array, inverse = false): void {
  const n = re.length, { cos, sin, rev } = plan(n);
  for (let i = 0; i < n; i++) {
    const j = rev[i];
    if (j > i) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
  }
  const sgn = inverse ? 1 : -1;
  for (let size = 2; size <= n; size <<= 1) {
    const half = size >> 1, step = n / size;
    for (let start = 0; start < n; start += size) {
      for (let k = 0; k < half; k++) {
        const wr = cos[k * step], wi = sgn * sin[k * step];
        const a = start + k, b = a + half;
        const xr = re[b] * wr - im[b] * wi, xi = re[b] * wi + im[b] * wr;
        re[b] = re[a] - xr; im[b] = im[a] - xi;
        re[a] += xr; im[a] += xi;
      }
    }
  }
}

/** Real FFT of size N with reusable buffers. */
export class RealFFT {
  readonly n: number;
  readonly bins: number;
  private re: Float64Array;
  private im: Float64Array;
  constructor(n: number) {
    plan(n);
    this.n = n; this.bins = n / 2 + 1;
    this.re = new Float64Array(n); this.im = new Float64Array(n);
  }
  /** input: up to N samples (zero-padded); writes bins 0..N/2. */
  forward(input: Float64Array, outRe: Float64Array, outIm: Float64Array): void {
    const { re, im, n } = this;
    re.fill(0); im.fill(0);
    re.set(input.length > n ? input.subarray(0, n) : input);
    fft(re, im, false);
    for (let k = 0; k < this.bins; k++) { outRe[k] = re[k]; outIm[k] = im[k]; }
  }
  /** Hermitian-symmetric inverse of bins 0..N/2 → N real samples (divided by N, like irfft). */
  inverse(inRe: Float64Array, inIm: Float64Array, out: Float64Array): void {
    const { re, im, n } = this, h = n / 2;
    re[0] = inRe[0]; im[0] = 0;
    re[h] = inRe[h]; im[h] = 0;
    for (let k = 1; k < h; k++) { re[k] = inRe[k]; im[k] = inIm[k]; re[n - k] = inRe[k]; im[n - k] = -inIm[k]; }
    fft(re, im, true);
    const s = 1 / n;
    for (let i = 0; i < n; i++) out[i] = re[i] * s;
  }
}
