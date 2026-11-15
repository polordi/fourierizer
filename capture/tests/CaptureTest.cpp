// Fourierizer Capture without a host: a fake transport plays a 440 Hz tone through the processor.
//   Record while playing  the file starts on the first played sample and ends when playback stops
//   REC by hand           records between the two presses
//   60 s limit            a long playback is cut at 60 s
// The files go to Documents/Fourierizer/Captures under the track name "FzTest" and are deleted.
#include <juce_audio_formats/juce_audio_formats.h>
#include <juce_audio_processors/juce_audio_processors.h>
#include <juce_events/juce_events.h>

#include <Captures.h>

#include <cmath>
#include <cstdio>
#include <numbers>

#include "../source/CaptureEditor.h"
#include "../source/CaptureProcessor.h"

namespace {
int failures = 0;
void check(bool ok, const juce::String& what) {
    std::printf("  %s %s\n", ok ? "ok  " : "FAIL", what.toRawUTF8());
    if (!ok) ++failures;
}

struct FakeHead : juce::AudioPlayHead {
    bool playing = false;
    juce::Optional<PositionInfo> getPosition() const override {
        PositionInfo p;
        p.setIsPlaying(playing);
        return p;
    }
};

constexpr double kRate = 48000;
constexpr int kBlock = 480;
juce::int64 phase = 0;

void run(CaptureProcessor& p, double seconds) {
    juce::AudioBuffer<float> b(2, kBlock);
    juce::MidiBuffer midi;
    for (int k = 0; k < (int) std::round(seconds * kRate / kBlock); ++k) {
        for (int i = 0; i < kBlock; ++i) {
            const float v = 0.5f * (float) std::sin(2 * std::numbers::pi * 440 * (double) (phase + i) / kRate);
            b.setSample(0, i, v);
            b.setSample(1, i, -v);
        }
        phase += kBlock;
        p.processBlock(b, midi);
    }
}

void pump(int ms) { juce::MessageManager::getInstance()->runDispatchLoopUntil(ms); }

juce::Array<juce::File> testFiles() {
    return fzshared::capturesFolder().findChildFiles(juce::File::findFiles, false, "FzTest*.wav");
}

/// Length (s) and the first sample's value, which tells whether the file starts on the first block.
std::pair<double, float> inspect(const juce::File& f) {
    juce::WavAudioFormat wav;
    std::unique_ptr<juce::AudioFormatReader> r(wav.createReaderFor(f.createInputStream().release(), true));
    if (r == nullptr) return {-1.0, 0.0f};
    juce::AudioBuffer<float> b(2, 4);
    r->read(&b, 0, 4, 0, true, true);
    return {(double) r->lengthInSamples / r->sampleRate, b.getSample(0, 1)};
}
} // namespace

int main(int argc, char** argv) {
    juce::ScopedJuceInitialiser_GUI init;
    for (auto& f : testFiles()) f.deleteFile();

    CaptureProcessor p;
    FakeHead head;
    p.setPlayHead(&head);
    p.prepareToPlay(kRate, kBlock);
    juce::AudioProcessor::TrackProperties tp;
    tp.name = juce::String("FzTest");
    p.updateTrackProperties(tp);

    std::puts("record while playing");
    p.setFollowTransport(true);
    pump(200);                       // the timer arms a file
    head.playing = true;
    phase = 0;
    run(p, 2.0);
    check(p.isRecording(), "recording while the transport plays");
    head.playing = false;
    run(p, 0.1);
    check(!p.isRecording(), "stops when the transport stops");
    pump(300);
    auto files = testFiles();
    check(files.size() == 1, "one file, named after the track: " + (files.isEmpty() ? juce::String("none") : files[0].getFileName()));
    if (!files.isEmpty()) {
        const auto [len, s1] = inspect(files[0]);
        const float expected = 0.5f * (float) std::sin(2 * std::numbers::pi * 440 / kRate);
        check(std::abs(len - 2.0) < 0.011, juce::String::formatted("2.00 s long (%.3f s)", len));
        check(std::abs(s1 - expected) < 1e-4f, "starts on the very first played sample");
    }
    p.setFollowTransport(false);
    for (auto& f : testFiles()) f.deleteFile();

    std::puts("REC by hand");
    pump(100);
    p.toggleRecord();
    run(p, 1.0);
    if (argc > 1) {   // a picture of the window while recording
        std::unique_ptr<juce::AudioProcessorEditor> ed(p.createEditor());
        pump(200);
        run(p, 0.2);
        pump(100);
        const juce::File png{juce::String(argv[1])};
        png.deleteFile();
        juce::FileOutputStream out{png};
        juce::PNGImageFormat().writeImageToStream(ed->createComponentSnapshot(ed->getLocalBounds(), true, 2.0f), out);
        std::printf("  snapshot: %s\n", argv[1]);
    }
    p.toggleRecord();
    pump(300);
    files = testFiles();
    const double expected = argc > 1 ? 1.2 : 1.0;   // the snapshot records 0.2 s more
    check(files.size() == 1 && std::abs(inspect(files[0]).first - expected) < 0.011, juce::String::formatted("one file of %.2f s", expected));
    for (auto& f : testFiles()) f.deleteFile();

    std::puts("start on signal");
    {
        p.setWaitForSignal(true);
        check(std::abs(p.thresholdDb() + 45.0f) < 0.01f, "default threshold -45 dB");
        p.toggleRecord();
        check(p.isWaiting() && !p.isRecording(), "REC waits");
        juce::AudioBuffer<float> b(2, kBlock);
        juce::MidiBuffer midi;
        for (int k = 0; k < 100; ++k) {   // 1 s of quiet noise at about −66 dB: nothing happens
            for (int c = 0; c < 2; ++c)
                for (int i = 0; i < kBlock; ++i) b.setSample(c, i, 0.0005f * (float) std::sin(0.37 * (k * kBlock + i)));
            p.processBlock(b, midi);
        }
        check(p.isWaiting() && !p.isRecording(), "quiet input does not start it");
        phase = 0;
        run(p, 1.0);   // the tone (−6 dB) starts it
        check(p.isRecording() && !p.isWaiting(), "a note starts it");
        p.toggleRecord();
        pump(300);
        files = testFiles();
        const double len = files.isEmpty() ? -1 : inspect(files[0]).first;
        check(files.size() == 1 && std::abs(len - 1.05) < 0.011, juce::String::formatted("1 s of tone + 50 ms before it (%.3f s)", len));
        for (auto& f : testFiles()) f.deleteFile();
        p.setWaitForSignal(false);
    }

    std::puts("60 s limit");
    p.setFollowTransport(true);
    pump(200);
    head.playing = true;
    run(p, 63.0);
    check(!p.isRecording(), "stops by itself at 60 s while still playing");
    run(p, 1.0);
    check(!p.isRecording(), "and does not start again until the transport stops");
    head.playing = false;
    run(p, 0.1);
    pump(400);
    files = testFiles();
    check(files.size() == 1 && std::abs(inspect(files[0]).first - 60.0) < 0.011, "one file of 60.00 s");
    p.setFollowTransport(false);
    pump(100);
    for (auto& f : testFiles()) f.deleteFile();
    check(fzshared::capturesFolder().findChildFiles(juce::File::findFiles, false, "Recording*.wav").isEmpty(), "no armed file left behind");

    std::printf(failures ? "\n%d FAILED\n" : "\nall passed\n", failures);
    return failures ? 1 : 0;
}
