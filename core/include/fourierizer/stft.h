// STFT on a grid (w, L, N ≥ L, H) with centered frames, and the least-squares inverse
// (python/fourierizer_ref/stft.py). Frame m is centered at sample m·H.
#pragma once

#include <atomic>
#include <functional>
#include <stdexcept>
#include <vector>

#include "fourierizer/windows.h"

namespace fz {

using Signal = std::vector<double>;
using Channels = std::vector<Signal>;

struct Grid {
    Window window = Window::Hann;
    int L = 4096;   // window length
    int N = 4096;   // FFT size (zero-padding when N > L); power of two
    int H = 512;    // hop
};

/// Thrown by long computations when their cancel flag is raised.
struct Cancelled : std::runtime_error {
    Cancelled() : std::runtime_error("cancelled") {}
};

double nolaMin(const std::vector<double>& w, int H);

/// Throws std::invalid_argument unless N ≥ L, 1 ≤ H ≤ L and the window satisfies NOLA.
void validateGrid(const Grid& g);

/// Frames whose center lies within the signal: 1 + ceil(n / H).
int frameCount(long long n, const Grid& g);

/// Bin frequencies k·sr/N, k = 0..N/2.
std::vector<double> binFreqs(const Grid& g, double sr);

/// Called once per frame m (center time t = m·H/sr) to fill the mask row out[0..N/2].
using MaskRowFn = std::function<void(int m, double t, double* out)>;

/// y = ISTFT(M ⊙ STFT(x)) for each channel, normalized by Σw² (least squares). Output has the
/// input's length. Streams frame by frame: O(N) memory besides input and output. Frames whose
/// mask row is all zero skip their FFTs. If `cancel` becomes true, throws fz::Cancelled.
Channels maskedResynthesis(const Channels& x, const Grid& g, double sr, const MaskRowFn& mask,
                           const std::atomic<bool>* cancel = nullptr);

} // namespace fz
