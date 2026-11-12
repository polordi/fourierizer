# Segmented

Choose exactly one option from a small set: window function, Tape / Spectral keytracking, selection tool.

- **Consumer provides:** a `silk` group label, options (id + short uppercase text) and, optionally, an icon per option.
- **Window icons are data, not decoration:** each one plots the real function w[n] on n ∈ [0, 1] (Rect, Hann, Hamming, Blackman-Harris, Kaiser β = 8, Gauss σ = 0.4, Flat-top), so a glance shows how hard each window tapers.
- **Anatomy:** one outlined strip; options separated by `seam` hairlines; the selected option is filled `ink` with `on-ink` text.
- **Behavior:** click selects; radiogroup semantics for assistive tech.
- **Don't use** for more than ~8 options (use a menu) or for on/off (use a Key with `aria-pressed`).
