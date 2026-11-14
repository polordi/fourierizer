// The plugin window: the web UI (ui/dist/index.html, embedded) in a WebView, wired to the Engine
// and the Sampler through native functions. The UI calls them through its PluginHost
// (ui/src/plugin-host.ts); binary data (spectrogram images) is fetched from /data/<key>.
#pragma once

#include <juce_gui_extra/juce_gui_extra.h>

#include "PluginProcessor.h"

class FourierizerEditor : public juce::AudioProcessorEditor,
                          public juce::DragAndDropContainer,
                          private juce::Timer,
                          private juce::AudioProcessorValueTreeState::Listener {
public:
    explicit FourierizerEditor(FourierizerProcessor&);
    ~FourierizerEditor() override;

    void resized() override;

private:
    using Args = const juce::Array<juce::var>&;
    using Completion = juce::WebBrowserComponent::NativeFunctionCompletion;

    juce::WebBrowserComponent::Options options();
    std::optional<juce::WebBrowserComponent::Resource> resource(const juce::String& url);
    /// Wrap a background result so it completes on the message thread, if the editor still exists.
    fzp::Done later(Completion complete);

    void timerCallback() override;
    void parameterChanged(const juce::String&, float) override { paramsDirty_ = true; }

    void loadProject(Completion);
    void pickFile(int layer, Completion);
    void exportResult(Completion);
    void dragResult();

    FourierizerProcessor& proc_;
    juce::WebBrowserComponent web_;
    std::map<int, juce::MemoryOutputStream> uploads_;
    int nextUpload_ = 1;
    std::unique_ptr<juce::FileChooser> chooser_;
    std::atomic<bool> paramsDirty_{false};
    struct { float result = -2, preview = -2; int layer = -2, voices = -1, ready = -1, ahead = -1; } lastPlay_;
    juce::WeakReference<FourierizerEditor>::Master masterReference;
    friend class juce::WeakReference<FourierizerEditor>;
};
