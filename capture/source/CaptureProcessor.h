// Fourierizer Capture: passes audio through untouched and, while recording, writes it to a WAV
// file (24-bit, the host's rate) in Documents/Fourierizer/Captures.
//
// Two ways to record:
//   Rec                  starts and stops by hand.
//   Record while playing starts exactly when the host's transport starts and stops when it stops.
//                        A file is prepared ("armed") in advance, so the first sample is kept.
//
// Real-time rules: the audio thread never allocates, opens files or waits. Files are created and
// closed on the message thread; the audio thread only moves ready-made recorders between slots
// (under a try-lock) and feeds the active one through JUCE's ThreadedWriter (a lock-free FIFO
// drained by a background thread).
#pragma once

#include <juce_audio_formats/juce_audio_formats.h>
#include <juce_audio_processors/juce_audio_processors.h>

#include <array>
#include <atomic>
#include <memory>

class CaptureProcessor : public juce::AudioProcessor, private juce::Timer {
public:
    CaptureProcessor();
    ~CaptureProcessor() override;

    void prepareToPlay(double sampleRate, int samplesPerBlock) override;
    void releaseResources() override;
    bool isBusesLayoutSupported(const BusesLayout& layouts) const override;
    void processBlock(juce::AudioBuffer<float>&, juce::MidiBuffer&) override;

    juce::AudioProcessorEditor* createEditor() override;
    bool hasEditor() const override { return true; }

    const juce::String getName() const override { return JucePlugin_Name; }
    bool acceptsMidi() const override { return false; }
    bool producesMidi() const override { return false; }
    bool isMidiEffect() const override { return false; }
    double getTailLengthSeconds() const override { return 0.0; }
    int getNumPrograms() override { return 1; }
    int getCurrentProgram() override { return 0; }
    void setCurrentProgram(int) override {}
    const juce::String getProgramName(int) override { return {}; }
    void changeProgramName(int, const juce::String&) override {}

    void getStateInformation(juce::MemoryBlock& destData) override;
    void setStateInformation(const void* data, int sizeInBytes) override;
    void updateTrackProperties(const TrackProperties& properties) override;

    // ---- message thread (the editor)
    void toggleRecord();
    void setFollowTransport(bool on);
    bool followTransport() const { return follow_.load(); }
    bool isRecording() const { return recording_.load(); }
    double recordedSeconds() const { return (double) recorded_.load() / std::max(1.0, sampleRate_.load()); }
    float takePeak(int channel) { return peak_[(size_t) juce::jlimit(0, 1, channel)].exchange(0.0f); }
    juce::String lastCapture() const { return lastCapture_; }
    juce::String trackName() const { return trackName_; }
    std::function<void()> onCaptureSaved;

private:
    struct Recorder {
        std::unique_ptr<juce::AudioFormatWriter::ThreadedWriter> writer;
        juce::File file;
        juce::Time started;
        juce::int64 samples = 0;
    };

    void timerCallback() override;               // finishes recordings, re-arms
    std::unique_ptr<Recorder> makeRecorder();
    void finish(std::unique_ptr<Recorder> r);
    void disarm();

    juce::TimeSliceThread writerThread_{"Fourierizer Capture writer"};
    juce::SpinLock lock_;                        // guards the three slots below
    std::unique_ptr<Recorder> armed_, active_;
    std::array<std::unique_ptr<Recorder>, 4> done_;

    std::atomic<bool> follow_{false}, recording_{false}, byTransport_{false}, holdUntilStop_{false}, wasPlaying_{false};
    std::atomic<juce::int64> recorded_{0};
    std::atomic<double> sampleRate_{48000.0};
    std::array<std::atomic<float>, 2> peak_{};
    juce::String lastCapture_, trackName_;

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR(CaptureProcessor)
};
