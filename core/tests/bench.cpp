// How long a render takes: 4 stereo layers of 30 s at 48 kHz with typical selections, on a few
// grids, serial and with one thread per layer. Prints milliseconds and the real-time factor.
#include <chrono>
#include <cstdlib>
#include <string>
#include <cmath>
#include <cstdio>
#include <numbers>
#include <random>
#include <thread>

#include "fourierizer/render.h"
#include "fourierizer/spectral.h"

using namespace fz;

int main(int argc, char** argv) {
    const double sr = 48000, seconds = argc > 1 ? std::atof(argv[1]) : 30.0;
    const size_t n = static_cast<size_t>(seconds * sr);
    std::mt19937_64 rng(1);
    std::normal_distribution<double> nd;
    auto source = [&](double f0) {
        Channels c(2, Signal(n));
        for (size_t i = 0; i < n; ++i) {
            const double t = i / sr, v = 0.4 * std::sin(2 * std::numbers::pi * f0 * t) + 0.2 * std::sin(2 * std::numbers::pi * 3 * f0 * t) + 0.05 * nd(rng);
            c[0][i] = v; c[1][i] = 0.9 * v;
        }
        return c;
    };
    auto rect = [](double t0, double t1, double f0, double f1, double fi = 0, double fo = 0) {
        Shape s; s.t = {t0, t1}; s.f = {f0, f1}; s.fadeIn = fi; s.fadeOut = fo; return s;
    };
    Shape lasso;
    lasso.kind = ShapeKind::Poly;
    lasso.points = {{1, 500}, {seconds * 0.3, 3200}, {seconds * 0.7, 3600}, {seconds * 0.9, 1800}, {seconds * 0.6, 600}, {seconds * 0.3, 900}};
    lasso.fadeOut = 0.5;

    for (Grid g : {Grid{Window::Hann, 4096, 4096, 512}, Grid{Window::Hann, 2048, 2048, 256}, Grid{Window::BlackmanHarris, 16384, 16384, 2048}}) {
        std::vector<LayerInput> layers;
        layers.push_back({source(110), g, {rect(0, seconds * 0.6, 120, 1000), rect(seconds * 0.7, seconds, 250, 2000, 0.2, 1.0)}});
        layers.push_back({source(55), g, {rect(0, seconds, 0, 160), rect(0, seconds, 7000, 20000)}, 0.01, 1.0 / 12, -3});
        layers.push_back({source(220), g, {lasso}, 0.01, 1.0 / 12, -1.5, 0.48});
        layers.push_back({source(440), g, {rect(0.8, seconds, 3000, 16000), [&] { auto s = rect(2, 2.6, 5000, 10000); s.mode = ShapeMode::Subtract; return s; }()}, 0.01, 1.0 / 12, -6});
        for (int threads : {1, 4}) {
            RenderOptions o;
            o.threads = threads;
            const auto t0 = std::chrono::steady_clock::now();
            const Channels y = render(layers, sr, o);
            const double ms = std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - t0).count();
            std::printf("%-16s L=%-5d H=%-4d  %d thread%s  %8.0f ms   %5.1fx real time  (peak %.3f)\n",
                        std::string(windowName(g.window)).c_str(), g.L, g.H, threads, threads > 1 ? "s" : " ", ms,
                        seconds * 1000 / ms, peakOf(y));
        }
    }
    std::printf("hardware threads: %u\n", std::thread::hardware_concurrency());

    // Spectral mode: one note of a stereo result, and how long until its first 4096 samples.
    auto result = std::make_shared<const Channels>(source(110));
    for (int win : {4096, 1024})
        for (double st : {7.0, -7.0, 12.0, 24.0}) {
            const auto t0 = std::chrono::steady_clock::now();
            SpectralShifter s(result, st, win);
            Channels part;
            s.process(4096, part);
            const double first = std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - t0).count();
            while (!s.done()) s.process(65536, part);
            const double ms = std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - t0).count();
            std::printf("spectral N=%-4d %+5.0f st   first 4096 samples %6.1f ms   whole %8.0f ms   %5.1fx real time\n",
                        win, st, first, ms, seconds * 1000 / ms);
        }
}
