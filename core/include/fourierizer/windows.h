// Periodic analysis windows w[n], n = 0..L−1 (python/fourierizer_ref/windows.py).
#pragma once

#include <string_view>
#include <vector>

namespace fz {

enum class Window { Rect, Hann, Hamming, BlackmanHarris, Kaiser, Gauss, FlatTop };

/// "rect", "hann", "hamming", "blackman_harris", "kaiser", "gauss", "flat_top".
Window windowFromName(std::string_view name);
std::string_view windowName(Window w);

/// Modified Bessel function of the first kind, order 0 (power series).
double besselI0(double x);

/// Kaiser uses β = 8 and Gauss σ = 0.4 (of the half-length) unless given.
std::vector<double> makeWindow(Window w, int L, double beta = 8.0, double sigma = 0.4);

} // namespace fz
