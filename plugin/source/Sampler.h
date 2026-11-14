// The instrument's sound: polyphonic playback of the rendered result with an envelope per voice,
// plus a one-shot "preview" voice for a single layer's selection. Two modes:
//   Tape      the result read at rate 2^((note−root)/12): higher is also shorter
//   Spectral  a pitch-shifted copy per semitone (SpectralBank), read at rate 1: same length
//
// Real-time rules: the audio thread never allocates, locks or frees. New buffers arrive through
// a try-locked hand-off; buffers that are no longer used are freed on the message thread by
// collectGarbage() (a "release pool": the pool keeps one reference, so the audio thread can
// never drop the last one). Notes from the UI arrive through a lock-free FIFO.
#pragma once

#include <juce_audio_basics/juce_audio_basics.h>
#include <juce_core/juce_core.h>

#include <array>
#include <atomic>

namespace fzp {

struct SampleBuffer : juce::ReferenceCountedObject {
    using Ptr = juce::ReferenceCountedObjectPtr<SampleBuffer>;
    juce::AudioBuffer<float> audio;
    double sampleRate = 48000.0;
    /// Spectral copies are played while they are computed: samples [0, ready) are final.
    std::atomic<int> ready{std::numeric_limits<int>::max()};
    std::atomic<bool> abandoned{false};   // will not grow any further (the result changed)
};

class SpectralBank;

struct Envelope {
    float attack = 0.06f, decay = 0.45f, sustain = 0.7f, release = 0.8f;  // seconds / level
};

class Sampler {
public:
    Sampler();

    void prepare(double hostSampleRate);
    void setBank(SpectralBank* bank) { bank_ = bank; }   // before playback starts

    // ---- any non-audio thread
    void setResult(SampleBuffer::Ptr buffer);
    /// One-shot preview of a layer: the selection and, in sync, its original sound (A/B).
    void playPreview(int layer, SampleBuffer::Ptr selection, SampleBuffer::Ptr original, float gain, bool startOriginal);
    void setPreviewOriginal(bool on) { previewOriginal_ = on; }
    void stopPreview();
    void uiNoteOn(int note, float velocity);
    void uiNoteOff(int note);
    void uiAllOff();
    void collectGarbage();  // message thread, a few times per second

    // ---- audio thread
    /// `spectral`: notes keep the result's length (copies from the SpectralBank) instead of Tape.
    /// `offline`: the host renders faster than real time, so waiting for a copy is allowed.
    void process(juce::AudioBuffer<float>& out, const juce::MidiBuffer& midi, const Envelope& env, int root, float gain,
                 bool spectral = false, bool offline = false);

    // ---- read by the UI (any thread)
    float resultPosition() const { return resultPos_.load(); }   // newest sounding voice, 0..1, or −1
    int previewLayer() const { return previewLayerOut_.load(); }
    float previewPosition() const { return previewPos_.load(); }
    int activeVoices() const { return activeVoices_.load(); }
    bool hasResult() const { return hasResult_.load(); }

private:
    struct Voice {
        bool active = false, released = false, held = false;
        bool waiting = false;   // Spectral: its copy does not exist yet
        int note = 0, shift = 0;
        float velocity = 1, level = 0, releaseFrom = 0;
        double pos = 0, step = 1, t = 0, tRelease = 0;
        juce::uint32 age = 0;
        SampleBuffer::Ptr buffer;
    };
    struct UiEvent { int type, note; float velocity; };   // 0 on, 1 off, 2 all off

    void noteOn(int note, float velocity, int root, bool spectral);
    bool attach(Voice& v, bool offline);   // Spectral: find the voice's copy; false = not yet
    void noteOff(int note);
    void allOff();
    void startRelease(Voice& v);
    float envelopeStep(Voice& v, const Envelope& env, double dt);
    void takePending();

    double hostRate_ = 48000.0;
    SpectralBank* bank_ = nullptr;
    std::array<Voice, 24> voices_;
    juce::uint32 ageCounter_ = 0;
    bool sustainPedal_ = false;

    SampleBuffer::Ptr current_;                         // audio thread only
    struct Preview { SampleBuffer::Ptr buffer, original; double pos = 0; float gain = 1, mix = 0; int layer = -1; bool active = false; float fade = 1; bool stopping = false; } preview_;
    std::atomic<bool> previewOriginal_{false};

    juce::SpinLock handoff_;                            // guards pending* and pool_
    SampleBuffer* pendingResult_ = nullptr;
    SampleBuffer* pendingPreview_ = nullptr;
    SampleBuffer* pendingOriginal_ = nullptr;
    int pendingPreviewLayer_ = -1;
    float pendingPreviewGain_ = 1;
    std::atomic<bool> stopPreviewFlag_{false};
    juce::ReferenceCountedArray<SampleBuffer> pool_;

    juce::AbstractFifo fifo_{256};
    std::array<UiEvent, 256> fifoData_;

    std::atomic<float> resultPos_{-1}, previewPos_{-1};
    std::atomic<int> previewLayerOut_{-1}, activeVoices_{0};
    std::atomic<bool> hasResult_{false};
};

} // namespace fzp
