// Fourierizer Capture's window: a native JUCE component in the instrument's visual language
// (light chassis, ink outlines, keys with a hard shadow, mono readouts).
#pragma once

#include <juce_audio_processors/juce_audio_processors.h>

#include "CaptureProcessor.h"

class CaptureEditor : public juce::AudioProcessorEditor, private juce::Timer {
public:
    explicit CaptureEditor(CaptureProcessor&);
    ~CaptureEditor() override;

    void paint(juce::Graphics&) override;
    void resized() override;

private:
    /// A hardware-style key: ink outline, hard shadow, pressed state inverts.
    class Key : public juce::Button {
    public:
        Key(const juce::String& text, bool toggle);
        void paintButton(juce::Graphics&, bool over, bool down) override;
        juce::String text;
        bool dot = false;           // the record dot
        bool lit = false;           // dot lit (recording)
    };

    void timerCallback() override;

    CaptureProcessor& proc_;
    Key rec_{"REC", false}, follow_{"RECORD WHILE PLAYING", true}, folder_{"OPEN FOLDER", false};
    float level_[2]{0, 0};
    juce::Rectangle<int> meterArea_, timeArea_, infoArea_;

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR(CaptureEditor)
};
