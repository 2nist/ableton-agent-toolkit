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
const juce::Colour well { 0xff232323 };

juce::StringArray keyNames()
{
    juce::StringArray names;
    for (int pc = 0; pc < 12; ++pc)
        names.add (theory::pitchClassName (pc));
    return names;
}

juce::StringArray scaleNames()
{
    juce::StringArray names;
    for (int i = 0; i <= (int) theory::Scale::locrian; ++i)
        names.add (theory::displayNameOf ((theory::Scale) i));
    return names;
}

juce::StringArray performanceNames()
{
    return { "Block", "Strum", "Pulse", "Arp" };
}
} // namespace

TrackDraftAudioProcessorEditor::TrackDraftAudioProcessorEditor (TrackDraftAudioProcessor& p)
    : AudioProcessorEditor (&p), plugin (p)
{
    auto& state = plugin.parameters();

    keyBox.addItemList (keyNames(), 1);
    scaleBox.addItemList (scaleNames(), 1);
    keyAttachment = std::make_unique<juce::AudioProcessorValueTreeState::ComboBoxAttachment> (
        state, "key", keyBox);
    scaleAttachment = std::make_unique<juce::AudioProcessorValueTreeState::ComboBoxAttachment> (
        state, "scale", scaleBox);

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

    performanceBox.addItemList (performanceNames(), 1);
    directionBox.addItemList ({ "Up", "Down", "Up-down" }, 1);
    borrowedBox.setTextWhenNothingSelected ("Borrowed chord...");
    borrowedBox.setTextWhenNoChoicesAvailable ("None in this key");

    octaveSlider.setRange (0, 8, 1);
    velocitySlider.setRange (1, 127, 1);
    gateSlider.setRange (0.05, 1.0, 0.01);
    paramSlider.setRange (1, 32, 1);
    beatsSlider.setRange (1.0, 8.0, 1.0);

    octaveAttachment = std::make_unique<juce::AudioProcessorValueTreeState::SliderAttachment> (
        state, "octave", octaveSlider);
    velocityAttachment = std::make_unique<juce::AudioProcessorValueTreeState::SliderAttachment> (
        state, "velocity", velocitySlider);
    gateAttachment = std::make_unique<juce::AudioProcessorValueTreeState::SliderAttachment> (
        state, "gate", gateSlider);
    generateAttachment = std::make_unique<juce::AudioProcessorValueTreeState::ButtonAttachment> (
        state, "enabled", generateButton);

    rootBox.onChange = [this] {
        if (selectedSlot < (int) working.count)
        {
            working.slots[(std::size_t) selectedSlot].rootPc = rootBox.getSelectedId() - 1;
            commit();
            rebuildFromProcessor();
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
            rebuildFromProcessor();
        }
    };

    beatsSlider.onValueChange = [this] {
        if (selectedSlot < (int) working.count)
        {
            working.slots[(std::size_t) selectedSlot].beats = beatsSlider.getValue();
            commit();
            rebuildFromProcessor();
        }
    };

    performanceBox.onChange = [this] {
        if (selectedSlot < (int) working.count)
        {
            working.slots[(std::size_t) selectedSlot].performance =
                (Performance) juce::jlimit (0, 3, performanceBox.getSelectedId() - 1);
            commit();
            rebuildFromProcessor();
        }
    };

    paramSlider.onValueChange = [this] {
        if (selectedSlot < (int) working.count)
        {
            working.slots[(std::size_t) selectedSlot].param = (int) paramSlider.getValue();
            commit();
        }
    };

    directionBox.onChange = [this] {
        if (selectedSlot < (int) working.count)
        {
            working.slots[(std::size_t) selectedSlot].direction =
                juce::jlimit (0, 2, directionBox.getSelectedId() - 1);
            commit();
        }
    };

    for (int i = 0; i < 6; ++i)
    {
        neighbourButtons[(std::size_t) i].setColour (juce::TextButton::buttonColourId, well);
        neighbourButtons[(std::size_t) i].onClick = [this, i] {
            // A neighbour seeds the slot after the selected one, then the
            // selection moves there — the same "walk" the honeycomb performs.
            const auto slotIndex = (std::size_t) juce::jlimit (0, (int) Progression::maxSlots - 1,
                                                               selectedSlot + 1);
            const auto neighbour = neighboursOf (workingScale(), workingDegree()).at ((size_t) i);

            if (slotIndex >= working.count)
                working.count = juce::jmin (Progression::maxSlots, slotIndex + 1);

            const int keyPc = keyBox.getSelectedId() - 1;
            auto& slot = working.slots[slotIndex];
            slot.rootPc = ((keyPc + neighbour.rootOffset) % 12 + 12) % 12;
            slot.quality = neighbour.quality;
            if (slot.beats <= 0.0)
                slot.beats = 4.0;

            selectedSlot = (int) slotIndex;
            commit();
            rebuildFromProcessor();
        };
    }

    borrowedBox.onChange = [this] {
        const int id = borrowedBox.getSelectedId();
        borrowedBox.setSelectedId (0, juce::dontSendNotification);
        if (id <= 0 || selectedSlot >= (int) working.count)
            return;

        const auto borrowed = Progression::borrowedChords (workingScale());
        if ((std::size_t) (id - 1) >= borrowed.size())
            return;

        const auto& chord = borrowed[(std::size_t) (id - 1)];
        const int keyPc = keyBox.getSelectedId() - 1;
        auto& slot = working.slots[(std::size_t) selectedSlot];
        slot.rootPc = ((keyPc + chord.rootPc) % 12 + 12) % 12;
        slot.quality = chord.quality;
        commit();
        rebuildFromProcessor();
    };

    seedButton.onClick = [this] {
        working.seedFromScale (keyBox.getSelectedId() - 1,
                               (theory::Scale) juce::jmax (0, scaleBox.getSelectedId() - 1),
                               working.count);
        selectedSlot = 0;
        commit();
        rebuildFromProcessor();
    };

    previewButton.setColour (juce::TextButton::buttonColourId, panel);
    previewButton.onClick = [this] { plugin.auditionSlot ((std::size_t) selectedSlot); };

    detectButton.setClickingTogglesState (true);
    detectButton.setColour (juce::TextButton::buttonColourId, panel);
    detectButton.setColour (juce::TextButton::buttonOnColourId, accent);
    detectButton.setColour (juce::TextButton::textColourOnId, juce::Colours::black);
    detectButton.onClick = [this] { plugin.setDetectionArmed (detectButton.getToggleState()); };

    useHeardButton.setColour (juce::TextButton::buttonColourId, panel);
    useHeardButton.onClick = [this] {
        if (plugin.writeHeardChordToSlot ((std::size_t) selectedSlot))
            rebuildFromProcessor();
    };

    heardLabel.setColour (juce::Label::textColourId, inkMuted);
    heardLabel.setFont (juce::Font (juce::FontOptions (13.0f)));

    seedButton.setColour (juce::TextButton::buttonColourId, panel);

    for (auto* component : std::initializer_list<juce::Component*> {
             &keyBox, &scaleBox, &rootBox, &qualityBox, &beatsSlider, &seedButton,
             &previewButton, &borrowedBox, &performanceBox, &paramSlider, &directionBox,
             &detectButton, &useHeardButton, &heardLabel, &octaveSlider, &velocitySlider,
             &gateSlider, &generateButton, &strip })
        addAndMakeVisible (component);

    for (auto& button : neighbourButtons)
        addAndMakeVisible (button);

    for (auto* box : { &keyBox, &scaleBox, &rootBox, &qualityBox, &borrowedBox,
                       &performanceBox, &directionBox })
        box->setColour (juce::ComboBox::backgroundColourId, panel);

    generateButton.setColour (juce::ToggleButton::textColourId, ink);
    for (auto* slider : { &octaveSlider, &velocitySlider, &gateSlider, &paramSlider, &beatsSlider })
        slider->setColour (juce::Slider::textBoxTextColourId, ink);
    gateSlider.setColour (juce::Slider::trackColourId, accent);
    previewButton.setColour (juce::TextButton::textColourOnId, ink);

    plugin.progressionChanged().addChangeListener (this);
    rebuildFromProcessor();

    setSize (760, 470);
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
        beatsSlider.setValue (slot.beats, juce::dontSendNotification);
        rootBox.setSelectedId (slot.rootPc + 1, juce::dontSendNotification);
        for (int i = 0; i < (int) theory::qualities().size(); ++i)
            if (theory::qualities()[(std::size_t) i].quality == slot.quality)
            {
                qualityBox.setSelectedId (i + 1, juce::dontSendNotification);
                break;
            }

        performanceBox.setSelectedId ((int) slot.performance + 1, juce::dontSendNotification);
        directionBox.setSelectedId (slot.direction + 1, juce::dontSendNotification);
        paramSlider.setValue (slot.param > 0 ? slot.param : 4, juce::dontSendNotification);
        paramSlider.setEnabled (slot.performance != Performance::block);
        directionBox.setEnabled (slot.performance == Performance::arp);
    }

    rebuildNeighbours();
    rebuildBorrowed();
    refreshHeardLabel();
    strip.repaint();
}

theory::Scale TrackDraftAudioProcessorEditor::workingScale() const
{
    return (theory::Scale) juce::jlimit (0, (int) theory::Scale::locrian,
                                         juce::jmax (0, scaleBox.getSelectedId() - 1));
}

int TrackDraftAudioProcessorEditor::workingDegree() const
{
    if (selectedSlot >= (int) working.count)
        return 0;

    // The slot stores an absolute pitch class; the walk works in degrees, so
    // map it back through the key. A borrowed chord has no degree and falls
    // back to its position, which keeps the walk usable in a chromatic passage.
    const int keyPc = keyBox.getSelectedId() - 1;
    const int rootPc = working.slots[(std::size_t) selectedSlot].rootPc;
    const auto& steps = theory::scaleIntervals (workingScale());
    for (int degree = 0; degree < (int) steps.size(); ++degree)
        if (((keyPc + steps[(size_t) degree]) % 12 + 12) % 12 == rootPc)
            return degree;

    return selectedSlot % 7;
}

void TrackDraftAudioProcessorEditor::rebuildNeighbours()
{
    const auto neighbours = neighboursOf (workingScale(), workingDegree());
    for (int i = 0; i < 6; ++i)
    {
        const auto& neighbour = neighbours[(size_t) i];
        neighbourButtons[(size_t) i].setButtonText (
            juce::String (neighbour.label) + "  "
            + theory::chordName (neighbour.rootOffset, neighbour.quality));
    }
}

void TrackDraftAudioProcessorEditor::rebuildBorrowed()
{
    borrowedBox.clear (juce::dontSendNotification);
    const auto borrowed = Progression::borrowedChords (workingScale());
    const int keyPc = keyBox.getSelectedId() - 1;

    for (int i = 0; i < (int) borrowed.size(); ++i)
    {
        const auto& chord = borrowed[(std::size_t) i];
        const int rootPc = ((keyPc + chord.rootPc) % 12 + 12) % 12;
        borrowedBox.addItem (juce::String (theory::chordName (rootPc, chord.quality))
                                 + "  (" + juce::String (chord.from) + ")",
                             i + 1);
    }
}

void TrackDraftAudioProcessorEditor::refreshHeardLabel()
{
    const auto heard = plugin.getHeardChord();
    if (! heard.valid)
    {
        heardLabel.setText ("Heard: -", juce::dontSendNotification);
        useHeardButton.setEnabled (false);
        return;
    }

    const auto heardName = juce::String (theory::chordName (heard.rootPc, heard.quality));
    juce::String text = "Heard: " + heardName;

    // Show what the slot currently says, so the difference is the thing you
    // read — "you played X, the slot says Y" is the decision to make.
    if (selectedSlot < (int) working.count)
    {
        const auto& slot = working.slots[(std::size_t) selectedSlot];
        const auto slotName = juce::String (theory::chordName (slot.rootPc, slot.quality));
        text << (slotName == heardName ? juce::String ("  (slot matches)")
                                      : juce::String ("  · slot says ") + slotName);
    }

    heardLabel.setText (text, juce::dontSendNotification);
    useHeardButton.setEnabled (true);
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
    refreshHeardLabel();
    strip.repaint();
}

void TrackDraftAudioProcessorEditor::paint (juce::Graphics& g)
{
    g.fillAll (background);

    g.setColour (accent);
    g.setFont (juce::Font (juce::FontOptions (20.0f)).boldened());
    g.drawText ("TrackDraft Harmony", 16, 10, 320, 26, juce::Justification::centredLeft);

    g.setColour (inkMuted);
    g.setFont (juce::Font (juce::FontOptions (12.0f)));
    g.drawText ("MIDI generator - notes go to the track's own instrument",
                16, 34, 520, 16, juce::Justification::centredLeft);

    auto row = juce::Rectangle<int> (16, 60, 728, 14);
    g.drawText ("Key", row.removeFromLeft (120), juce::Justification::centredLeft);
    g.drawText ("Scale", row.removeFromLeft (180), juce::Justification::centredLeft);
    g.drawText ("Root", row.removeFromLeft (80), juce::Justification::centredLeft);
    g.drawText ("Quality", row.removeFromLeft (190), juce::Justification::centredLeft);

    g.drawText ("Walk from the selected chord (hex neighbours)", 16, 250, 420, 14,
                juce::Justification::centredLeft);
    g.drawText ("Articulation", 16, 348, 120, 14, juce::Justification::centredLeft);
}

void TrackDraftAudioProcessorEditor::resized()
{
    keyBox.setBounds (16, 76, 112, 26);
    scaleBox.setBounds (136, 76, 172, 26);
    rootBox.setBounds (316, 76, 72, 26);
    qualityBox.setBounds (396, 76, 182, 26);

    seedButton.setBounds (586, 76, 100, 26);
    beatsSlider.setBounds (694, 76, 50, 26);

    strip.setBounds (16, 112, 728, 88);

    const int neighbourWidth = (728 - 5 * 6) / 6;
    for (int i = 0; i < 6; ++i)
        neighbourButtons[(size_t) i].setBounds (16 + i * (neighbourWidth + 6), 266,
                                                neighbourWidth, 30);

    borrowedBox.setBounds (16, 304, 300, 26);
    detectButton.setBounds (324, 304, 110, 26);
    useHeardButton.setBounds (440, 304, 100, 26);
    heardLabel.setBounds (16, 332, 728, 18);

    performanceBox.setBounds (16, 364, 110, 26);
    paramSlider.setBounds (132, 364, 70, 26);
    directionBox.setBounds (208, 364, 92, 26);
    previewButton.setBounds (308, 364, 90, 26);

    octaveSlider.setBounds (16, 400, 120, 26);
    velocitySlider.setBounds (144, 400, 130, 26);
    gateSlider.setBounds (282, 400, 200, 26);
    generateButton.setBounds (492, 400, 252, 26);
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
    static const char* performanceLabels[] = { "", "strum", "pulse", "arp" };

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
        g.drawText (theory::chordName (slot.rootPc, slot.quality), area.reduced (4.0f, 12.0f),
                    juce::Justification::centred);

        auto footer = area;
        auto beatsArea = footer.removeFromBottom (16.0f);
        g.setColour (inkMuted);
        g.setFont (juce::Font (juce::FontOptions (11.0f)));
        juce::String detail = juce::String (slot.beats, 0) + " beats";
        const auto articulation = performanceLabels[(int) slot.performance];
        if (articulation[0] != '\0')
            detail << " · " << articulation;
        g.drawText (detail, beatsArea, juce::Justification::centred);
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
