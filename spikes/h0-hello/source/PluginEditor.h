#pragma once

#include "PluginProcessor.h"

#include <juce_gui_extra/juce_gui_extra.h>

#include <optional>

// The "editor" is the plugin window. The host may open and close it at any time while audio
// keeps running, so it only observes and controls the processor; it never owns audio state.
// Here the whole window is a WebView that loads our HTML/JS UI from embedded resources.
class PluginEditor final : public juce::AudioProcessorEditor,
                           private juce::Timer
{
public:
    explicit PluginEditor (PluginProcessor&);
    ~PluginEditor() override;

    void resized() override;

private:
    void timerCallback() override;
    std::optional<juce::WebBrowserComponent::Resource> getResource (const juce::String& url) const;
    juce::var getHostInfo() const;

    PluginProcessor& processorRef;

    // Declaration order matters: the relay must exist before the browser that uses it,
    // and the attachment needs both.
    juce::WebSliderRelay gainRelay { "gain" };
    juce::WebBrowserComponent webView;
    juce::WebSliderParameterAttachment gainAttachment;

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR (PluginEditor)
};
