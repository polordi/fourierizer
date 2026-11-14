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
    double peakDbfs = -1000;    // level of pixel value 0: a full-scale sine is 0 dBFS
};

/// Frames are centred at start + m·H for the samples [start, end) (end < 0: the whole signal);
/// samples outside the signal count as silence.
SpectrogramImage spectrogramImage(const Signal& x, double sr, const Grid& g, int maxCols = 1400, int rows = 360, Axis axis = {},
                                  long long start = 0, long long end = -1);

/// Min and max of x[start, end) in `cols` equal columns: {min0, max0, min1, max1, …}.
std::vector<float> waveformPeaks(const Signal& x, long long start, long long end, int cols);

/// Mid (average of the channels).
Signal midOf(const Channels& x);

} // namespace fz
