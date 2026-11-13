// Tiny DOM helpers (no framework: the plugin WebView loads one small file).

type Attrs = Record<string, string | number | boolean | undefined | null | EventListener>;
type Child = Node | string | null | undefined | false;

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v as EventListener);
    else if (k === "class") el.className = String(v);
    else if (k === "html") el.innerHTML = String(v);
    else el.setAttribute(k, v === true ? "" : String(v));
  }
  for (const c of children) if (c) el.append(c);
  return el;
}

const SVG = "http://www.w3.org/2000/svg";
export function s<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  return el;
}

/** An inline icon from a 16-unit path string. */
export function icon(paths: string, cls = ""): SVGSVGElement {
  const el = s("svg", { viewBox: "0 0 16 16", "aria-hidden": "true" });
  if (cls) el.setAttribute("class", cls);
  el.innerHTML = paths;
  return el;
}

export const ICONS = {
  load: '<path d="M8 2v8M4.5 6.5 8 10l3.5-3.5M2 13h12"/>',
  rec: '<circle cx="8" cy="8" r="4"/>',
  focus: '<path d="M2 6V2h4M10 2h4v4M14 10v4h-4M6 14H2v-4"/>',
  grid: '<rect x="2" y="2" width="5" height="5"/><rect x="9" y="2" width="5" height="5"/><rect x="2" y="9" width="5" height="5"/><rect x="9" y="9" width="5" height="5"/>',
  undo: '<path d="M5 3 2 6l3 3M2 6h8a4 4 0 0 1 0 8H7"/>',
  redo: '<path d="m11 3 3 3-3 3M14 6H6a4 4 0 0 0 0 8h3"/>',
  rect: '<rect x="2" y="3" width="12" height="10" stroke-dasharray="2.5 1.5"/>',
  lasso: '<path d="M3 9C1 5 6 2 10 3s5 5 2 7-6 1-7 3"/>',
  erase: '<path d="M6 13 2 9l7-7 5 5-6 6zM5 6l5 5M6 13h8"/>',
  move: '<path d="M8 1v14M1 8h14M8 1 6 3M8 1l2 2M8 15l-2-2M8 15l2-2M1 8l2-2M1 8l2 2M15 8l-2-2M15 8l-2 2"/>',
  wave: '<path d="M1 8c1.5-5 3-5 4.5 0s3 5 4.5 0 3-5 4.5 0"/>',
  all: '<rect x="2" y="2" width="12" height="12"/><path d="M5 8l2 2 4-4"/>',
  clear: '<path d="M3 4h10M6 4V2.5h4V4M4.5 4l.7 9.5h5.6l.7-9.5"/>',
  midi: '<circle cx="8" cy="8" r="6"/><circle cx="5" cy="7" r=".6"/><circle cx="11" cy="7" r=".6"/><circle cx="8" cy="5" r=".6"/><circle cx="6" cy="10" r=".6"/><circle cx="10" cy="10" r=".6"/>',
  play: '<path d="M4 2.5v11l9-5.5z"/>',
  stop: '<rect x="3.5" y="3.5" width="9" height="9"/>',
};

export function screws(): HTMLElement[] {
  return ["tl", "tr", "bl", "br"].map((p) => h("span", { class: `screw ${p}` }));
}
