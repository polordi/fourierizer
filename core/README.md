# fourierizer-core

The synthesis engine in C++20, with no framework dependency. The plugin (JUCE) links it; it can
also be built and tested on its own.

```
include/fourierizer/
  fft.h        real FFT (numpy conventions)
  windows.h    7 periodic windows
  stft.h       Grid, NOLA validation, streaming masked resynthesis (least-squares ISTFT)
  mask.h       selections in (seconds, log₂ Hz): rect / lasso, feather, add / subtract, time fades
  resample.h   Kaiser-windowed sinc resampler: Tape pitch and sample-rate conversion
  render.h     per-layer synthesis, mix (gain, offset, normalization), parallel render, cancel
  spectral.h   Spectral mode: phase-vocoder pitch shift that keeps the length, streamed in chunks
tests/
  golden_test.cpp   must reproduce python/golden/data to 1e-9
  bench.cpp         4 stereo layers × 30 s at 48 kHz, and one Spectral note
```

```cpp
fz::LayerInput layer{channels, {fz::Window::Hann, 4096, 4096, 512}, shapes};
fz::RenderOptions opts;
opts.threads = 4;
fz::Channels y = fz::render({layer}, 48000.0, opts);
```

Build and test alone (Windows: `scripts/test-core.ps1 -Bench`):

```
cmake -S core -B build/core -DCMAKE_BUILD_TYPE=Release
cmake --build build/core --parallel
ctest --test-dir build/core --output-on-failure
```
