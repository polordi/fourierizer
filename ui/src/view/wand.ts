// Selection helpers that read the layer's spectrogram image (values: half-dB steps below the
// image's peak, 0 = loudest, 255 = silent):
//   snapRow    the loudest row near a click, for the harmonic tool's fundamental
//   wandRegion the magic wand: the connected area around a click whose level is within `tolDb`
//              of the clicked point, traced into a polygon (in pixel units)

export interface Img { data: Uint8Array; cols: number; rows: number; }

/** The row (fractional, parabola-refined) with the highest mean level over columns [c0, c1]
 *  among rows within ±`reach` of `row`. Returns `row` itself if everything there is silent. */
export function snapRow(img: Img, row: number, reach: number, c0: number, c1: number): number {
  const { data, cols, rows } = img;
  const a = Math.max(0, Math.floor(row - reach)), b = Math.min(rows - 1, Math.ceil(row + reach));
  c0 = Math.max(0, Math.min(cols - 1, Math.floor(c0)));
  c1 = Math.max(c0, Math.min(cols - 1, Math.ceil(c1)));
  const mean = (r: number) => {
    let s = 0;
    for (let c = c0; c <= c1; c++) s += data[r * cols + c];
    return s / (c1 - c0 + 1);   // lower = louder
  };
  let best = -1, bestV = Infinity;
  for (let r = a; r <= b; r++) { const v = mean(r); if (v < bestV) { bestV = v; best = r; } }
  if (best < 0 || bestV >= 254) return row;
  let off = 0;
  if (best > 0 && best < rows - 1) {
    const p = mean(best - 1), q = bestV, n = mean(best + 1), den = p - 2 * q + n;
    if (den > 0) off = Math.max(-0.5, Math.min(0.5, 0.5 * (p - n) / den));
  }
  return best + 0.5 + off;   // in row units, where row r spans [r, r + 1)
}

/** The magic wand. Pixels 4-connected to (col, row) whose level is at most `tolDb` below the
 *  clicked pixel's; returns the outline of that area as a polygon in pixel units (x = column,
 *  y = row, pixel (c, r) covering [c, c+1] × [r, r+1]), simplified to at most `maxPoints`. */
export function wandRegion(img: Img, col: number, row: number, tolDb: number, maxPoints = 120): [number, number][] {
  const { data, cols, rows } = img;
  const c0 = Math.max(0, Math.min(cols - 1, Math.floor(col))), r0 = Math.max(0, Math.min(rows - 1, Math.floor(row)));
  const limit = data[r0 * cols + c0] + 2 * tolDb;          // values are half-dB steps
  if (data[r0 * cols + c0] >= 254) return [];
  const inside = new Uint8Array(cols * rows), stack = [r0 * cols + c0];
  inside[stack[0]] = 1;
  while (stack.length) {
    const i = stack.pop()!, r = (i / cols) | 0, c = i - r * cols;
    const visit = (j: number) => { if (!inside[j] && data[j] <= limit && data[j] < 254) { inside[j] = 1; stack.push(j); } };
    if (c > 0) visit(i - 1);
    if (c < cols - 1) visit(i + 1);
    if (r > 0) visit(i - cols);
    if (r < rows - 1) visit(i + cols);
  }
  const loop = outerLoop(inside, cols, rows);
  if (loop.length < 3) return [];
  let eps = 0.75, pts = rdp(loop, eps);
  while (pts.length > maxPoints) { eps *= 1.5; pts = rdp(loop, eps); }
  return pts;
}

/** The outline of a pixel mask along pixel edges: every boundary edge is directed with the area
 *  on its right, edges are chained into loops, and the loop with the largest area is the outer one. */
function outerLoop(inside: Uint8Array, cols: number, rows: number): [number, number][] {
  const at = (r: number, c: number) => r >= 0 && r < rows && c >= 0 && c < cols && inside[r * cols + c] === 1;
  const W = cols + 1, key = (x: number, y: number) => y * W + x;
  const next = new Map<number, number[]>();   // vertex → end vertices of edges leaving it
  const add = (x0: number, y0: number, x1: number, y1: number) => {
    const k = key(x0, y0), list = next.get(k);
    if (list) list.push(key(x1, y1)); else next.set(k, [key(x1, y1)]);
  };
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      if (!at(r, c)) continue;
      if (!at(r - 1, c)) add(c, r, c + 1, r);             // top edge, going right
      if (!at(r, c + 1)) add(c + 1, r, c + 1, r + 1);     // right edge, going down
      if (!at(r + 1, c)) add(c + 1, r + 1, c, r + 1);     // bottom edge, going left
      if (!at(r, c - 1)) add(c, r + 1, c, r);             // left edge, going up
    }
  let best: [number, number][] = [], bestArea = 0;
  for (const startKey of [...next.keys()]) {
    while ((next.get(startKey)?.length ?? 0) > 0) {
      const loop: [number, number][] = [];
      let k = startKey, guard = 0;
      do {
        loop.push([k % W, (k / W) | 0]);
        const outs = next.get(k)!;
        const to = outs.pop()!;
        if (!outs.length) next.delete(k);
        k = to;
      } while (k !== startKey && next.has(k) && ++guard < 4 * cols * rows);
      let area = 0;
      for (let i = 0; i < loop.length; i++) { const [x0, y0] = loop[i], [x1, y1] = loop[(i + 1) % loop.length]; area += x0 * y1 - x1 * y0; }
      if (Math.abs(area) > bestArea) { bestArea = Math.abs(area); best = loop; }
    }
  }
  return best;
}

/** Ramer–Douglas–Peucker on a closed loop (split at its two farthest points). */
function rdp(loop: [number, number][], eps: number): [number, number][] {
  if (loop.length < 4) return loop;
  let far = 0, d = 0;
  for (let i = 1; i < loop.length; i++) { const dd = (loop[i][0] - loop[0][0]) ** 2 + (loop[i][1] - loop[0][1]) ** 2; if (dd > d) { d = dd; far = i; } }
  const a = open(loop.slice(0, far + 1), eps), b = open([...loop.slice(far), loop[0]], eps);
  return [...a.slice(0, -1), ...b.slice(0, -1)];
}

function open(pts: [number, number][], eps: number): [number, number][] {
  if (pts.length < 3) return pts;
  const [ax, ay] = pts[0], [bx, by] = pts[pts.length - 1], ex = bx - ax, ey = by - ay, len = Math.hypot(ex, ey) || 1;
  let idx = 0, dmax = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const dd = Math.abs((pts[i][0] - ax) * ey - (pts[i][1] - ay) * ex) / len;
    if (dd > dmax) { dmax = dd; idx = i; }
  }
  if (dmax <= eps) return [pts[0], pts[pts.length - 1]];
  return [...open(pts.slice(0, idx + 1), eps).slice(0, -1), ...open(pts.slice(idx), eps)];
}
