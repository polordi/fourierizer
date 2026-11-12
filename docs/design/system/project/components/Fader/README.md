# Fader

A vertical slider for levels that you compare side by side, mainly the mix of the four layers.

- **Consumer provides:** layer class, value in [0, 1], a dB formatter, and a short `silk` label (L1…L4).
- **Anatomy:** track on `display` with an `ink` outline, fill in `--layer`, an `ink` cap with a `--layer` center line, the dB readout on top and the label below.
- **Behavior:** click or drag sets the level directly; ↑/↓ for fine steps. No spring: levels must feel exact.
- **Use when** several values belong to one comparison (layer mix, output). **Don't use** for a single isolated parameter: use Knob.
