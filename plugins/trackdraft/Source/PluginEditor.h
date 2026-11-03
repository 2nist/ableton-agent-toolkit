#pragma once

#include "Progression.h"
#include "Theory/ChordWalk.h"

#include <array>

#include <juce_audio_processors/juce_audio_processors.h>
#include <juce_gui_extra/juce_gui_extra.h>

namespace td
{
class TrackDraftAudioProcessor;

/**
    Native editor: key/scale, the progression grid, and the emit settings.

    Every control is a real JUCE widget bound to the APVTS, so host automation
    and undo see the same parameters the UI does. The progression itself is
    plugin state rather than an automatable parameter — a chord change is an
    edit, not a knob — and is written back through `setProgression` on every
    change so it survives a save.
*/
class TrackDraftAudioProcessorEditor final : public juce::AudioProcessorEditor,
                                             private juce::ChangeListener,
                                             private juce::Timer
{
public:
    explicit TrackDraftAudioProcessorEditor (TrackDraftAudioProcessor&);
    ~TrackDraftAudioProcessorEditor() override;

    void paint (juce::Graphics&) override;
    void resized() override;

private:
    void changeListenerCallback (juce::ChangeBroadcaster*) override;
    void timerCallback() override;
    void rebuildFromProcessor();
    void rebuildNeighbours();
    void refreshHeardLabel();
    theory::Scale workingScale() const;
    int workingDegree() const;
    void commit();
    void refreshGrid();

    TrackDraftAudioProcessor& plugin;
    td::Progression working;
    int selectedSlot = 0;

    juce::ComboBox keyBox;
    juce::ComboBox scaleBox;
    juce::ComboBox rootBox;
    juce::ComboBox qualityBox;
    juce::Slider octaveSlider { juce::Slider::IncDecButtons, juce::Slider::TextBoxLeft };
    juce::Slider velocitySlider { juce::Slider::IncDecButtons, juce::Slider::TextBoxLeft };
    juce::Slider gateSlider { juce::Slider::LinearHorizontal, juce::Slider::TextBoxRight };
    juce::Slider beatsSlider { juce::Slider::IncDecButtons, juce::Slider::TextBoxLeft };
    juce::ToggleButton generateButton { "Emit notes from the host clock" };
    juce::TextButton seedButton { "Seed from key" };

    /** The six hex neighbours of the selected slot — the walk, one click away. */
    std::array<juce::TextButton, 6> neighbourButtons;
    juce::TextButton detectButton { "Detect MIDI" };
    juce::TextButton useHeardButton { "Use heard" };
    juce::Label heardLabel;

    std::unique_ptr<juce::AudioProcessorValueTreeState::ComboBoxAttachment> keyAttachment;
    std::unique_ptr<juce::AudioProcessorValueTreeState::ComboBoxAttachment> scaleAttachment;
    std::unique_ptr<juce::AudioProcessorValueTreeState::SliderAttachment> octaveAttachment;
    std::unique_ptr<juce::AudioProcessorValueTreeState::SliderAttachment> velocityAttachment;
    std::unique_ptr<juce::AudioProcessorValueTreeState::SliderAttachment> gateAttachment;
    std::unique_ptr<juce::AudioProcessorValueTreeState::ButtonAttachment> generateAttachment;

    /** The eight slot buttons, drawn by hand so the sounding chord can pulse. */
    class SlotStrip final : public juce::Component
    {
    public:
        explicit SlotStrip (TrackDraftAudioProcessorEditor& ownerToUse) : owner (ownerToUse) {}
        void paint (juce::Graphics&) override;
        void mouseDown (const juce::MouseEvent&) override;

        juce::Rectangle<int> boundsFor (int index) const;

    private:
        TrackDraftAudioProcessorEditor& owner;
    };

    SlotStrip strip { *this };

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR (TrackDraftAudioProcessorEditor)
};
} // namespace td
