#include "fourierizer/stft.h"

#include <algorithm>
#include <limits>
#include <string>

#include "fourierizer/fft.h"

namespace fz {

namespace {
constexpr double kEps = 1e-12;
}

double nolaMin(const std::vector<double>& w, int H) {
    std::vector<double> acc(H, 0.0);
    const int L = static_cast<int>(w.size());
    for (int start = 0; start < L; start += H)
        for (int i = 0; i < H && start + i < L; ++i) acc[i] += w[start + i] * w[start + i];
    return *std::min_element(acc.begin(), acc.end());
}

void validateGrid(const Grid& g) {
    if (g.N < g.L)
        throw std::invalid_argument("FFT size N=" + std::to_string(g.N) + " must be >= window length L=" + std::to_string(g.L));
    if (g.N < 4 || (g.N & (g.N - 1)) != 0)
        throw std::invalid_argument("FFT size N=" + std::to_string(g.N) + " must be a power of two");
    if (!(g.H >= 1 && g.H <= g.L))
        throw std::invalid_argument("hop H=" + std::to_string(g.H) + " must satisfy 1 <= H <= L=" + std::to_string(g.L));
    if (nolaMin(makeWindow(g.window, g.L), g.H) <= kEps)
        throw std::invalid_argument(std::string(windowName(g.window)) + " window with L=" + std::to_string(g.L) +
                                    ", H=" + std::to_string(g.H) + " violates NOLA");
}

int frameCount(long long n, const Grid& g) {
    const long long nn = std::max(n, 0LL);
    return 1 + static_cast<int>((nn + g.H - 1) / g.H);
}

std::vector<double> binFreqs(const Grid& g, double sr) {
    std::vector<double> f(g.N / 2 + 1);
    for (int k = 0; k < static_cast<int>(f.size()); ++k) f[k] = k * sr / g.N;
    return f;
}

Channels maskedResynthesis(const Channels& x, const Grid& g, double sr, const MaskRowFn& mask,
                           const std::atomic<bool>* cancel) {
    validateGrid(g);
    const long long n = x.empty() ? 0 : static_cast<long long>(x[0].size());
    const auto w = makeWindow(g.window, g.L);
    const int M = frameCount(n, g), L = g.L, H = g.H, left = L / 2;
    const long long total = static_cast<long long>(M - 1) * H + L;

    RealFFT fft(g.N);
    const int B = fft.bins();
    std::vector<double> frame(L), time(g.N), re(B), im(B), row(B);
    std::vector<double> wsum(total, 0.0);
    std::vector<Signal> y(x.size(), Signal(total, 0.0));

    for (int m = 0; m < M; ++m) {
        if (cancel && cancel->load(std::memory_order_relaxed)) throw Cancelled();
        mask(m, static_cast<double>(m) * H / sr, row.data());
        const long long base = static_cast<long long>(m) * H;
        for (int j = 0; j < L; ++j) wsum[base + j] += w[j] * w[j];
        if (std::all_of(row.begin(), row.end(), [](double v) { return v == 0.0; })) continue;
        const long long start = base - left;
        for (size_t c = 0; c < x.size(); ++c) {
            const Signal& xc = x[c];
            for (int j = 0; j < L; ++j) {
                const long long i = start + j;
                frame[j] = (i >= 0 && i < n) ? xc[i] * w[j] : 0.0;
            }
            fft.forward(frame.data(), L, re.data(), im.data());
            for (int k = 0; k < B; ++k) { re[k] *= row[k]; im[k] *= row[k]; }
            fft.inverse(re.data(), im.data(), time.data());
            double* yc = y[c].data() + base;
            for (int j = 0; j < L; ++j) yc[j] += time[j] * w[j];
        }
    }

    Channels out(x.size(), Signal(n, 0.0));
    for (size_t c = 0; c < x.size(); ++c)
        for (long long i = 0; i < n; ++i) {
            const long long p = left + i;
            if (p >= total) break;
            const double s = wsum[p];
            out[c][i] = y[c][p] / (s > kEps ? s : 1.0);
        }
    return out;
}

} // namespace fz
