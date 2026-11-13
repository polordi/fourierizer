// Tooltips in the instrument's own style, for every element with a `title` or `data-tip`.
// The native `title` is moved to `data-tip` on first hover, so the browser's tooltip never shows.
// Appears after a short pause (immediately while moving between controls), hides on any press.

const SHOW_MS = 450, CHAIN_MS = 400;

export function installTooltips(): void {
  const el = document.createElement("div");
  el.id = "tip";
  el.setAttribute("role", "tooltip");
  el.className = "fz";
  document.body.append(el);

  let target: HTMLElement | null = null, timer = 0, hiddenAt = 0;

  const source = (n: EventTarget | null): HTMLElement | null => {
    const t = n instanceof Element ? n.closest<HTMLElement>("[data-tip], [title]") : null;
    if (t?.hasAttribute("title")) { t.dataset.tip = t.getAttribute("title") ?? ""; t.removeAttribute("title"); }
    return t && t.dataset.tip ? t : null;
  };

  const place = () => {
    if (!target) return;
    const r = target.getBoundingClientRect(), w = el.offsetWidth, h = el.offsetHeight, m = 8;
    let x = r.left + r.width / 2 - w / 2, y = r.bottom + m;
    if (y + h > window.innerHeight - m) y = r.top - h - m;
    x = Math.max(m, Math.min(window.innerWidth - w - m, x));
    el.style.left = `${x}px`; el.style.top = `${Math.max(m, y)}px`;
  };

  const show = () => {
    if (!target) return;
    const [what, how] = (target.dataset.tip ?? "").split("\n");
    el.replaceChildren(document.createTextNode(what));
    if (how) { const s = document.createElement("span"); s.className = "how"; s.textContent = how; el.append(s); }
    el.classList.add("show");
    place();
  };

  const hide = () => {
    clearTimeout(timer);
    if (el.classList.contains("show")) hiddenAt = performance.now();
    el.classList.remove("show");
    target = null;
  };

  const enter = (t: HTMLElement | null) => {
    if (t === target) return;
    hide();
    if (!t) return;
    target = t;
    timer = window.setTimeout(show, performance.now() - hiddenAt < CHAIN_MS ? 0 : SHOW_MS);
  };

  document.addEventListener("pointerover", (e) => { if (e.pointerType !== "touch") enter(source(e.target)); });
  document.addEventListener("pointerout", (e) => { if (!source(e.relatedTarget)) hide(); });
  document.addEventListener("pointerdown", () => { hide(); hiddenAt = 0; }, true);
  document.addEventListener("focusin", (e) => { if ((e.target as Element).matches?.(":focus-visible")) enter(source(e.target)); });
  document.addEventListener("focusout", hide);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") hide(); });
  window.addEventListener("scroll", hide, true);
}
