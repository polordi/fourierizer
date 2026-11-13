// The C++ core must reproduce the Python reference (python/golden/data) to 1e-9, exactly like
// the TypeScript engine (ui/test/engine.test.ts). Plus a few properties that need no file.
#include <cmath>
#include <cstdio>
#include <fstream>
#include <functional>
#include <numbers>
#include <random>
#include <string>
#include <vector>

#include <nlohmann/json.hpp>

#include "fourierizer/fft.h"
#include "fourierizer/mask.h"
#include "fourierizer/ops.h"
#include "fourierizer/render.h"
#include "fourierizer/resample.h"
#include "fourierizer/spectrogram.h"
#include "fourierizer/stft.h"
#include "fourierizer/windows.h"

using json = nlohmann::json;
using namespace fz;

namespace {

int failures = 0;

void check(bool ok, const std::string& what) {
    std::printf("  %s %s\n", ok ? "ok  " : "FAIL", what.c_str());
    if (!ok) ++failures;
}

json load(const char* name) {
    std::ifstream f(std::string(FZ_GOLDEN_DIR) + name);
    if (!f) throw std::runtime_error(std::string("cannot open golden file ") + name);
    return json::parse(f);
}

double maxAbsDiff(const std::vector<double>& a, const json& b) {
    if (a.size() != b.size()) return INFINITY;
    double d = 0;
    for (size_t i = 0; i < a.size(); ++i) d = std::max(d, std::abs(a[i] - b[i].get<double>()));
    return d;
}

Signal signalOf(const json& j) { return j.get<std::vector<double>>(); }
Channels channelsOf(const json& j) {
    Channels c;
    for (auto& ch : j) c.push_back(signalOf(ch));
    return c;
}

Grid gridOf(const json& j) {
    return {windowFromName(j["window"].get<std::string>()), j["L"].get<int>(), j["N"].get<int>(), j["H"].get<int>()};
}

Shape shapeOf(const json& j) {
    Shape s;
    s.kind = j["kind"] == "rect" ? ShapeKind::Rect : ShapeKind::Poly;
    s.mode = j["mode"] == "subtract" ? ShapeMode::Subtract : ShapeMode::Add;
    s.gain = j.value("gain", 1.0);
    if (s.kind == ShapeKind::Rect) {
        s.t = {j["t"][0].get<double>(), j["t"][1].get<double>()};
        s.f = {j["f"][0].get<double>(), j["f"][1].get<double>()};
    } else {
        for (auto& p : j["points"]) s.points.push_back({p[0].get<double>(), p[1].get<double>()});
    }
    if (j.contains("featherS")) s.featherS = j["featherS"].get<double>();
    if (j.contains("featherOct")) s.featherOct = j["featherOct"].get<double>();
    s.fadeIn = j.value("fadeIn", 0.0);
    s.fadeOut = j.value("fadeOut", 0.0);
    return s;
}

std::vector<Shape> shapesOf(const json& j) {
    std::vector<Shape> v;
    for (auto& s : j) v.push_back(shapeOf(s));
    return v;
}

char buf[256];
const char* fmt(const char* f, double a) { std::snprintf(buf, sizeof buf, f, a); return buf; }

// ------------------------------------------------------------------------------------------
void testWindows() {
    std::puts("windows");
    const json g = load("windows.json");
    const int L = g["L"];
    for (auto& [name, ref] : g["windows"].items())
        check(maxAbsDiff(makeWindow(windowFromName(name), L), ref) < 1e-12, name);
}

void testFFT() {
    std::puts("real FFT");
    std::mt19937_64 rng(7);
    std::normal_distribution<double> nd;
    for (int n : {4, 8, 64, 1024, 16384}) {
        std::vector<double> x(n), y(n), re(n / 2 + 1), im(n / 2 + 1);
        for (double& v : x) v = nd(rng);
        RealFFT f(n);
        f.forward(x.data(), n, re.data(), im.data());
        // DFT at a few bins, by definition
        double err = 0;
        for (int k : {0, 1, n / 4, n / 2}) {
            double sr = 0, si = 0;
            for (int t = 0; t < n; ++t) {
                const double a = -2 * std::numbers::pi * k * t / n;
                sr += x[t] * std::cos(a); si += x[t] * std::sin(a);
            }
            err = std::max(err, std::hypot(re[k] - sr, im[k] - si) / std::sqrt(n));
        }
        f.inverse(re.data(), im.data(), y.data());
        double rt = 0;
        for (int i = 0; i < n; ++i) rt = std::max(rt, std::abs(x[i] - y[i]));
        check(err < 1e-10 && rt < 1e-12, "N=" + std::to_string(n) + fmt(": round trip %.1e", rt));
    }
}

void testLayers() {
    std::puts("masked resynthesis on five grids (Layer.synthesize)");
    const json g = load("layers.json");
    const Channels x = channelsOf(g["x"]);
    const auto shapes = shapesOf(g["shapes"]);
    const double sr = g["sr"];
    for (auto& c : g["cases"]) {
        LayerInput l{x, gridOf(c["grid"]), shapes};
        const Channels y = synthesizeLayer(l, sr);
        double d = 0;
        for (size_t ch = 0; ch < y.size(); ++ch) d = std::max(d, maxAbsDiff(y[ch], c["y"][ch]));
        check(d < 1e-9, c["grid"]["window"].get<std::string>() + " L=" + std::to_string(c["grid"]["L"].get<int>()) +
                            " N=" + std::to_string(c["grid"]["N"].get<int>()) + " H=" + std::to_string(c["grid"]["H"].get<int>()) +
                            fmt(": max diff %.2e", d));
    }
}

void testMasks() {
    std::puts("selection masks with time fades (Selection.rasterize)");
    const json g = load("masks.json");
    SelectionRaster r(shapesOf(g["shapes"]), logFreqs(g["freqs"].get<std::vector<double>>()));
    std::vector<double> row(g["freqs"].size());
    double d = 0;
    for (size_t m = 0; m < g["times"].size(); ++m) {
        r.row(g["times"][m].get<double>(), row.data());
        d = std::max(d, maxAbsDiff(row, g["M"][m]));
    }
    check(d < 1e-9, fmt("rect, concave lasso and faded eraser: max diff %.2e", d));
}

void testRender() {
    std::puts("render (gain, offset, mono to stereo, normalization)");
    const json g = load("render.json");
    std::vector<LayerInput> layers;
    for (auto& l : g["layers"]) {
        LayerInput in{channelsOf(l["x"]), gridOf(l["grid"]), shapesOf(l["shapes"])};
        in.gainDb = l["gainDb"]; in.offsetS = l["offsetS"];
        layers.push_back(std::move(in));
    }
    for (int threads : {1, 4}) {
        RenderOptions o;
        o.threads = threads;
        const Channels y = render(layers, g["sr"], o);
        double d = 0;
        for (int ch = 0; ch < 2; ++ch) d = std::max(d, maxAbsDiff(y[ch], g["y"][ch]));
        check(d < 1e-9, std::to_string(threads) + (threads == 1 ? " thread" : " threads") + fmt(": max diff %.2e", d));
    }
}

void testResample() {
    std::puts("resampler (Tape pitch, sample-rate conversion)");
    const json g = load("resample.json");
    const Signal x = signalOf(g["x"]);
    for (auto& c : g["cases"]) {
        const double step = c["step"];
        const auto y = resampleByStep(x, step);
        check(maxAbsDiff(y, c["y"]) < 1e-9, fmt("step %.5f", step));
    }
}

void testOps() {
    std::puts("operations (render_op)");
    const json g = load("ops.json");
    std::vector<OpLayer> layers;
    for (auto& l : g["layers"]) {
        OpLayer o{channelsOf(l["x"]), shapesOf(l["shapes"])};
        o.gainDb = l["gainDb"]; o.offsetS = l["offsetS"];
        layers.push_back(std::move(o));
    }
    for (auto& c : g["cases"]) {
        const std::string op = c["op"];
        const Channels y = renderOp(layers, opFromName(op), g["sr"], c["a"], c["b"], gridOf(g["grid"]));
        double d = 0;
        for (int ch = 0; ch < 2; ++ch) d = std::max(d, maxAbsDiff(y[ch], c["y"][ch]));
        check(d < 1e-9, op + " (" + std::to_string(c["a"].get<int>()) + ", " + std::to_string(c["b"].get<int>()) + ")" + fmt(": max diff %.2e", d));
    }
}

void testSpectrogram() {
    std::puts("display spectrogram");
    const double sr = 48000;
    Signal x(48000);
    for (size_t i = 0; i < x.size(); ++i) x[i] = std::sin(2 * std::numbers::pi * 1000 * i / sr);
    const auto img = spectrogramImage(x, sr, {Window::Hann, 4096, 4096, 1024}, 50, 360);
    // brightest row of the middle column must sit at 1 kHz on the log axis
    int best = 0;
    const int col = img.cols / 2;
    for (int r = 0; r < img.rows; ++r)
        if (img.data[r * img.cols + col] > img.data[best * img.cols + col]) best = r;
    const double y = (best + 0.5) / img.rows, f = kSpecFMin * std::pow(kSpecFMax / kSpecFMin, 1 - y);
    check(std::abs(std::log2(f / 1000)) < 0.03 && img.data[best * img.cols + col] == 255, fmt("1 kHz tone lands at %.0f Hz", f));
}

void testProperties() {
    std::puts("properties");
    // Full selection reproduces the input (perfect reconstruction).
    std::mt19937_64 rng(3);
    std::normal_distribution<double> nd;
    Signal x(20000);
    for (double& v : x) v = nd(rng);
    Shape all;
    all.t = {-1e9, 1e9}; all.f = {0, 1e9}; all.featherS = 0; all.featherOct = 0;
    LayerInput l{{x}, {Window::Hann, 2048, 2048, 512}, {all}};
    const Channels y = synthesizeLayer(l, 48000);
    double d = 0;
    for (size_t i = 0; i < x.size(); ++i) d = std::max(d, std::abs(y[0][i] - x[i]));
    check(d < 1e-10, fmt("full selection reproduces the input: %.1e", d));

    bool threw = false;
    try { validateGrid({Window::Hann, 1024, 1024, 1024}); } catch (const std::invalid_argument&) { threw = true; }
    check(threw, "NOLA violation is rejected (Hann, H = L)");

    std::atomic<bool> cancel{true};
    threw = false;
    try { synthesizeLayer(l, 48000, &cancel); } catch (const Cancelled&) { threw = true; }
    check(threw, "a raised cancel flag aborts the render");

    const auto up = tapePitch(x, 12);
    check(up.size() == x.size() / 2, "+12 st halves the length");
}

} // namespace

int main() {
    try {
        testWindows();
        testFFT();
        testLayers();
        testMasks();
        testRender();
        testResample();
        testOps();
        testSpectrogram();
        testProperties();
    } catch (const std::exception& e) {
        std::printf("error: %s\n", e.what());
        return 2;
    }
    std::printf(failures ? "\n%d FAILED\n" : "\nall passed\n", failures);
    return failures ? 1 : 0;
}
