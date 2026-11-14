#include "PluginProcessor.h"

#include "PluginEditor.h"

namespace {
// Same knob → value maps as the UI (ui/src/model.ts: adsrMap).
float attackSeconds(float v) { return 0.001f + v * v * 1.999f; }
float decaySeconds(float v) { return 0.005f + v * v * 3.995f; }
float releaseSeconds(float v) { return 0.005f + v * v * 4.995f; }

juce::String ms(float s) { return s < 1 ? juce::String(juce::roundToInt(s * 1000)) + " ms" : juce::String(s, 2) + " s"; }

const juce::StringArray kNoteNames{"C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"};
const juce::StringArray kModes{"Tape", "Spectral"};
const juce::StringArray kWindows{"Tonal", "Mixed", "Punchy"};   // spectral window 4096 / 2048 / 1024
constexpr int kWindowSizes[] = {4096, 2048, 1024};
juce::String noteName(int n) { return kNoteNames[n % 12] + juce::String(n / 12 - 1); }
} // namespace

juce::AudioProcessorValueTreeState::ParameterLayout FourierizerProcessor::createLayout() {
    using P = juce::AudioParameterFloat;
    using Attr = juce::AudioParameterFloatAttributes;
    auto knob = [](const char* id, const char* name, float def, std::function<juce::String(float)> text) {
        return std::make_unique<P>(juce::ParameterID{id, 1}, name, juce::NormalisableRange<float>(0, 1), def,
                                   Attr().withStringFromValueFunction([text](float v, int) { return text(v); }));
    };
    juce::AudioProcessorValueTreeState::ParameterLayout layout;
    layout.add(knob("attack", "Attack", 0.18f, [](float v) { return ms(attackSeconds(v)); }));
    layout.add(knob("decay", "Decay", 0.33f, [](float v) { return ms(decaySeconds(v)); }));
    layout.add(knob("sustain", "Sustain", 0.7f, [](float v) { return v < 0.005f ? juce::String("-inf dB") : juce::String(juce::Decibels::gainToDecibels(v), 1) + " dB"; }));
    layout.add(knob("release", "Release", 0.4f, [](float v) { return ms(releaseSeconds(v)); }));
    layout.add(std::make_unique<juce::AudioParameterInt>(juce::ParameterID{"root", 1}, "Root", 0, 127, 48,
                                                         juce::AudioParameterIntAttributes().withStringFromValueFunction([](int v, int) { return noteName(v); })));
    layout.add(std::make_unique<P>(juce::ParameterID{"volume", 1}, "Volume", juce::NormalisableRange<float>(-36, 6, 0.1f), -3.0f,
                                   Attr().withLabel("dB")));
    layout.add(std::make_unique<juce::AudioParameterChoice>(juce::ParameterID{"mode", 1}, "Mode", kModes, 0));
    layout.add(std::make_unique<juce::AudioParameterChoice>(juce::ParameterID{"window", 1}, "Spectral window", kWindows, 0));
    return layout;
}

FourierizerProcessor::FourierizerProcessor()
    : AudioProcessor(BusesProperties().withOutput("Output", juce::AudioChannelSet::stereo(), true)),
      parameters(*this, nullptr, "PARAMS", createLayout()) {
    attack_ = parameters.getRawParameterValue("attack");
    decay_ = parameters.getRawParameterValue("decay");
    sustain_ = parameters.getRawParameterValue("sustain");
    release_ = parameters.getRawParameterValue("release");
    root_ = parameters.getRawParameterValue("root");
    volume_ = parameters.getRawParameterValue("volume");
    mode_ = parameters.getRawParameterValue("mode");
    window_ = parameters.getRawParameterValue("window");
    sampler.setBank(&bank);
    startTimerHz(4);
}

FourierizerProcessor::~FourierizerProcessor() { stopTimer(); }

fzp::Envelope FourierizerProcessor::envelopeFromKnobs(float a, float d, float s, float r) {
    return {attackSeconds(a), decaySeconds(d), s, releaseSeconds(r)};
}

void FourierizerProcessor::prepareToPlay(double sampleRate, int) {
    sampler.prepare(sampleRate);
    gain_.reset(sampleRate, 0.02);
    gain_.setCurrentAndTargetValue(juce::Decibels::decibelsToGain(volume_->load()));
}

bool FourierizerProcessor::isBusesLayoutSupported(const BusesLayout& layouts) const {
    const auto out = layouts.getMainOutputChannelSet();
    return out == juce::AudioChannelSet::stereo() || out == juce::AudioChannelSet::mono();
}

void FourierizerProcessor::processBlock(juce::AudioBuffer<float>& buffer, juce::MidiBuffer& midi) {
    juce::ScopedNoDenormals noDenormals;
    buffer.clear();
    const auto env = envelopeFromKnobs(attack_->load(), decay_->load(), sustain_->load(), release_->load());
    gain_.setTargetValue(juce::Decibels::decibelsToGain(volume_->load()));
    const bool spectral = mode_->load() > 0.5f;
    bank.configure(spectral, kWindowSizes[juce::jlimit(0, 2, juce::roundToInt(window_->load()))]);
    sampler.process(buffer, midi, env, juce::roundToInt(root_->load()), 1.0f, spectral, isNonRealtime());
    gain_.applyGain(buffer, buffer.getNumSamples());
}

juce::var FourierizerProcessor::samplerParams() const {
    auto* o = new juce::DynamicObject();
    o->setProperty("a", attack_->load());
    o->setProperty("d", decay_->load());
    o->setProperty("s", sustain_->load());
    o->setProperty("r", release_->load());
    o->setProperty("root", juce::roundToInt(root_->load()));
    o->setProperty("mode", kModes[juce::jlimit(0, 1, juce::roundToInt(mode_->load()))].toLowerCase());
    o->setProperty("window", kWindows[juce::jlimit(0, 2, juce::roundToInt(window_->load()))].toLowerCase());
    return juce::var(o);
}

void FourierizerProcessor::setSamplerParams(const juce::var& p) {
    auto set = [&](const char* id, const juce::var& v) {
        if (v.isVoid() || v.isUndefined()) return;
        if (auto* param = parameters.getParameter(id)) {
            const float norm = param->convertTo0to1((float) (double) v);
            if (std::abs(param->getValue() - norm) > 1e-6f) param->setValueNotifyingHost(norm);
        }
    };
    set("attack", p["a"]);
    set("decay", p["d"]);
    set("sustain", p["s"]);
    set("release", p["r"]);
    set("root", p["root"]);
    auto choice = [&](const char* id, const juce::StringArray& names, const juce::var& v) {
        const int i = names.indexOf(v.toString(), true);
        if (v.isString() && i >= 0) set(id, i);
    };
    choice("mode", kModes, p["mode"]);
    choice("window", kWindows, p["window"]);
}

void FourierizerProcessor::getStateInformation(juce::MemoryBlock& destData) {
    destData = engine.saveState(parameters.copyState());
}

void FourierizerProcessor::setStateInformation(const void* data, int sizeInBytes) {
    const auto params = engine.loadState(data, sizeInBytes);
    if (params.isValid() && params.hasType(parameters.state.getType())) parameters.replaceState(params);
    // Tell an open editor to reload (hosts call setState on the message thread).
    if (engine.onProjectLoaded && juce::MessageManager::existsAndIsCurrentThread()) engine.onProjectLoaded();
}

juce::AudioProcessorEditor* FourierizerProcessor::createEditor() { return new FourierizerEditor(*this); }

juce::AudioProcessor* JUCE_CALLTYPE createPluginFilter() { return new FourierizerProcessor(); }
