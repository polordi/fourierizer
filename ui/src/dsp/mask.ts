// Resolution-independent selections (PLAN §4.3), identical to python/fourierizer_ref/mask.py.
// Shapes live in the plane (t [s], φ = log₂ f). Distances are measured in a plane scaled by the
// shape's feather, and the soft mask is the raised-cosine ramp ρ(d) = ½ + ½ sin(πd) on [−½, ½].
// Optional time fades multiply it by E(t, φ) = max_j S((t − a_j)/fadeIn)·S((b_j − t)/fadeOut) over
// the time intervals [a_j, b_j] the shape covers on the row φ.

export type Mode = "add" | "subtract";

interface ShapeBase { mode: Mode; gain?: number; featherS?: number; featherOct?: number; fadeIn?: number; fadeOut?: number; }
export interface RectShape extends ShapeBase { kind: "rect"; t: [number, number]; f: [number, number]; }
export interface PolyShape extends ShapeBase { kind: "poly"; points: [number, number][]; }
export type Shape = RectShape | PolyShape;

export const F_FLOOR = 1.0;

export function ramp(d: number): number {
  if (d <= -0.5) return 0;
  if (d >= 0.5) return 1;
  return 0.5 + 0.5 * Math.sin(Math.PI * d);
}

/** S(u): 0 → 1 raised cosine on [0, 1]. */
export function fade(u: number): number {
  return 0.5 - 0.5 * Math.cos(Math.PI * (u < 0 ? 0 : u > 1 ? 1 : u));
}

/** E on one row: max over the intervals [a, b, a, b, …] of fade-in × fade-out (0 if none). */
export function envelope(t: number, iv: ArrayLike<number>, fadeIn: number, fadeOut: number): number {
  let E = 0;
  for (let j = 0; j + 1 < iv.length; j += 2) {
    let e = 1;
    if (fadeIn > 0) e *= fade((t - iv[j]) / fadeIn);
    if (fadeOut > 0) e *= fade((iv[j + 1] - t) / fadeOut);
    if (e > E) E = e;
  }
  return E;
}

/** Time intervals a polygon (t s, f Hz) covers on the row φ = log₂ f, as [a, b, a, b, …]. */
export function polyRowIntervals(points: [number, number][], phi: number): number[] {
  const ts = points.map((p) => p[0]), ps = points.map((p) => Math.log2(Math.max(p[1], F_FLOOR)));
  const lo = Math.min(...ps), hi = Math.max(...ps), eps = 1e-9 * Math.max(1, hi - lo);
  const y = Math.min(Math.max(phi, lo + eps), hi - eps);
  const xs: number[] = [];
  for (let i = 0; i < ts.length; i++) {
    const j = i === 0 ? ts.length - 1 : i - 1;
    const ax = ts[j], ay = ps[j], bx = ts[i], by = ps[i];
    if ((ay > y) !== (by > y)) xs.push(ax + (y - ay) * (bx - ax) / (by - ay));
  }
  xs.sort((a, b) => a - b);
  return xs.length % 2 ? xs.slice(0, -1) : xs;
}

/** Time intervals of any shape on the row φ (a rectangle covers [t0, t1] on every row). */
export function rowIntervals(s: Shape, phi: number): number[] {
  return s.kind === "rect" ? [s.t[0], s.t[1]] : polyRowIntervals(s.points, phi);
}

/** log₂ of each bin frequency, with the DC bin mapped to F_FLOOR (as in Python). */
export function logFreqs(freqs: Float64Array): Float64Array {
  const P = new Float64Array(freqs.length);
  for (let k = 0; k < freqs.length; k++) P[k] = Math.log2(Math.max(freqs[k], F_FLOOR));
  return P;
}

interface Compiled {
  mode: Mode; gain: number; ft: number; fp: number; fi: number; fo: number; fades: boolean;
  rect?: { t0: number; t1: number; p0: number; p1: number };
  poly?: { vx: Float64Array; vy: Float64Array; minX: number; maxX: number; minY: number; maxY: number; points: [number, number][]; rows?: { P: Float64Array; iv: number[][] } };
}

/** Precompute a selection for fast row-by-row rasterization. */
export class SelectionRaster {
  private shapes: Compiled[];
  constructor(shapes: Shape[], featherS = 0.01, featherOct = 1 / 12) {
    this.shapes = shapes.map((s) => {
      const ft = Math.max(s.featherS ?? featherS, 1e-9), fp = Math.max(s.featherOct ?? featherOct, 1e-9);
      const fi = Math.max(s.fadeIn ?? 0, 0), fo = Math.max(s.fadeOut ?? 0, 0);
      const c: Compiled = { mode: s.mode, gain: s.gain ?? 1, ft, fp, fi, fo, fades: fi > 0 || fo > 0 };
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
        c.poly = { vx, vy, minX: Math.min(...vx), maxX: Math.max(...vx), minY: Math.min(...vy), maxY: Math.max(...vy), points: s.points };
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
    const E = s.fades ? envelope(t, [r.t0, r.t1], s.fi, s.fo) : 1;
    if (E === 0) return;
    for (let k = 0; k < P.length; k++) {
      const dp = Math.min(P[k] - r.p0, r.p1 - P[k]) / s.fp;
      const d = dt >= 0 && dp >= 0 ? Math.min(dt, dp) : -Math.hypot(Math.min(dt, 0), Math.min(dp, 0));
      const ms = s.gain * ramp(d) * E;
      if (ms !== 0) this.combine(out, k, ms, s.mode); // M_s = 0 leaves M unchanged in both modes
    }
  }

  private polyRow(s: Compiled, t: number, P: Float64Array, out: Float64Array): void {
    const p = s.poly!, X = t / s.ft, n = p.vx.length;
    if (X < p.minX - 0.5 || X > p.maxX + 0.5) return; // d < −½ for the whole row → M_s = 0
    if (s.fades && p.rows?.P !== P) p.rows = { P, iv: Array.from(P, (phi) => polyRowIntervals(p.points, phi)) };
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
      const ms = s.gain * ramp(inside ? d : -d) * (s.fades ? envelope(t, p.rows!.iv[k], s.fi, s.fo) : 1);
      if (ms !== 0) this.combine(out, k, ms, s.mode);
    }
  }
}
