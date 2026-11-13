#include "fourierizer/windows.h"

#include <array>
#include <cmath>
#include <numbers>
#include <stdexcept>
#include <string>

namespace fz {

namespace {
constexpr std::array<std::pair<std::string_view, Window>, 7> kNames{{
    {"rect", Window::Rect}, {"hann", Window::Hann}, {"hamming", Window::Hamming},
    {"blackman_harris", Window::BlackmanHarris}, {"kaiser", Window::Kaiser},
    {"gauss", Window::Gauss}, {"flat_top", Window::FlatTop},
}};

std::vector<double> cosineSum(int L, std::initializer_list<double> a) {
    std::vector<double> w(L);
    const double pi = std::numbers::pi;
    for (int n = 0; n < L; ++n) {
        double v = 0;
        int k = 0;
        for (double ak : a) {
            v += (k % 2 ? -1.0 : 1.0) * ak * std::cos(2 * pi * k * n / L);
            ++k;
        }
        w[n] = v;
    }
    return w;
}
} // namespace

Window windowFromName(std::string_view name) {
    for (auto& [s, w] : kNames)
        if (s == name) return w;
    throw std::invalid_argument("unknown window " + std::string(name));
}

std::string_view windowName(Window w) {
    for (auto& [s, v] : kNames)
        if (v == w) return s;
    return "?";
}

double besselI0(double x) {
    double sum = 1, term = 1;
    for (int k = 1; k < 200; ++k) {
        const double q = x / (2 * k);
        term *= q * q;
        sum += term;
        if (term < sum * 1e-17) break;
    }
    return sum;
}

std::vector<double> makeWindow(Window kind, int L, double beta, double sigma) {
    if (L < 2) throw std::invalid_argument("window length L must be at least 2");
    switch (kind) {
        case Window::Rect: return std::vector<double>(L, 1.0);
        case Window::Hann: return cosineSum(L, {0.5, 0.5});
        case Window::Hamming: return cosineSum(L, {0.54, 0.46});
        case Window::BlackmanHarris: return cosineSum(L, {0.35875, 0.48829, 0.14128, 0.01168});
        case Window::FlatTop: return cosineSum(L, {0.21557895, 0.41663158, 0.277263158, 0.083578947, 0.006947368});
        case Window::Kaiser: {
            // numpy.kaiser(L + 1, beta)[:-1]: symmetric Kaiser of length L+1 without its last sample.
            std::vector<double> w(L);
            const double alpha = L / 2.0, d = besselI0(beta);
            for (int n = 0; n < L; ++n) {
                const double r = (n - alpha) / alpha;
                w[n] = besselI0(beta * std::sqrt(std::max(0.0, 1 - r * r))) / d;
            }
            return w;
        }
        case Window::Gauss: {
            std::vector<double> w(L);
            for (int n = 0; n < L; ++n) {
                const double u = (n - L / 2.0) / (sigma * L / 2.0);
                w[n] = std::exp(-0.5 * u * u);
            }
            return w;
        }
    }
    throw std::invalid_argument("unknown window");
}

} // namespace fz
