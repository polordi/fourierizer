#include "CaptureEditor.h"

#include <Captures.h>

namespace {
// The instrument's palette (ui/src/styles.css)
const juce::Colour kChassis{0xffe4e7ea}, kPanel{0xfff3f5f6}, kDisplay{0xffffffff}, kInk{0xff16181a},
    kMuted{0xff5a6068}, kSeam{0xffb7bdc3}, kRec{0xffe5452b}, kAccent{0xff0085ca};

juce::Font sans(float size, bool bold = false) {
    return juce::Font(juce::FontOptions(juce::Font::getDefaultSansSerifFontName(), size, bold ? juce::Font::bold : juce::Font::plain));
}
juce::Font mono(float size) {
    return juce::Font(juce::FontOptions(juce::Font::getDefaultMonospacedFontName(), size, juce::Font::plain));
}
juce::Font silk(float size) { return sans(size, true).withExtraKerningFactor(0.08f); }
} // namespace

CaptureEditor::Key::Key(const juce::String& t, bool toggle) : juce::Button(t), text(t) {
    setClickingTogglesState(toggle);
    setMouseCursor(juce::MouseCursor::PointingHandCursor);
}

void CaptureEditor::Key::paintButton(juce::Graphics& g, bool over, bool down) {
    auto r = getLocalBounds().toFloat().reduced(1.0f, 1.0f).withTrimmedBottom(2.0f);
    const bool on = getToggleState() || (dot && lit);
    if (!down) {   // hard shadow under the key
        g.setColour(kInk);
        g.fillRoundedRectangle(r.translated(0, 2), 5.0f);
    } else r = r.translated(0, 1.5f);
    g.setColour(on ? kInk : (over ? kDisplay : kPanel));
    g.fillRoundedRectangle(r, 5.0f);
    g.setColour(kInk);
    g.drawRoundedRectangle(r, 5.0f, 1.5f);
    auto content = r.reduced(10, 0);
    if (dot) {
        const float d = 10.0f;
        g.setColour(lit ? kRec : kRec.withAlpha(0.85f));
        g.fillEllipse(content.removeFromLeft(d).withSizeKeepingCentre(d, d));
        content.removeFromLeft(7);
    } else if (isToggleable() || getClickingTogglesState()) {   // a small LED for toggles
        const float d = 7.0f;
        g.setColour(on ? kAccent : kSeam);
        g.fillEllipse(content.removeFromLeft(d).withSizeKeepingCentre(d, d));
        content.removeFromLeft(7);
    }
    g.setColour(on ? kPanel : kInk);
    g.setFont(silk(11.0f));
    g.drawText(text, content, dot ? juce::Justification::centredLeft : juce::Justification::centredLeft, true);
}

CaptureEditor::CaptureEditor(CaptureProcessor& p) : juce::AudioProcessorEditor(p), proc_(p) {
    rec_.dot = true;
    rec_.onClick = [this] { proc_.toggleRecord(); };
    follow_.setToggleState(proc_.followTransport(), juce::dontSendNotification);
    follow_.onClick = [this] { proc_.setFollowTransport(follow_.getToggleState()); };
    folder_.onClick = [] {
        const auto f = fzshared::capturesFolder();
        f.createDirectory();
        f.startAsProcess();
    };
    rec_.setTooltip("Record what passes through this track (up to 60 s)");
    follow_.setTooltip("Start recording when FL starts playing and stop when it stops");
    folder_.setTooltip("Documents/Fourierizer/Captures: Fourierizer lists these files in each layer's load menu");
    for (auto* k : {&rec_, &follow_, &folder_}) addAndMakeVisible(k);
    proc_.onCaptureSaved = [this] { repaint(); };
    setSize(440, 200);
    startTimerHz(30);
}

CaptureEditor::~CaptureEditor() {
    stopTimer();
    proc_.onCaptureSaved = nullptr;
}

void CaptureEditor::resized() {
    auto r = getLocalBounds().reduced(26, 22);
    r.removeFromTop(48);   // title
    auto row = r.removeFromTop(48);
    rec_.setBounds(row.removeFromLeft(104).withSizeKeepingCentre(104, 42));
    row.removeFromLeft(18);
    timeArea_ = row.removeFromLeft(150);
    row.removeFromLeft(14);
    meterArea_ = row.withSizeKeepingCentre(row.getWidth(), 22);
    r.removeFromTop(16);
    auto bottom = r.removeFromTop(34);
    follow_.setBounds(bottom.removeFromLeft(208).withSizeKeepingCentre(208, 32));
    bottom.removeFromLeft(10);
    folder_.setBounds(bottom.removeFromLeft(122).withSizeKeepingCentre(122, 32));
    infoArea_ = r.withTrimmedTop(6);
}

void CaptureEditor::paint(juce::Graphics& g) {
    g.fillAll(kChassis);
    const auto module = getLocalBounds().toFloat().reduced(8.0f);
    g.setColour(kPanel);
    g.fillRoundedRectangle(module, 10.0f);
    g.setColour(kInk);
    g.drawRoundedRectangle(module, 10.0f, 1.5f);
    for (auto c : {module.getTopLeft() + juce::Point<float>(9, 9), module.getTopRight() + juce::Point<float>(-9, 9),
                   module.getBottomLeft() + juce::Point<float>(9, -9), module.getBottomRight() + juce::Point<float>(-9, -9)}) {
        g.setColour(kSeam);   // screws
        g.drawEllipse(juce::Rectangle<float>(7, 7).withCentre(c), 1.0f);
        g.drawLine(c.x - 2.5f, c.y + 2.5f, c.x + 2.5f, c.y - 2.5f, 1.0f);
    }

    auto title = getLocalBounds().reduced(26, 20).removeFromTop(44);
    g.setColour(kInk);
    g.setFont(sans(21.0f, true));
    g.drawText("Fourierizer Capture", title.removeFromTop(26), juce::Justification::centredLeft);
    g.setColour(kMuted);
    g.setFont(silk(9.0f));
    g.drawText("RECORDS THIS TRACK FOR FOURIERIZER", title, juce::Justification::topLeft);
    const auto track = proc_.trackName();
    g.setFont(mono(11.0f));
    g.drawText(track.isNotEmpty() ? "Track: " + track : juce::String(), getLocalBounds().reduced(28, 24).removeFromTop(20), juce::Justification::topRight, true);

    // time: 00:04.2 / 60 s
    const double s = proc_.isRecording() ? proc_.recordedSeconds() : 0.0;
    auto t = timeArea_;
    g.setColour(proc_.isRecording() ? kInk : kMuted);
    g.setFont(mono(28.0f));
    g.drawText(juce::String::formatted("%02d:%04.1f", (int) s / 60, std::fmod(s, 60.0)), t.removeFromTop(32), juce::Justification::centredLeft);
    g.setColour(kMuted);
    g.setFont(mono(10.0f));
    g.drawText(proc_.isRecording() ? juce::String("of 60 s max") : juce::String("ready"), t, juce::Justification::topLeft);

    // stereo meter, -48..0 dB
    for (int c = 0; c < 2; ++c) {
        auto bar = meterArea_.toFloat().withHeight(7.0f).translated(0, c * 12.0f);
        g.setColour(kDisplay);
        g.fillRoundedRectangle(bar, 2.0f);
        const float db = juce::Decibels::gainToDecibels(level_[c], -48.0f), frac = juce::jlimit(0.0f, 1.0f, (db + 48.0f) / 48.0f);
        g.setColour(db > -1.0f ? kRec : kInk);
        g.fillRoundedRectangle(bar.withWidth(bar.getWidth() * frac), 2.0f);
        g.setColour(kSeam);
        g.drawRoundedRectangle(bar, 2.0f, 1.0f);
    }

    g.setColour(kMuted);
    g.setFont(mono(10.0f));
    const auto last = proc_.lastCapture();
    g.drawText(last.isNotEmpty() ? "Saved  " + last : "Captures go to Documents/Fourierizer/Captures", infoArea_, juce::Justification::topLeft, true);
}

void CaptureEditor::timerCallback() {
    for (int c = 0; c < 2; ++c) level_[c] = std::max(proc_.takePeak(c), level_[c] * 0.82f);   // fast attack, ~150 ms fall
    rec_.lit = proc_.isRecording();
    rec_.text = proc_.isRecording() ? "STOP" : "REC";
    if (follow_.getToggleState() != proc_.followTransport()) follow_.setToggleState(proc_.followTransport(), juce::dontSendNotification);
    rec_.repaint();
    repaint(timeArea_.getUnion(meterArea_).expanded(4));
}
