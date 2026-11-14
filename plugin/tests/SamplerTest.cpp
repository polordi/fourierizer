// The instrument's sound without a host: the Sampler and the SpectralBank play a 2 s, 220 Hz
// result one octave up (MIDI 60, root 48), as FL Studio would.
//   Tape      440 Hz, and the note ends after 1 s (twice as fast)
//   Spectral  440 Hz, and the note lasts the full 2 s
// Offline (an export): Spectral waits for its copy, so the note starts on time.
// Real time: the first play of a note waits only for the first chunk, and never drops out after.
#include <juce_audio_basics/juce_audio_basics.h>

#include <cmath>
#include <cstdio>
#include <numbers>
#include <thread>

#include "../source/Sampler.h"
#include "../source/SpectralBank.h"

using namespace fzp;

namespace {

int failures = 0;
void check(bool ok, const char* what) {
    std::printf("  %s %s\n", ok ? "ok  " : "FAIL", what);
    if (!ok) ++failures;
}

constexpr double kRate = 48000;
constexpr int kBlock = 512;

struct Take {
    std::vector<float> left;
    double freq(double t0, double t1) const {   // zero crossings
        int crossings = 0;
        for (auto i = (size_t) (t0 * kRate) + 1; i < (size_t) (t1 * kRate); ++i)
            if ((left[i - 1] < 0) != (left[i] < 0)) ++crossings;
        return crossings / (2 * (t1 - t0));
    }
    double rms(double t0, double t1) const {
        double s = 0;
        const auto a = (size_t) (t0 * kRate), b = (size_t) (t1 * kRate);
        for (auto i = a; i < b; ++i) s += (double) left[i] * left[i];
        return std::sqrt(s / (double) (b - a));
    }
    double onsetMs() const {
        for (size_t i = 0; i < left.size(); ++i)
            if (std::abs(left[i]) > 1e-4f) return i * 1000.0 / kRate;
        return -1;
    }
    int dropouts(double t0, double t1) const {   // silent runs longer than 2 ms inside the note
        int runs = 0, zeros = 0;
        for (auto i = (size_t) (t0 * kRate); i < (size_t) (t1 * kRate); ++i) {
            zeros = left[i] == 0.0f ? zeros + 1 : 0;
            if (zeros == 96) ++runs;
        }
        return runs;
    }
};

Take play(bool spectral, bool offline) {
    const int n = (int) (2 * kRate);
    auto audio = std::make_shared<fz::Channels>(2, fz::Signal((size_t) n));
    SampleBuffer::Ptr buf = new SampleBuffer();
    buf->audio.setSize(2, n);
    for (int i = 0; i < n; ++i) {
        const double v = 0.5 * std::sin(2 * std::numbers::pi * 220 * i / kRate);
        for (int c = 0; c < 2; ++c) { (*audio)[(size_t) c][(size_t) i] = v; buf->audio.setSample(c, i, (float) v); }
    }

    SpectralBank bank;
    Sampler sampler;
    sampler.setBank(&bank);
    sampler.prepare(kRate);
    sampler.setResult(buf);
    bank.setSource(audio, buf);
    const Envelope env{0.002f, 0.1f, 1.0f, 0.02f};

    Take take;
    const int blocks = (int) (3 * kRate / kBlock), off = (int) (2.5 * kRate);
    for (int b = 0; b < blocks; ++b) {
        juce::MidiBuffer midi;
        if (b == 0) midi.addEvent(juce::MidiMessage::noteOn(1, 60, 1.0f), 0);
        if (off >= b * kBlock && off < (b + 1) * kBlock) midi.addEvent(juce::MidiMessage::noteOff(1, 60), off - b * kBlock);
        juce::AudioBuffer<float> block(2, kBlock);
        block.clear();
        bank.configure(spectral, 4096);
        sampler.process(block, midi, env, 48, 1.0f, spectral, offline);
        take.left.insert(take.left.end(), block.getReadPointer(0), block.getReadPointer(0) + kBlock);
        if (!offline) std::this_thread::sleep_for(std::chrono::microseconds((int) (1e6 * kBlock / kRate)));
        if (b % 20 == 0) { sampler.collectGarbage(); bank.collectGarbage(); }
    }
    return take;
}

} // namespace

int main() {
    char line[160];
    std::puts("tape, offline");
    auto t = play(false, true);
    std::snprintf(line, sizeof line, "one octave up: %.1f Hz", t.freq(0.2, 0.8));
    check(std::abs(t.freq(0.2, 0.8) - 440) < 3, line);
    std::snprintf(line, sizeof line, "ends after 1 s (level at 1.2-1.8 s: %.4f)", t.rms(1.2, 1.8));
    check(t.rms(1.2, 1.8) < 1e-3, line);

    std::puts("spectral, offline (an export)");
    auto s = play(true, true);
    std::snprintf(line, sizeof line, "one octave up: %.1f Hz", s.freq(0.2, 0.8));
    check(std::abs(s.freq(0.2, 0.8) - 440) < 3, line);
    std::snprintf(line, sizeof line, "still at 440 Hz near the end: %.1f Hz", s.freq(1.4, 1.9));
    check(std::abs(s.freq(1.4, 1.9) - 440) < 3, line);
    std::snprintf(line, sizeof line, "lasts the full 2 s (level at 1.2-1.8 s: %.3f)", s.rms(1.2, 1.8));
    check(std::abs(s.rms(1.2, 1.8) - 0.5 / std::sqrt(2.0)) < 0.02, line);
    std::snprintf(line, sizeof line, "starts on time: %.2f ms", s.onsetMs());
    check(s.onsetMs() >= 0 && s.onsetMs() < 1, line);

    std::puts("spectral, real time (first play of a note)");
    auto r = play(true, false);
    std::snprintf(line, sizeof line, "waits for the first chunk only: starts after %.1f ms", r.onsetMs());
    check(r.onsetMs() >= 0 && r.onsetMs() < 100, line);   // ~11 ms here; CI machines are slower
    std::snprintf(line, sizeof line, "no dropouts afterwards (%d)", r.dropouts(r.onsetMs() / 1000 + 0.01, 1.9));
    check(r.dropouts(r.onsetMs() / 1000 + 0.01, 1.9) == 0, line);
    std::snprintf(line, sizeof line, "one octave up: %.1f Hz", r.freq(0.4, 1.0));
    check(std::abs(r.freq(0.4, 1.0) - 440) < 3, line);

    std::printf(failures ? "\n%d FAILED\n" : "\nall passed\n", failures);
    return failures ? 1 : 0;
}
