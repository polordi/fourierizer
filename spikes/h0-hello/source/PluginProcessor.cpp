#include "PluginProcessor.h"
#include "PluginEditor.h"

#include <cmath>

namespace
{
// ---- A minimal sine voice ---------------------------------------------------------------
// juce::Synthesiser handles voice allocation (polyphony, voice stealing); each voice renders
// one note. Here a voice is a sine oscillator with a short ADSR envelope.
struct SineSound final : juce::SynthesiserSound
{
    bool appliesToNote (int) override { return true; }
    bool appliesToChannel (int) override { return true; }
};

class SineVoice final : public juce::SynthesiserVoice
{
public:
    bool canPlaySound (juce::SynthesiserSound* s) override { return dynamic_cast<SineSound*> (s) != nullptr; }

    void setCurrentPlaybackSampleRate (double newRate) override
    {
        SynthesiserVoice::setCurrentPlaybackSampleRate (newRate);
        if (newRate > 0.0)
        {
            envelope.setSampleRate (newRate);
            envelope.setParameters ({ 0.005f, 0.15f, 0.7f, 0.3f }); // attack, decay, sustain, release
        }
    }

    void startNote (int midiNote, float velocity, juce::SynthesiserSound*, int) override
    {
        const auto hz = juce::MidiMessage::getMidiNoteInHertz (midiNote);
        phaseDelta = juce::MathConstants<double>::twoPi * hz / getSampleRate();
        level = 0.25f * velocity;
        envelope.noteOn();
    }

    void stopNote (float, bool allowTailOff) override
    {
        if (allowTailOff)
            envelope.noteOff();
        else
        {
            envelope.reset();
            clearCurrentNote();
        }
    }

    void pitchWheelMoved (int) override {}
    void controllerMoved (int, int) override {}

    void renderNextBlock (juce::AudioBuffer<float>& out, int start, int numSamples) override
    {
        if (! isVoiceActive())
            return;

        for (int i = start; i < start + numSamples; ++i)
        {
            const auto sample = static_cast<float> (std::sin (phase)) * level * envelope.getNextSample();
            phase += phaseDelta;
            if (phase >= juce::MathConstants<double>::twoPi)
                phase -= juce::MathConstants<double>::twoPi;

            for (int ch = 0; ch < out.getNumChannels(); ++ch)
                out.addSample (ch, i, sample);

            if (! envelope.isActive())
            {
                clearCurrentNote();
                break;
            }
        }
    }

private:
    juce::ADSR envelope;
    double phase = 0.0, phaseDelta = 0.0;
    float level = 0.0f;
};
} // namespace

// ---- Processor -------------------------------------------------------------------------
PluginProcessor::PluginProcessor()
    : AudioProcessor (BusesProperties()
                          .withOutput ("Output", juce::AudioChannelSet::stereo(), true)
                          // H0 spike, variant B: can the host feed audio into an instrument?
                          // Variant A declared only a main input; FL's generator wrapper showed
                          // no input ports. Here the main input is off and a second (aux /
                          // sidechain) bus is on, which VST3 hosts treat as a separate port.
                          .withInput ("Input", juce::AudioChannelSet::stereo(), false)
                          .withInput ("Sidechain", juce::AudioChannelSet::stereo(), true)),
      parameters (*this, nullptr, "STATE", createParameterLayout())
{
    gainDbParam = parameters.getRawParameterValue ("gain");

    constexpr int numVoices = 8;
    for (int i = 0; i < numVoices; ++i)
        synth.addVoice (new SineVoice());
    synth.addSound (new SineSound());
}

juce::AudioProcessorValueTreeState::ParameterLayout PluginProcessor::createParameterLayout()
{
    // Parameter IDs are a contract with saved projects: never rename them.
    juce::AudioProcessorValueTreeState::ParameterLayout layout;
    layout.add (std::make_unique<juce::AudioParameterFloat> (
        juce::ParameterID { "gain", 1 },
        "Gain",
        juce::NormalisableRange<float> (-48.0f, 6.0f, 0.1f),
        -6.0f,
        juce::AudioParameterFloatAttributes().withLabel ("dB")));
    return layout;
}

bool PluginProcessor::isBusesLayoutSupported (const BusesLayout& layouts) const
{
    const auto out = layouts.getMainOutputChannelSet();
    if (out != juce::AudioChannelSet::stereo() && out != juce::AudioChannelSet::mono())
        return false;

    for (const auto& in : layouts.inputBuses)
        if (! (in.isDisabled() || in == juce::AudioChannelSet::mono() || in == juce::AudioChannelSet::stereo()))
            return false;
    return true;
}

void PluginProcessor::prepareToPlay (double sampleRate, int)
{
    // Called on the message thread before playback starts: the right place to allocate.
    synth.setCurrentPlaybackSampleRate (sampleRate);
    gainSmoothed.reset (sampleRate, 0.02); // 20 ms ramps avoid zipper noise
    gainSmoothed.setCurrentAndTargetValue (juce::Decibels::decibelsToGain (gainDbParam->load()));
}

void PluginProcessor::processBlock (juce::AudioBuffer<float>& buffer, juce::MidiBuffer& midi)
{
    juce::ScopedNoDenormals noDenormals;
    const int numSamples = buffer.getNumSamples();

    // 1. Measure the sidechain BEFORE we overwrite the buffer: in JUCE the input and output
    //    buses share the same channel memory.
    //    Every enabled input bus counts (main or sidechain), so the meter shows whichever the
    //    host actually feeds.
    int inChannels = 0;
    float sumSquares = 0.0f;
    for (int bus = 0; bus < getBusCount (true); ++bus)
    {
        const auto inBus = getBusBuffer (buffer, true, bus);
        inChannels += inBus.getNumChannels();
        for (int ch = 0; ch < inBus.getNumChannels(); ++ch)
        {
            const auto* x = inBus.getReadPointer (ch);
            for (int i = 0; i < numSamples; ++i)
                sumSquares += x[i] * x[i];
        }
    }
    sidechainChannels.store (inChannels, std::memory_order_relaxed);
    const int count = juce::jmax (1, numSamples * inChannels);
    const float rms = std::sqrt (sumSquares / static_cast<float> (count));
    // Simple meter ballistics: instant attack, smooth release.
    const float prev = sidechainRms.load (std::memory_order_relaxed);
    sidechainRms.store (rms > prev ? rms : prev * 0.85f + rms * 0.15f, std::memory_order_relaxed);

    // 2. Render the synth into the output bus.
    auto outBus = getBusBuffer (buffer, false, 0);
    outBus.clear();
    synth.renderNextBlock (outBus, midi, 0, numSamples);

    // 3. Apply the gain parameter with smoothing.
    gainSmoothed.setTargetValue (juce::Decibels::decibelsToGain (gainDbParam->load()));
    for (int i = 0; i < numSamples; ++i)
    {
        const float g = gainSmoothed.getNextValue();
        for (int ch = 0; ch < outBus.getNumChannels(); ++ch)
            outBus.getWritePointer (ch)[i] *= g;
    }

    int voices = 0;
    for (int i = 0; i < synth.getNumVoices(); ++i)
        voices += synth.getVoice (i)->isVoiceActive() ? 1 : 0;
    activeVoices.store (voices, std::memory_order_relaxed);
}

juce::AudioProcessorEditor* PluginProcessor::createEditor()
{
    return new PluginEditor (*this);
}

void PluginProcessor::getStateInformation (juce::MemoryBlock& destData)
{
    if (auto xml = parameters.copyState().createXml())
        copyXmlToBinary (*xml, destData);
}

void PluginProcessor::setStateInformation (const void* data, int sizeInBytes)
{
    if (auto xml = getXmlFromBinary (data, sizeInBytes))
        if (xml->hasTagName (parameters.state.getType()))
            parameters.replaceState (juce::ValueTree::fromXml (*xml));
}

// The host calls this exported factory to create the plugin.
juce::AudioProcessor* JUCE_CALLTYPE createPluginFilter()
{
    return new PluginProcessor();
}
