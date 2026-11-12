# SpectrogramDisplay

The instrument's screen: one layer's STFT magnitude |χ(m,k)| painted in that layer's color, on a log-frequency axis, with the selections drawn on top.

- **Consumer provides:** layer class, magnitude data (dB, already reduced to display resolution), duration in seconds, the analysis settings for the caption (window, N, H), and the selection list in physical units (seconds and Hz).
- **Colormap:** `display` → `--layer` → `--layer-deep`, flat ramp. Low energy fades into the ground; peaks stay at ≥3:1 on `display`. Never a rainbow or a gradient fill outside the data.
- **Axes:** log-spaced Hz ticks (50, 100, 200, 500, 1k…) and seconds, in `readout-sm` / `ink-muted`. The top caption is `silk`; the live cursor readout (time · frequency) sits top right.
- **Selections:** a `--layer` wash at 16% with a 2px dashed `ink` outline; handles are `--layer-deep` with an `ink` outline. The playhead is a solid 1.5px `ink` line.
- **Behavior:** drag draws a rectangle; other tools (lasso, eraser) use the same styling. Selections are stored in seconds and Hz, so they survive changes of N, H or window.
- **Radius:** `radius-0` (a screen is a cut-out in the panel).
