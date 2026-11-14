// Fourierizer instrument: an AudioProcessor that owns the Engine (sources, renders, project)
// and the Sampler (what you hear). Playback controls are host parameters, so FL Studio can link
// them to a MIDI controller and automate them.
#pragma once

#include <juce_audio_processors/juce_audio_processors.h>

#include "Engine.h"
#include "Sampler.h"

class FourierizerProcessor : public juce::AudioProcessor, private juce::Timer {
public:
    FourierizerProcessor();
    ~FourierizerProcessor() override;

    void prepareToPlay(double sampleRate, int samplesPerBlock) override;
    void releaseResources() override {}
    bool isBusesLayoutSupported(const BusesLayout& layouts) const override;
    void processBlock(juce::AudioBuffer<float>&, juce::MidiBuffer&) override;

    juce::AudioProcessorEditor* createEditor() override;
    bool hasEditor() const override { return true; }

    const juce::String getName() const override { return JucePlugin_Name; }
    bool acceptsMidi() const override { return true; }
    bool producesMidi() const override { return false; }
    bool isMidiEffect() const override { return false; }
    double getTailLengthSeconds() const override { return 5.0; }

    int getNumPrograms() override { return 1; }
    int getCurrentProgram() override { return 0; }
    void setCurrentProgram(int) override {}
    const juce::String getProgramName(int) override { return {}; }
    void changeProgramName(int, const juce::String&) override {}

    void getStateInformation(juce::MemoryBlock& destData) override;
    void setStateInformation(const void* data, int sizeInBytes) override;

    juce::AudioProcessorValueTreeState parameters;
    fzp::SpectralBank bank;                 // declared first: the sampler and engine use it
    fzp::Sampler sampler;
    fzp::Engine engine{sampler, bank};

    /// Knob positions (0..1) of the envelope, as in the UI, the root note, the playback mode
    /// ("tape" / "spectral") and the spectral window ("tonal" / "mixed" / "punchy").
    juce::var samplerParams() const;
    void setSamplerParams(const juce::var& p);

    static fzp::Envelope envelopeFromKnobs(float a, float d, float s, float r);

private:
    void timerCallback() override {
        sampler.collectGarbage();
        bank.collectGarbage();
    }
    static juce::AudioProcessorValueTreeState::ParameterLayout createLayout();

    std::atomic<float>* attack_ = nullptr;
    std::atomic<float>* decay_ = nullptr;
    std::atomic<float>* sustain_ = nullptr;
    std::atomic<float>* release_ = nullptr;
    std::atomic<float>* root_ = nullptr;
    std::atomic<float>* volume_ = nullptr;
    std::atomic<float>* mode_ = nullptr;
    std::atomic<float>* window_ = nullptr;
    juce::SmoothedValue<float> gain_;

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR(FourierizerProcessor)
};
