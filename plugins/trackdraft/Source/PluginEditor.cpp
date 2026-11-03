#include "PluginEditor.h"
#include "PluginProcessor.h"

namespace td
{
namespace
{
// The app's dark theme tokens (apps/trackdraft/src/theme/themes.css): panel
// #4E4E4E, ink #FFFFFF, accent #FFA500. The native editor borrows them so the
// plug-in does not look like a different product.
const juce::Colour background { 0xff141414 };
const juce::Colour panel { 0xff4e4e4e };
const juce::Colour ink { 0xffffffff };
const juce::Colour inkMuted { 0xffb4b4b4 };
const juce::Colour accent { 0xffffa500 };
} // namespace

TrackDraftAudioProcessorEditor::TrackDraftAudioProcessorEditor (TrackDraftAudioProcessor& p)
    : AudioProcessorEditor (&p), plugin (p)
{
    auto& state = plugin.parameters();

    keyBox.addItemList ([] {
        juce::StringArray names;
        for (int pc = 0; pc < 12; ++pc)
            names.add (theory::pitchClassName (pc));
        return names;
    }(), 1);
    scaleBox.addItemList ([] {
        juce::StringArray names;
        for (int i = 0; i <= (int) theory::Scale::locrian; ++i)
            names.add (theory::displayNameOf ((theory::Scale) i));
        return names;
    }(), 1);

    keyAttachment = std::make_unique<juce::AudioProcessorValueTreeState::ComboBoxAttachment> (
        state, "key", keyBox);
    scaleAttachment = std::make_unique<juce::AudioProcessorValueTreeState::ComboBoxAttachment> (
        state, "scale", scaleBox);

    octaveSlider.setRange (0, 8, 1);
    velocitySlider.setRange (1, 127, 1);
    gateSlider.setRange (0.05, 1.0, 0.01);
    octaveAttachment = std::make_unique<juce::AudioProcessorValueTreeState::SliderAttachment> (
        state, "octave", octaveSlider);
    velocityAttachment = std::make_unique<juce::AudioProcessorValueTreeState::SliderAttachment> (
        state, "velocity", velocitySlider);
    gateAttachment = std::make_unique<juce::AudioProcessorValueTreeState::SliderAttachment> (
        state, "gate", gateSlider);
    generateAttachment = std::make_unique<juce::AudioProcessorValueTreeState::ButtonAttachment> (
        state, "enabled", generateButton);

    for (int pc = 0; pc < 12; ++pc)
        rootBox.addItem (theory::pitchClassName (pc), pc + 1);
    // Item id is the table index, not the enum value, so the two cannot drift.
    for (int i = 0; i < (int) theory::qualities().size(); ++i)
    {
        const auto& quality = theory::qualities()[(std::size_t) i];
        qualityBox.addItem (quality.suffix[0] == '\0' ? juce::String ("major")
                                                       : juce::String (quality.suffix),
                            i + 1);
    }

    rootBox.onChange = [this] {
        if (selectedSlot < (int) working.count)
        {
            working.slots[(std::size_t) selectedSlot].rootPc = rootBox.getSelectedId() - 1;
            commit();
            strip.repaint();
        }
    };
    qualityBox.onChange = [this] {
        if (selectedSlot < (int) working.count)
        {
            const int index = juce::jlimit (0, (int) theory::qualities().size() - 1,
                                            qualityBox.getSelectedId() - 1);
            working.slots[(std::size_t) selectedSlot].quality =
                theory::qualities()[(std::size_t) index].quality;
            commit();
            strip.repaint();
        }
    };
    seedButton.onClick = [this] {
        working.seedFromScale (keyBox.getSelectedId() - 1,
                               (theory::Scale) juce::jmax (0, scaleBox.getSelectedId() - 1),
                               working.count);
        selectedSlot = 0;
        commit();
        rebuildFromProcessor();
    };

    for (auto* component : std::initializer_list<juce::Component*> {
             &keyBox, &scaleBox, &rootBox, &qualityBox, &octaveSlider, &velocitySlider,
             &gateSlider, &generateButton, &seedButton, &strip })
        addAndMakeVisible (component);

    generateButton.setColour (juce::ToggleButton::textColourId, ink);
    for (auto* box : { &keyBox, &scaleBox, &rootBox, &qualityBox })
        box->setColour (juce::ComboBox::backgroundColourId, panel);

    octaveSlider.setColour (juce::Slider::textBoxTextColourId, ink);
    velocitySlider.setColour (juce::Slider::textBoxTextColourId, ink);
    gateSlider.setColour (juce::Slider::textBoxTextColourId, ink);
    gateSlider.setColour (juce::Slider::trackColourId, accent);
    seedButton.setColour (juce::TextButton::buttonColourId, panel);
    seedButton.setColour (juce::TextButton::textColourOnId, ink);

    plugin.progressionChanged().addChangeListener (this);
    rebuildFromProcessor();

    setSize (720, 320);
    startTimerHz (20);
}

TrackDraftAudioProcessorEditor::~TrackDraftAudioProcessorEditor()
{
    plugin.progressionChanged().removeChangeListener (this);
    stopTimer();
}

void TrackDraftAudioProcessorEditor::rebuildFromProcessor()
{
    working = plugin.getProgression();
    if (selectedSlot >= (int) working.count)
        selectedSlot = 0;

    if (selectedSlot < (int) working.count)
    {
        const auto& slot = working.slots[(std::size_t) selectedSlot];
        rootBox.setSelectedId (slot.rootPc + 1, juce::dontSendNotification);
        for (int i = 0; i < (int) theory::qualities().size(); ++i)
            if (theory::qualities()[(std::size_t) i].quality == slot.quality)
            {
                qualityBox.setSelectedId (i + 1, juce::dontSendNotification);
                break;
            }
    }

    strip.repaint();
}

void TrackDraftAudioProcessorEditor::commit()
{
    plugin.setProgression (working);
}

void TrackDraftAudioProcessorEditor::changeListenerCallback (juce::ChangeBroadcaster*)
{
    rebuildFromProcessor();
}

void TrackDraftAudioProcessorEditor::timerCallback()
{
    strip.repaint();
}

void TrackDraftAudioProcessorEditor::paint (juce::Graphics& g)
{
    g.fillAll (background);

    g.setColour (accent);
    g.setFont (juce::Font (juce::FontOptions (20.0f)).boldened());
    g.drawText ("TrackDraft Harmony", 16, 12, 320, 26, juce::Justification::centredLeft);

    g.setColour (inkMuted);
    g.setFont (juce::Font (juce::FontOptions (12.0f)));
    g.drawText ("MIDI generator - notes go to the track's own instrument",
                16, 38, 520, 16, juce::Justification::centredLeft);

    auto labels = juce::Rectangle<int> (16, 66, 688, 16);
    g.drawText ("Key", labels.removeFromLeft (128), juce::Justification::centredLeft);
    g.drawText ("Scale", labels.removeFromLeft (216), juce::Justification::centredLeft);
    g.drawText ("Slot", labels.removeFromLeft (96), juce::Justification::centredLeft);
    g.drawText ("Quality", labels.removeFromLeft (200), juce::Justification::centredLeft);
}

void TrackDraftAudioProcessorEditor::resized()
{
    keyBox.setBounds (16, 84, 120, 26);
    scaleBox.setBounds (144, 84, 208, 26);
    rootBox.setBounds (360, 84, 88, 26);
    qualityBox.setBounds (456, 84, 192, 26);
    seedButton.setBounds (656, 84, 48, 26);

    strip.setBounds (16, 126, 688, 92);

    auto row = juce::Rectangle<int> (16, 232, 688, 28);
    octaveSlider.setBounds (row.removeFromLeft (150));
    row.removeFromLeft (12);
    velocitySlider.setBounds (row.removeFromLeft (170));
    row.removeFromLeft (12);
    gateSlider.setBounds (row.removeFromLeft (200));
    row.removeFromLeft (12);
    generateButton.setBounds (row.removeFromLeft (330));
}

juce::Rectangle<int> TrackDraftAudioProcessorEditor::SlotStrip::boundsFor (int index) const
{
    const int gap = 8;
    const int total = juce::jmax (1, (int) owner.working.count);
    const int width = (getWidth() - gap * (total - 1)) / total;
    return { index * (width + gap), 0, width, getHeight() };
}

void TrackDraftAudioProcessorEditor::SlotStrip::paint (juce::Graphics& g)
{
    const auto sounding = owner.plugin.playingSlot.load();

    for (int i = 0; i < (int) owner.working.count; ++i)
    {
        const auto area = boundsFor (i).toFloat().reduced (1.0f);
        const auto& slot = owner.working.slots[(std::size_t) i];

        g.setColour (juce::Colour (0xff232323));
        g.fillRoundedRectangle (area, 6.0f);

        if (i == sounding)
        {
            g.setColour (accent.withAlpha (0.28f));
            g.fillRoundedRectangle (area, 6.0f);
        }

        g.setColour (i == owner.selectedSlot ? accent : panel);
        g.drawRoundedRectangle (area, 6.0f, i == owner.selectedSlot ? 2.0f : 1.0f);

        g.setColour (ink);
        g.setFont (juce::Font (juce::FontOptions (18.0f)).boldened());
        g.drawText (theory::chordName (slot.rootPc, slot.quality), area,
                    juce::Justification::centred);

        g.setColour (inkMuted);
        g.setFont (juce::Font (juce::FontOptions (11.0f)));
        auto beatsArea = area;
        g.drawText (juce::String (slot.beats, 0) + " beats",
                    beatsArea.removeFromBottom (18.0f), juce::Justification::centred);
    }
}

void TrackDraftAudioProcessorEditor::SlotStrip::mouseDown (const juce::MouseEvent& event)
{
    for (int i = 0; i < (int) owner.working.count; ++i)
    {
        if (boundsFor (i).contains (event.getPosition()))
        {
            owner.selectedSlot = i;
            owner.rebuildFromProcessor();
            return;
        }
    }
}
} // namespace td
