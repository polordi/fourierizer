// Periodic analysis windows, identical to python/fourierizer_ref/windows.py.

export type WindowName = "rect" | "hann" | "hamming" | "blackman_harris" | "kaiser" | "gauss" | "flat_top";

export const WINDOW_NAMES: WindowName[] = ["rect", "hann", "hamming", "blackman_harris", "kaiser", "gauss", "flat_top"];

function cosineSum(L: number, a: number[]): Float64Array {
  const w = new Float64Array(L);
  for (let n = 0; n < L; n++) {
    let v = 0;
    for (let k = 0; k < a.length; k++) v += (k % 2 ? -1 : 1) * a[k] * Math.cos(2 * Math.PI * k * n / L);
    w[n] = v;
  }
  return w;
}

/** Modified Bessel function of the first kind, order 0 (power series). */
export function besselI0(x: number): number {
  let sum = 1, term = 1;
  for (let k = 1; k < 200; k++) {
    term *= (x / (2 * k)) ** 2;
    sum += term;
    if (term < sum * 1e-17) break;
  }
  return sum;
}

const cache = new Map<string, Float64Array>();

export function makeWindow(name: WindowName, L: number, params: { beta?: number; sigma?: number } = {}): Float64Array {
  if (L < 2) throw new Error("window length L must be at least 2");
  const key = `${name}:${L}:${params.beta ?? ""}:${params.sigma ?? ""}`;
  const hit = cache.get(key);
  if (hit) return hit;
  let w: Float64Array;
  switch (name) {
    case "rect": w = new Float64Array(L).fill(1); break;
    case "hann": w = cosineSum(L, [0.5, 0.5]); break;
    case "hamming": w = cosineSum(L, [0.54, 0.46]); break;
    case "blackman_harris": w = cosineSum(L, [0.35875, 0.48829, 0.14128, 0.01168]); break;
    case "flat_top": w = cosineSum(L, [0.21557895, 0.41663158, 0.277263158, 0.083578947, 0.006947368]); break;
    case "kaiser": {
      // numpy.kaiser(L + 1, beta)[:-1]: symmetric Kaiser of length L+1 without its last sample.
      const beta = params.beta ?? 8, M = L + 1, alpha = (M - 1) / 2, d = besselI0(beta);
      w = new Float64Array(L);
      for (let n = 0; n < L; n++) w[n] = besselI0(beta * Math.sqrt(Math.max(0, 1 - ((n - alpha) / alpha) ** 2))) / d;
      break;
    }
    case "gauss": {
      const sigma = params.sigma ?? 0.4;
      w = new Float64Array(L);
      for (let n = 0; n < L; n++) w[n] = Math.exp(-0.5 * ((n - L / 2) / (sigma * L / 2)) ** 2);
      break;
    }
    default: throw new Error(`unknown window ${name as string}`);
  }
  cache.set(key, w);
  return w;
}
