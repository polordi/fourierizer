// Display spectrogram (ui/src/dsp/spectrogram.ts): STFT magnitude on a log or linear frequency
// axis, reduced to screen resolution (max over the frames of each column). Each pixel is its
// level in half-dB steps below the peak (0 = peak, 255 = −127.5 dB or less); the UI maps that
// to colors with its own range and gain, so display changes need no recomputation.
#pragma once

#include <cstdint>
#include <vector>

#include "fourierizer/stft.h"

namespace fz {

inline constexpr double kSpecFMin = 30.0, kSpecFMax = 20000.0;

struct Axis {
    double fmin = kSpecFMin, fmax = kSpecFMax;
    bool log = true;
};

struct SpectrogramImage {
    std::vector<uint8_t> data;  // rows × cols, row-major
    int cols = 0, rows = 0;
};

SpectrogramImage spectrogramImage(const Signal& x, double sr, const Grid& g, int maxCols = 1400, int rows = 360, Axis axis = {});

/// Mid (average of the channels).
Signal midOf(const Channels& x);

} // namespace fz
