#pragma once

#include <juce_audio_processors/juce_audio_processors.h>
#include <juce_audio_basics/juce_audio_basics.h>

#include <atomic>

// The "processor" is the audio engine. The host creates one per plugin instance and calls
// processBlock() on its real-time audio thread. Everything here must be real-time safe.
class PluginProcessor final : public juce::AudioProcessor
{
public:
    PluginProcessor();
    ~PluginProcessor() override = default;

    // --- lifecycle ------------------------------------------------------------------------
    void prepareToPlay (double sampleRate, int samplesPerBlock) override;
    void releaseResources() override {}
    bool isBusesLayoutSupported (const BusesLayout& layouts) const override;
    void processBlock (juce::AudioBuffer<float>&, juce::MidiBuffer&) override;
    using AudioProcessor::processBlock;

    // --- editor (UI) ----------------------------------------------------------------------
    juce::AudioProcessorEditor* createEditor() override;
    bool hasEditor() const override { return true; }

    // --- identity -------------------------------------------------------------------------
    const juce::String getName() const override { return JucePlugin_Name; }
    bool acceptsMidi() const override { return true; }
    bool producesMidi() const override { return false; }
    bool isMidiEffect() const override { return false; }
    double getTailLengthSeconds() const override { return 0.0; }

    // --- programs (legacy host concept; one program) --------------------------------------
    int getNumPrograms() override { return 1; }
    int getCurrentProgram() override { return 0; }
    void setCurrentProgram (int) override {}
    const juce::String getProgramName (int) override { return {}; }
    void changeProgramName (int, const juce::String&) override {}

    // --- state saved inside the DAW project -----------------------------------------------
    void getStateInformation (juce::MemoryBlock& destData) override;
    void setStateInformation (const void* data, int sizeInBytes) override;

    // --- shared with the editor -----------------------------------------------------------
    juce::AudioProcessorValueTreeState parameters;

    // Written on the audio thread, read on the UI thread: atomics, never locks.
    float getSidechainRms() const noexcept { return sidechainRms.load (std::memory_order_relaxed); }
    int getActiveVoices() const noexcept { return activeVoices.load (std::memory_order_relaxed); }
    int getSidechainChannels() const noexcept { return sidechainChannels.load (std::memory_order_relaxed); }

private:
    static juce::AudioProcessorValueTreeState::ParameterLayout createParameterLayout();

    juce::Synthesiser synth;
    juce::SmoothedValue<float> gainSmoothed;
    std::atomic<float>* gainDbParam = nullptr;

    std::atomic<float> sidechainRms { 0.0f };
    std::atomic<int> activeVoices { 0 };
    std::atomic<int> sidechainChannels { 0 };

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR (PluginProcessor)
};
