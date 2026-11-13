// Resolution-independent selections (PLAN §4.3), identical to python/fourierizer_ref/mask.py.
// Shapes live in the plane (t [s], φ = log₂ f). Distances are measured in a plane scaled by the
// shape's feather, and the soft mask is the raised-cosine ramp ρ(d) = ½ + ½ sin(πd) on [−½, ½].

export type Mode = "add" | "subtract";

export interface RectShape { kind: "rect"; mode: Mode; gain?: number; t: [number, number]; f: [number, number]; featherS?: number; featherOct?: number; }
export interface PolyShape { kind: "poly"; mode: Mode; gain?: number; points: [number, number][]; featherS?: number; featherOct?: number; }
export type Shape = RectShape | PolyShape;

export const F_FLOOR = 1.0;

export function ramp(d: number): number {
  if (d <= -0.5) return 0;
  if (d >= 0.5) return 1;
  return 0.5 + 0.5 * Math.sin(Math.PI * d);
}

/** log₂ of each bin frequency, with the DC bin mapped to F_FLOOR (as in Python). */
export function logFreqs(freqs: Float64Array): Float64Array {
  const P = new Float64Array(freqs.length);
  for (let k = 0; k < freqs.length; k++) P[k] = Math.log2(Math.max(freqs[k], F_FLOOR));
  return P;
}

interface Compiled {
  mode: Mode; gain: number; ft: number; fp: number;
  rect?: { t0: number; t1: number; p0: number; p1: number };
  poly?: { vx: Float64Array; vy: Float64Array; minX: number; maxX: number; minY: number; maxY: number };
}

/** Precompute a selection for fast row-by-row rasterization. */
export class SelectionRaster {
  private shapes: Compiled[];
  constructor(shapes: Shape[], featherS = 0.01, featherOct = 1 / 12) {
    this.shapes = shapes.map((s) => {
      const ft = Math.max(s.featherS ?? featherS, 1e-9), fp = Math.max(s.featherOct ?? featherOct, 1e-9);
      const c: Compiled = { mode: s.mode, gain: s.gain ?? 1, ft, fp };
      if (s.kind === "rect") {
        c.rect = {
          t0: s.t[0], t1: s.t[1],
          p0: s.f[0] > 0 ? Math.log2(s.f[0]) : -Infinity,
          p1: s.f[1] > 0 ? Math.log2(s.f[1]) : -Infinity,
        };
      } else {
        if (s.points.length < 3) throw new Error("a polygon needs at least 3 points");
        const vx = new Float64Array(s.points.map((p) => p[0] / ft));
        const vy = new Float64Array(s.points.map((p) => Math.log2(Math.max(p[1], F_FLOOR)) / fp));
        c.poly = { vx, vy, minX: Math.min(...vx), maxX: Math.max(...vx), minY: Math.min(...vy), maxY: Math.max(...vy) };
      }
      return c;
    });
  }

  get empty(): boolean { return this.shapes.length === 0; }

  /** Mask row at time t over bins with log-frequencies P. */
  row(t: number, P: Float64Array, out: Float64Array): void {
    out.fill(0);
    for (const s of this.shapes) {
      if (s.rect) this.rectRow(s, t, P, out);
      else this.polyRow(s, t, P, out);
    }
  }

  private combine(out: Float64Array, k: number, ms: number, mode: Mode): void {
    if (mode === "add") out[k] = out[k] + (1 - out[k]) * ms;
    else out[k] = out[k] * (1 - ms);
  }

  private rectRow(s: Compiled, t: number, P: Float64Array, out: Float64Array): void {
    const r = s.rect!;
    const dt = Math.min(t - r.t0, r.t1 - t) / s.ft;
    if (dt <= -0.5) return; // fully outside in time: d ≤ dt ≤ −½ → M_s = 0 for every bin
    for (let k = 0; k < P.length; k++) {
      const dp = Math.min(P[k] - r.p0, r.p1 - P[k]) / s.fp;
      const d = dt >= 0 && dp >= 0 ? Math.min(dt, dp) : -Math.hypot(Math.min(dt, 0), Math.min(dp, 0));
      const ms = s.gain * ramp(d);
      if (ms !== 0) this.combine(out, k, ms, s.mode); // M_s = 0 leaves M unchanged in both modes
    }
  }

  private polyRow(s: Compiled, t: number, P: Float64Array, out: Float64Array): void {
    const p = s.poly!, X = t / s.ft, n = p.vx.length;
    if (X < p.minX - 0.5 || X > p.maxX + 0.5) return; // d < −½ for the whole row → M_s = 0
    for (let k = 0; k < P.length; k++) {
      const Y = P[k] / s.fp;
      if (Y < p.minY - 0.5 || Y > p.maxY + 0.5) continue;
      let d2 = Infinity, inside = false;
      for (let i = 0; i < n; i++) {
        const j = i === 0 ? n - 1 : i - 1;
        const ax = p.vx[j], ay = p.vy[j], ex = p.vx[i] - ax, ey = p.vy[i] - ay;
        const seg = ex * ex + ey * ey;
        let u = ((X - ax) * ex + (Y - ay) * ey) / (seg > 0 ? seg : 1);
        u = u < 0 ? 0 : u > 1 ? 1 : u;
        const dx = X - ax - u * ex, dy = Y - ay - u * ey;
        const dd = dx * dx + dy * dy;
        if (dd < d2) d2 = dd;
        if ((ay > Y) !== (p.vy[i] > Y) && X < ax + (Y - ay) * ex / ey) inside = !inside;
      }
      const d = Math.sqrt(d2);
      const ms = s.gain * ramp(inside ? d : -d);
      if (ms !== 0) this.combine(out, k, ms, s.mode);
    }
  }
}
