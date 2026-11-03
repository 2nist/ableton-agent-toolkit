#include "PluginEditor.h"
#include "Import/ChordImport.h"
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

/** One place for the vertical rhythm: paint() and resized() both read these. */
namespace layout
{
constexpr int margin = 16;
constexpr int width = 728;
constexpr int height = 756;

constexpr int songLabelY = 58;
constexpr int sectionBarY = 74;
constexpr int sectionBarHeight = 30;
constexpr int sectionButtonY = 110;
constexpr int keysLabelY = 148;
constexpr int keysY = 164;
constexpr int stripY = 200;
constexpr int stripHeight = 88;
constexpr int rhythmLabelY = 300;
constexpr int rhythmY = 316;
constexpr int rhythmHeight = 30;
constexpr int walkLabelY = 364;
constexpr int walkY = 382;
constexpr int detectY = 420;
constexpr int heardY = 450;
constexpr int articulationLabelY = 476;
constexpr int articulationY = 492;
constexpr int voiceY = 524;
constexpr int presetsLabelY = 560;
constexpr int presetsY = 576;
constexpr int arrangementLabelY = 610;
constexpr int arrangementBarY = 626;
constexpr int arrangementBarHeight = 28;
constexpr int arrangementButtonY = 662;
constexpr int bassLabelY = 698;
constexpr int bassY = 714;
} // namespace layout
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
    spreadBox.addItemList ({ "Close", "Open" }, 1);
    bassMotionBox.addItemList ({ "Root", "Root-fifth", "Walking" }, 1);
    bassRhythmBox.addItemList ({ "Locked", "Half", "Eighth" }, 1);
    borrowedBox.setTextWhenNothingSelected ("Borrowed chord...");
    borrowedBox.setTextWhenNoChoicesAvailable ("None in this key");

    octaveSlider.setRange (0, 8, 1);
    bassOctaveBox.addItemList ({ "Oct 1", "Oct 2", "Oct 3", "Oct 4" }, 1);
    bassVelocitySlider.setRange (1, 127, 1);
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
    bassButton.setColour (juce::ToggleButton::textColourId, ink);
    bassButton.setClickingTogglesState (true);
    bassButton.onClick = [this] {
        selectedProgression().bass.enabled = bassButton.getToggleState();
        commit();
        rebuildFromProcessor();
    };

    bassOctaveBox.onChange = [this] {
        selectedProgression().bass.octave = juce::jlimit (1, 4, bassOctaveBox.getSelectedId());
        commit();
        rebuildFromProcessor();
    };

    bassMotionBox.onChange = [this] {
        selectedProgression().bass.motion = (BassMotion) juce::jlimit (0, 2, bassMotionBox.getSelectedId() - 1);
        commit();
        rebuildFromProcessor();
    };

    bassRhythmBox.onChange = [this] {
        selectedProgression().bass.rhythm = (BassRhythm) juce::jlimit (0, 2, bassRhythmBox.getSelectedId() - 1);
        commit();
        rebuildFromProcessor();
    };

    bassVelocitySlider.onValueChange = [this] {
        selectedProgression().bass.velocity = (int) bassVelocitySlider.getValue();
        commit();
    };

    rootBox.onChange = [this] {
        if (selectedSlot < (int) selectedProgression().count)
        {
            selectedProgression().slots[(std::size_t) selectedSlot].rootPc = rootBox.getSelectedId() - 1;
            commit();
            rebuildFromProcessor();
        }
    };

    qualityBox.onChange = [this] {
        if (selectedSlot < (int) selectedProgression().count)
        {
            const int index = juce::jlimit (0, (int) theory::qualities().size() - 1,
                                            qualityBox.getSelectedId() - 1);
            selectedProgression().slots[(std::size_t) selectedSlot].quality =
                theory::qualities()[(std::size_t) index].quality;
            commit();
            rebuildFromProcessor();
        }
    };

    beatsSlider.onValueChange = [this] {
        if (selectedSlot < (int) selectedProgression().count)
        {
            selectedProgression().slots[(std::size_t) selectedSlot].beats = beatsSlider.getValue();
            commit();
            rebuildFromProcessor();
        }
    };

    performanceBox.onChange = [this] {
        if (selectedSlot < (int) selectedProgression().count)
        {
            selectedProgression().slots[(std::size_t) selectedSlot].performance =
                (Performance) juce::jlimit (0, 3, performanceBox.getSelectedId() - 1);
            commit();
            rebuildFromProcessor();
        }
    };

    paramSlider.onValueChange = [this] {
        if (selectedSlot < (int) selectedProgression().count)
        {
            selectedProgression().slots[(std::size_t) selectedSlot].param = (int) paramSlider.getValue();
            commit();
        }
    };

    inversionBox.onChange = [this] {
        if (selectedSlot < (int) selectedProgression().count)
        {
            selectedProgression().slots[(std::size_t) selectedSlot].voicing.inversion =
                juce::jmax (0, inversionBox.getSelectedId() - 1);
            commit();
            rebuildFromProcessor();
        }
    };

    spreadBox.onChange = [this] {
        if (selectedSlot < (int) selectedProgression().count)
        {
            selectedProgression().slots[(std::size_t) selectedSlot].voicing.open =
                spreadBox.getSelectedId() == 2;
            commit();
            rebuildFromProcessor();
        }
    };

    directionBox.onChange = [this] {
        if (selectedSlot < (int) selectedProgression().count)
        {
            selectedProgression().slots[(std::size_t) selectedSlot].direction =
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

            if (slotIndex >= selectedProgression().count)
                selectedProgression().count = juce::jmin (Progression::maxSlots, slotIndex + 1);

            const int keyPc = keyBox.getSelectedId() - 1;
            auto& slot = selectedProgression().slots[slotIndex];
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
        if (id <= 0 || selectedSlot >= (int) selectedProgression().count)
            return;

        const auto borrowed = Progression::borrowedChords (workingScale());
        if ((std::size_t) (id - 1) >= borrowed.size())
            return;

        const auto& chord = borrowed[(std::size_t) (id - 1)];
        const int keyPc = keyBox.getSelectedId() - 1;
        auto& slot = selectedProgression().slots[(std::size_t) selectedSlot];
        slot.rootPc = ((keyPc + chord.rootPc) % 12 + 12) % 12;
        slot.quality = chord.quality;
        commit();
        rebuildFromProcessor();
    };

    seedButton.onClick = [this] {
        selectedProgression().seedFromScale (keyBox.getSelectedId() - 1,
                               (theory::Scale) juce::jmax (0, scaleBox.getSelectedId() - 1),
                               selectedProgression().count);
        selectedSlot = 0;
        commit();
        rebuildFromProcessor();
    };

    previewButton.setColour (juce::TextButton::buttonColourId, panel);
    previewButton.onClick = [this] { plugin.auditionSlot (selectedSection, (std::size_t) selectedSlot); };

    detectButton.setClickingTogglesState (true);
    detectButton.setColour (juce::TextButton::buttonColourId, panel);
    detectButton.setColour (juce::TextButton::buttonOnColourId, accent);
    detectButton.setColour (juce::TextButton::textColourOnId, juce::Colours::black);
    detectButton.onClick = [this] { plugin.setDetectionArmed (detectButton.getToggleState()); };

    useHeardButton.setColour (juce::TextButton::buttonColourId, panel);
    useHeardButton.onClick = [this] {
        if (plugin.writeHeardChordToSlot (selectedSection, (std::size_t) selectedSlot))
            rebuildFromProcessor();
    };

    heardLabel.setColour (juce::Label::textColourId, inkMuted);
    heardLabel.setFont (juce::Font (juce::FontOptions (13.0f)));

    presetBox.setTextWhenNothingSelected ("Preset...");
    presetNameEditor.setTextToShowWhenEmpty ("Preset name", inkMuted);
    presetNameEditor.setColour (juce::TextEditor::backgroundColourId, panel);
    presetNameEditor.setColour (juce::TextEditor::textColourId, ink);
    presetNameEditor.setColour (juce::TextEditor::outlineColourId, well);

    presetBox.onChange = [this] {
        const auto name = presetBox.getText();
        if (name.isEmpty())
            return;

        // Factory entries are code, not files: they live in the same list so a
        // saved preset and a built-in one behave the same on click.
        for (const auto& factory : PresetStore::factories())
            if (factory.name == name)
            {
                presetNameEditor.clear();
                commitSection (factory.progression);
                return;
            }

        juce::String error;
        switch (presets.kindOf (name))
        {
            case PresetStore::Kind::song:
            {
                Song loaded;
                if (presets.loadSong (name, loaded, error))
                {
                    presetNameEditor.setText (name, juce::dontSendNotification);
                    commitWith (loaded);
                }
                else
                {
                    heardLabel.setText (error, juce::dontSendNotification);
                }
                break;
            }

            case PresetStore::Kind::progression:
            {
                Progression loaded = selectedProgression();
                if (presets.load (name, loaded, error))
                {
                    presetNameEditor.setText (name, juce::dontSendNotification);
                    commitSection (loaded);
                }
                else
                {
                    heardLabel.setText (error, juce::dontSendNotification);
                }
                break;
            }

            case PresetStore::Kind::unusable:
                heardLabel.setText ("Cannot read " + name, juce::dontSendNotification);
                break;
        }
    };

    renamePresetButton.onClick = [this] {
        const auto from = presetBox.getText();
        const auto to = presetNameEditor.getText();
        if (from.isEmpty() || to.trim().isEmpty())
            return;

        juce::String error;
        if (presets.rename (from, to, error))
        {
            rebuildPresets();
            presetBox.setText (PresetStore::sanitiseName (to), juce::dontSendNotification);
        }
        else
        {
            heardLabel.setText (error, juce::dontSendNotification);
        }
    };

    deletePresetButton.onClick = [this] {
        const auto name = presetBox.getText();
        if (name.isEmpty())
            return;

        juce::String error;
        if (presets.remove (name, error))
        {
            rebuildPresets();
            presetNameEditor.clear();
        }
        else
        {
            heardLabel.setText (error, juce::dontSendNotification);
        }
    };

    importButton.onClick = [this] {
        importChooser = std::make_unique<juce::FileChooser> (
            "Import a chord annotation or MIDI file",
            juce::File::getSpecialLocation (juce::File::userHomeDirectory), "*.mid;*.midi;*.json;*.jams");

        // A native async chooser: the editor must not block the message thread.
        importChooser->launchAsync (juce::FileBrowserComponent::openMode
                                        | juce::FileBrowserComponent::canSelectFiles,
                                    [this] (const juce::FileChooser& chooser) {
                                        const auto file = chooser.getResult();
                                        if (file == juce::File())
                                            return;

                                        const auto scale = workingScale();
                                        const auto imported = importProgressionFromFile (
                                            file, scale, keyBox.getSelectedId() - 1);

                                        heardLabel.setText (imported.message, juce::dontSendNotification);
                                        if (imported.ok)
                                        {
                                            presetNameEditor.setText (file.getFileNameWithoutExtension(),
                                                                      juce::dontSendNotification);
                                            commitSection (imported.progression);
                                        }
                                    });
    };

    savePresetButton.onClick = [this] {
        const auto name = presetNameEditor.getText();
        if (name.trim().isEmpty())
            return;

        juce::String error;
        if (presets.save (name, selectedProgression(), error))
        {
            rebuildPresets();
            presetBox.setText (PresetStore::sanitiseName (name), juce::dontSendNotification);
        }
        else
        {
            heardLabel.setText (error, juce::dontSendNotification);
        }
    };

    applyAllButton.onClick = [this] {
        selectedProgression().applyFeelToAll ((std::size_t) selectedSlot);
        commit();
        rebuildFromProcessor();
    };

    seedButton.setColour (juce::TextButton::buttonColourId, panel);
    savePresetButton.setColour (juce::TextButton::buttonColourId, panel);
    applyAllButton.setColour (juce::TextButton::buttonColourId, panel);
    renamePresetButton.setColour (juce::TextButton::buttonColourId, panel);
    deletePresetButton.setColour (juce::TextButton::buttonColourId, panel);
    importButton.setColour (juce::TextButton::buttonColourId, panel);

    for (auto* component : std::initializer_list<juce::Component*> {
             &keyBox, &scaleBox, &rootBox, &qualityBox, &beatsSlider, &seedButton,
             &previewButton, &borrowedBox, &performanceBox, &paramSlider, &directionBox,
             &detectButton, &useHeardButton, &heardLabel, &octaveSlider, &velocitySlider,
             &gateSlider, &generateButton, &bassButton, &bassOctaveBox, &bassMotionBox,
             &bassRhythmBox, &bassVelocitySlider, &inversionBox, &spreadBox,
             &rhythmGrid, &clearRhythmButton,
             &strip, &presetBox, &presetNameEditor,
             &savePresetButton, &applyAllButton, &renamePresetButton, &deletePresetButton,
             &importButton, &sectionBar, &arrangementBar, &sectionNameEditor,
             &addSectionButton, &duplicateSectionButton, &deleteSectionButton,
             &moveSectionLeftButton, &moveSectionRightButton, &addPassButton,
             &moreRepeatsButton, &fewerRepeatsButton, &removePassButton, &saveSongButton })
        addAndMakeVisible (component);

    for (auto& button : neighbourButtons)
        addAndMakeVisible (button);

    //==== The song ========================================================
    sectionNameEditor.setTextToShowWhenEmpty ("Section name", inkMuted);
    sectionNameEditor.setColour (juce::TextEditor::backgroundColourId, panel);
    sectionNameEditor.setColour (juce::TextEditor::textColourId, ink);
    sectionNameEditor.setColour (juce::TextEditor::outlineColourId, well);
    sectionNameEditor.onReturnKey = [this] { renameSelectedSection(); };
    sectionNameEditor.onFocusLost = [this] { renameSelectedSection(); };

    for (auto* button : { &addSectionButton, &duplicateSectionButton, &deleteSectionButton,
                          &moveSectionLeftButton, &moveSectionRightButton, &addPassButton,
                          &moreRepeatsButton, &fewerRepeatsButton, &removePassButton,
                          &saveSongButton, &clearRhythmButton })
    {
        button->setColour (juce::TextButton::buttonColourId, panel);
        button->setColour (juce::TextButton::textColourOffId, ink);
    }

    addSectionButton.onClick = [this] {
        const auto added = working.addSection ("Section " + juce::String ((int) working.sections.size() + 1));
        if (added == Song::npos)
        {
            heardLabel.setText ("That is as many sections as a song holds", juce::dontSendNotification);
            return;
        }

        // A new section starts from the selected one's scale, so it is playable
        // immediately rather than four empty slots.
        working.sections[added].progression.seedFromScale (
            keyBox.getSelectedId() - 1, workingScale(), 4);
        selectedSection = added;
        selectedSlot = 0;
        selectedPass = working.arrangement.empty() ? 0 : working.arrangement.size() - 1;
        commit();
        rebuildFromProcessor();
    };

    duplicateSectionButton.onClick = [this] {
        const auto copy = working.duplicateSection (selectedSection);
        if (copy == Song::npos)
            return;
        selectedSection = copy;
        commit();
        rebuildFromProcessor();
    };

    deleteSectionButton.onClick = [this] {
        if (working.sections.size() <= 1)
        {
            heardLabel.setText ("A song keeps at least one section", juce::dontSendNotification);
            return;
        }
        working.removeSection (selectedSection);
        selectedSection = juce::jmin (selectedSection, working.sections.size() - 1);
        selectedSlot = 0;
        commit();
        rebuildFromProcessor();
    };

    moveSectionLeftButton.onClick = [this] {
        if (selectedSection == 0)
            return;
        working.moveSection (selectedSection, selectedSection - 1);
        --selectedSection;
        commit();
        rebuildFromProcessor();
    };

    moveSectionRightButton.onClick = [this] {
        if (selectedSection + 1 >= working.sections.size())
            return;
        working.moveSection (selectedSection, selectedSection + 1);
        ++selectedSection;
        commit();
        rebuildFromProcessor();
    };

    addPassButton.onClick = [this] {
        if (! working.appendPass (selectedSection))
        {
            heardLabel.setText ("That is as long an arrangement as this holds",
                                juce::dontSendNotification);
            return;
        }

        selectedPass = working.arrangement.empty() ? 0 : working.arrangement.size() - 1;
        commit();
        rebuildFromProcessor();
    };

    moreRepeatsButton.onClick = [this] {
        if (selectedPass >= working.arrangement.size())
            return;
        working.setRepeats (selectedPass, working.arrangement[selectedPass].repeats + 1);
        commit();
        rebuildFromProcessor();
    };

    fewerRepeatsButton.onClick = [this] {
        if (selectedPass >= working.arrangement.size())
            return;
        working.setRepeats (selectedPass, working.arrangement[selectedPass].repeats - 1);
        commit();
        rebuildFromProcessor();
    };

    saveSongButton.setTooltip ("Write every section and the arrangement to the preset folder, "
                               "under the name in the Presets row");
    saveSongButton.onClick = [this] {
        auto name = presetNameEditor.getText().trim();
        if (name.isEmpty())
            name = "Song";

        juce::String error;
        if (presets.saveSong (name, working, error))
        {
            rebuildPresets();
            const auto saved = PresetStore::sanitiseName (name);
            presetBox.setText (saved, juce::dontSendNotification);
            heardLabel.setText ("Saved the song as " + saved, juce::dontSendNotification);
        }
        else
        {
            heardLabel.setText (error, juce::dontSendNotification);
        }
    };

    removePassButton.onClick = [this] {
        if (selectedPass >= working.arrangement.size())
            return;
        if (! working.removePass (selectedPass))
        {
            heardLabel.setText ("That is the last pass — the song has to play something",
                                juce::dontSendNotification);
            return;
        }
        if (selectedPass >= working.arrangement.size())
            selectedPass = working.arrangement.empty() ? 0 : working.arrangement.size() - 1;
        commit();
        rebuildFromProcessor();
    };

    clearRhythmButton.setColour (juce::TextButton::buttonColourId, panel);
    clearRhythmButton.setColour (juce::TextButton::textColourOffId, ink);
    clearRhythmButton.setTooltip ("Give this slot back to its articulation");
    clearRhythmButton.onClick = [this] {
        selectedProgression().slots[(std::size_t) selectedSlot].rhythm = {};
        commit();
        rebuildFromProcessor();
    };

    for (auto* box : { &keyBox, &scaleBox, &rootBox, &qualityBox, &borrowedBox,
                       &performanceBox, &directionBox, &inversionBox, &spreadBox,
                       &bassOctaveBox, &bassMotionBox, &bassRhythmBox })
        box->setColour (juce::ComboBox::backgroundColourId, panel);

    generateButton.setColour (juce::ToggleButton::textColourId, ink);
    for (auto* slider : { &octaveSlider, &velocitySlider, &gateSlider, &paramSlider, &beatsSlider,
                          &bassVelocitySlider })
        slider->setColour (juce::Slider::textBoxTextColourId, ink);
    gateSlider.setColour (juce::Slider::trackColourId, accent);
    previewButton.setColour (juce::TextButton::textColourOnId, ink);

    plugin.progressionChanged().addChangeListener (this);
    rebuildFromProcessor();

    rebuildPresets();
    setSize (760, layout::height);
    startTimerHz (20);
}

TrackDraftAudioProcessorEditor::~TrackDraftAudioProcessorEditor()
{
    plugin.progressionChanged().removeChangeListener (this);
    stopTimer();
}

void TrackDraftAudioProcessorEditor::rebuildFromProcessor()
{
    working = plugin.getSong();
    if (working.sections.empty())
        working.addSection ("Section");

    if (selectedSection >= working.sections.size())
        selectedSection = working.sections.size() - 1;
    if (selectedPass >= working.arrangement.size())
        selectedPass = working.arrangement.empty() ? 0 : working.arrangement.size() - 1;

    if (selectedSlot >= (int) selectedProgression().count)
        selectedSlot = 0;

    sectionNameEditor.setText (working.sections[selectedSection].name,
                               juce::dontSendNotification);

    const auto& bass = selectedProgression().bass;
    bassButton.setToggleState (bass.enabled, juce::dontSendNotification);
    bassOctaveBox.setSelectedId (juce::jlimit (1, 4, bass.octave), juce::dontSendNotification);
    bassMotionBox.setSelectedId ((int) bass.motion + 1, juce::dontSendNotification);
    bassRhythmBox.setSelectedId ((int) bass.rhythm + 1, juce::dontSendNotification);
    bassVelocitySlider.setValue (juce::jlimit (1, 127, bass.velocity), juce::dontSendNotification);

    // Off means off: the shape controls only matter once the voice is on.
    for (auto* control : { (juce::Component*) &bassOctaveBox, (juce::Component*) &bassMotionBox,
                           (juce::Component*) &bassRhythmBox,
                           (juce::Component*) &bassVelocitySlider })
        control->setEnabled (bass.enabled);

    if (selectedSlot < (int) selectedProgression().count)
    {
        const auto& slot = selectedProgression().slots[(std::size_t) selectedSlot];
        beatsSlider.setValue (slot.beats, juce::dontSendNotification);
        rootBox.setSelectedId (slot.rootPc + 1, juce::dontSendNotification);
        for (int i = 0; i < (int) theory::qualities().size(); ++i)
            if (theory::qualities()[(std::size_t) i].quality == slot.quality)
            {
                qualityBox.setSelectedId (i + 1, juce::dontSendNotification);
                break;
            }

        // The inversion list is this chord's own tones: "1st" means different
        // notes for a triad and for a 13th, so it cannot be a fixed list.
        inversionBox.clear (juce::dontSendNotification);
        const auto inversionCount = (int) theory::inversionCount (slot.quality);
        for (int i = 0; i < inversionCount; ++i)
        {
            const int bassPc = theory::bassPitchClass (
                slot.rootPc, slot.quality, theory::Voicing { i, false });
            inversionBox.addItem (juce::String (i == 0 ? "Root" : (i == 1 ? "1st" : (i == 2 ? "2nd" : juce::String (i) + "th")))
                                      + " (" + theory::pitchClassName (bassPc) + ")",
                                  i + 1);
        }
        inversionBox.setSelectedId (juce::jlimit (0, inversionCount - 1, slot.voicing.inversion) + 1,
                                    juce::dontSendNotification);
        spreadBox.setSelectedId (slot.voicing.open ? 2 : 1, juce::dontSendNotification);

        performanceBox.setSelectedId ((int) slot.performance + 1, juce::dontSendNotification);
        directionBox.setSelectedId (slot.direction + 1, juce::dontSendNotification);
        // The same control means two things: strum spread in milliseconds, or a
        // subdivision for pulse and arp. Its range follows the slot.
        const bool strumming = slot.performance == Performance::strum;
        paramSlider.setRange (strumming ? 20.0 : 1.0, strumming ? 500.0 : 32.0, 1.0);
        const double defaultValue = strumming ? 150.0 : 4.0;
        paramSlider.setValue (slot.param > 0 ? (double) slot.param : defaultValue,
                              juce::dontSendNotification);
        paramSlider.setEnabled (slot.performance != Performance::block);
        directionBox.setEnabled (slot.performance == Performance::arp);
    }

    rebuildSections();
    rebuildArrangement();
    rebuildNeighbours();
    rebuildBorrowed();
    refreshHeardLabel();
    strip.repaint();

    // The grid follows the transport while the section it belongs to is the one
    // on screen; elsewhere the cursor is meaningless.
    const auto playingSection = plugin.playingSection.load();
    rhythmGrid.setCursor (playingSection == (int) selectedSection ? plugin.playingStep.load() : -1);
}

theory::Scale TrackDraftAudioProcessorEditor::workingScale() const
{
    return (theory::Scale) juce::jlimit (0, (int) theory::Scale::locrian,
                                         juce::jmax (0, scaleBox.getSelectedId() - 1));
}

int TrackDraftAudioProcessorEditor::workingDegree() const
{
    if (selectedSlot >= (int) selectedProgression().count)
        return 0;

    // The slot stores an absolute pitch class; the walk works in degrees, so
    // map it back through the key. A borrowed chord has no degree and falls
    // back to its position, which keeps the walk usable in a chromatic passage.
    const int keyPc = keyBox.getSelectedId() - 1;
    const int rootPc = selectedProgression().slots[(std::size_t) selectedSlot].rootPc;
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

void TrackDraftAudioProcessorEditor::rebuildPresets()
{
    presetBox.clear (juce::dontSendNotification);

    int id = 1;
    for (const auto& factory : PresetStore::factories())
        presetBox.addItem (factory.name, id++);

    for (const auto& name : presets.names())
        presetBox.addItem (name, id++);
}

void TrackDraftAudioProcessorEditor::rebuildSections()
{
    // The bars draw themselves from `working`, so there is nothing to fill in —
    // they only need to be told the list changed shape.
    sectionBar.repaint();
}

void TrackDraftAudioProcessorEditor::rebuildArrangement()
{
    const bool hasPass = selectedPass < working.arrangement.size();
    moreRepeatsButton.setEnabled (hasPass);
    fewerRepeatsButton.setEnabled (hasPass);
    removePassButton.setEnabled (hasPass);

    if (hasPass)
    {
        const auto repeats = working.arrangement[selectedPass].repeats;
        moreRepeatsButton.setButtonText ("+ rep " + juce::String (repeats));
    }
    else
    {
        moreRepeatsButton.setButtonText ("+ rep");
    }

    arrangementBar.repaint();
}

void TrackDraftAudioProcessorEditor::renameSelectedSection()
{
    if (working.sections.empty())
        return;

    const auto name = sectionNameEditor.getText().trim();
    if (name.isEmpty() || name == working.sections[selectedSection].name)
        return;

    working.sections[selectedSection].name = name;
    commit();
    rebuildSections();
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
    if (selectedSlot < (int) selectedProgression().count)
    {
        const auto& slot = selectedProgression().slots[(std::size_t) selectedSlot];
        const auto slotName = juce::String (theory::chordName (slot.rootPc, slot.quality));
        text << (slotName == heardName ? juce::String ("  (slot matches)")
                                      : juce::String ("  · slot says ") + slotName);
    }

    heardLabel.setText (text, juce::dontSendNotification);
    useHeardButton.setEnabled (true);
}

void TrackDraftAudioProcessorEditor::commit()
{
    plugin.setSong (working);
}

void TrackDraftAudioProcessorEditor::commitWith (const Song& next)
{
    working = next;
    if (working.sections.empty())
        working.addSection ("Section");
    if (selectedSection >= working.sections.size())
        selectedSection = working.sections.size() - 1;

    commit();
    rebuildFromProcessor();
}

void TrackDraftAudioProcessorEditor::commitSection (const Progression& next)
{
    if (selectedSection >= working.sections.size())
        return;

    working.sections[selectedSection].progression = next;
    commit();
    rebuildFromProcessor();
}

Progression& TrackDraftAudioProcessorEditor::selectedProgression()
{
    // `working` always holds at least one section: `rebuildFromProcessor` and
    // `commitWith` both enforce it, and the processor never stores an empty song.
    jassert (! working.sections.empty());
    return working.sections[juce::jmin (selectedSection, working.sections.size() - 1)]
        .progression;
}

const Progression& TrackDraftAudioProcessorEditor::selectedProgression() const
{
    jassert (! working.sections.empty());
    return working.sections[juce::jmin (selectedSection, working.sections.size() - 1)]
        .progression;
}

void TrackDraftAudioProcessorEditor::changeListenerCallback (juce::ChangeBroadcaster*)
{
    rebuildFromProcessor();
}

void TrackDraftAudioProcessorEditor::timerCallback()
{
    refreshHeardLabel();
    strip.repaint();

    // The grid follows the transport while the section it belongs to is the one
    // on screen; elsewhere the cursor is meaningless.
    const auto playingSection = plugin.playingSection.load();
    rhythmGrid.setCursor (playingSection == (int) selectedSection ? plugin.playingStep.load() : -1);
    // The bars show which section and pass the transport is in.
    sectionBar.repaint();
    arrangementBar.repaint();
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

    auto row = juce::Rectangle<int> (layout::margin, layout::keysLabelY, layout::width, 14);
    g.drawText ("Key", row.removeFromLeft (120), juce::Justification::centredLeft);
    g.drawText ("Scale", row.removeFromLeft (180), juce::Justification::centredLeft);
    g.drawText ("Root", row.removeFromLeft (80), juce::Justification::centredLeft);
    g.drawText ("Quality", row.removeFromLeft (190), juce::Justification::centredLeft);

    g.drawText ("Sections  (" + juce::String ((int) working.sections.size()) + ")",
                layout::margin, layout::songLabelY, 420, 14, juce::Justification::centredLeft);
    g.drawText ("Rhythm - click a step: off, normal, accent, ghost. "
                "The articulation plays each hit.",
                layout::margin, layout::rhythmLabelY, 600, 14, juce::Justification::centredLeft);
    g.drawText ("Walk from the selected chord (hex neighbours)", layout::margin, layout::walkLabelY,
                420, 14, juce::Justification::centredLeft);
    g.drawText ("Articulation", layout::margin, layout::articulationLabelY, 120, 14,
                juce::Justification::centredLeft);
    g.drawText ("Inversion / spread", 356, layout::articulationLabelY, 210, 14,
                juce::Justification::centredLeft);
    g.drawText ("Presets", layout::margin, layout::presetsLabelY, 120, 14,
                juce::Justification::centredLeft);
    g.drawText ("Arrangement", layout::margin, layout::arrangementLabelY, 120, 14,
                juce::Justification::centredLeft);
    g.drawText ("Bass line for this section", layout::margin, layout::bassLabelY, 300, 14,
                juce::Justification::centredLeft);

    // What the arrangement adds up to, so the form can be read at a glance.
    g.setColour (accent.withAlpha (0.85f));
    g.drawText (juce::String (working.totalBeats() / 4.0, 1) + " bars",
                layout::margin + 400, layout::arrangementLabelY, layout::width - 400, 14,
                juce::Justification::centredRight);
}

void TrackDraftAudioProcessorEditor::resized()
{
    sectionBar.setBounds (layout::margin, layout::sectionBarY, layout::width,
                          layout::sectionBarHeight);

    // Name, then the five structural buttons: the row is where sections are
    // made and moved, the bar above is where they are chosen.
    sectionNameEditor.setBounds (layout::margin, layout::sectionButtonY, 240, 26);
    addSectionButton.setBounds (264, layout::sectionButtonY, 30, 26);
    duplicateSectionButton.setBounds (298, layout::sectionButtonY, 52, 26);
    deleteSectionButton.setBounds (354, layout::sectionButtonY, 52, 26);
    moveSectionLeftButton.setBounds (410, layout::sectionButtonY, 30, 26);
    moveSectionRightButton.setBounds (444, layout::sectionButtonY, 30, 26);

    keyBox.setBounds (layout::margin, layout::keysY, 112, 26);
    scaleBox.setBounds (136, layout::keysY, 172, 26);
    rootBox.setBounds (316, layout::keysY, 72, 26);
    qualityBox.setBounds (396, layout::keysY, 182, 26);
    seedButton.setBounds (586, layout::keysY, 100, 26);
    beatsSlider.setBounds (694, layout::keysY, 50, 26);

    strip.setBounds (layout::margin, layout::stripY, layout::width, layout::stripHeight);
    rhythmGrid.setBounds (layout::margin, layout::rhythmY, layout::width - 110,
                          layout::rhythmHeight);
    clearRhythmButton.setBounds (layout::margin + layout::width - 104, layout::rhythmY, 104, 30);

    const int neighbourWidth = (layout::width - 5 * 6) / 6;
    for (int i = 0; i < 6; ++i)
        neighbourButtons[(size_t) i].setBounds (layout::margin + i * (neighbourWidth + 6),
                                                layout::walkY, neighbourWidth, 30);

    borrowedBox.setBounds (layout::margin, layout::detectY, 300, 26);
    detectButton.setBounds (324, layout::detectY, 110, 26);
    useHeardButton.setBounds (440, layout::detectY, 100, 26);
    heardLabel.setBounds (layout::margin, layout::heardY, layout::width, 18);

    performanceBox.setBounds (layout::margin, layout::articulationY, 96, 26);
    paramSlider.setBounds (116, layout::articulationY, 62, 26);
    directionBox.setBounds (182, layout::articulationY, 84, 26);
    previewButton.setBounds (270, layout::articulationY, 80, 26);
    inversionBox.setBounds (356, layout::articulationY, 118, 26);
    spreadBox.setBounds (478, layout::articulationY, 84, 26);
    applyAllButton.setBounds (566, layout::articulationY, 142, 26);

    octaveSlider.setBounds (layout::margin, layout::voiceY, 112, 26);
    velocitySlider.setBounds (132, layout::voiceY, 112, 26);
    gateSlider.setBounds (248, layout::voiceY, 170, 26);
    generateButton.setBounds (422, layout::voiceY, 322, 26);

    bassButton.setBounds (layout::margin, layout::bassY, 96, 26);
    bassOctaveBox.setBounds (118, layout::bassY, 74, 26);
    bassMotionBox.setBounds (198, layout::bassY, 112, 26);
    bassRhythmBox.setBounds (316, layout::bassY, 104, 26);
    bassVelocitySlider.setBounds (426, layout::bassY, 90, 26);

    presetBox.setBounds (layout::margin, layout::presetsY, 190, 26);
    presetNameEditor.setBounds (214, layout::presetsY, 180, 26);
    savePresetButton.setBounds (402, layout::presetsY, 64, 26);
    renamePresetButton.setBounds (472, layout::presetsY, 76, 26);
    deletePresetButton.setBounds (554, layout::presetsY, 70, 26);
    importButton.setBounds (630, layout::presetsY, 106, 26);

    arrangementBar.setBounds (layout::margin, layout::arrangementBarY, layout::width,
                              layout::arrangementBarHeight);
    addPassButton.setBounds (layout::margin, layout::arrangementButtonY, 80, 26);
    moreRepeatsButton.setBounds (104, layout::arrangementButtonY, 80, 26);
    fewerRepeatsButton.setBounds (188, layout::arrangementButtonY, 80, 26);
    removePassButton.setBounds (272, layout::arrangementButtonY, 80, 26);
    saveSongButton.setBounds (410, layout::arrangementButtonY, 120, 26);
}

juce::Rectangle<int> TrackDraftAudioProcessorEditor::RhythmGrid::boundsFor (int step) const
{
    const int gap = 3;
    const int total = (int) RhythmPattern::steps;
    const int width = juce::jmax (8, (getWidth() - gap * (total - 1)) / total);

    // Every fourth cell is a beat, so the gaps there are visible.
    const int beatsBefore = step / RhythmPattern::stepsPerBeat;
    return { step * (width + gap) + beatsBefore * 4, 0, width, getHeight() };
}

int TrackDraftAudioProcessorEditor::RhythmGrid::stepAt (juce::Point<int> position) const
{
    for (int step = 0; step < (int) RhythmPattern::steps; ++step)
        if (boundsFor (step).contains (position))
            return step;

    return -1;
}

void TrackDraftAudioProcessorEditor::RhythmGrid::setCursor (int step)
{
    if (step == cursorStep)
        return;

    cursorStep = step;
    repaint();
}

void TrackDraftAudioProcessorEditor::RhythmGrid::paint (juce::Graphics& g)
{
    const auto& slot = owner.selectedProgression().slots[(std::size_t) owner.selectedSlot];
    const bool hasPattern = slot.rhythm.enabled;

    for (int step = 0; step < (int) RhythmPattern::steps; ++step)
    {
        const auto area = boundsFor (step).toFloat().reduced (0.5f);
        const int level = (int) slot.rhythm.level[(std::size_t) step];

        // Height carries the level, so the shape of the groove is readable at a
        // glance; a slot with no pattern shows the grid empty and dimmed, which
        // is what "the articulation plays it" looks like.
        const float fill = level == RhythmPattern::accent ? 1.0f
                           : level == RhythmPattern::normal ? 0.66f
                           : level == RhythmPattern::ghost ? 0.36f
                                                           : 0.0f;

        g.setColour (well);
        g.fillRoundedRectangle (area, 3.0f);

        if (fill > 0.0f)
        {
            auto bar = area;
            bar = bar.withHeight (area.getHeight() * fill).withY (area.getBottom() - area.getHeight() * fill);
            g.setColour ((level == RhythmPattern::accent ? accent : ink).withAlpha (hasPattern ? 1.0f : 0.4f));
            g.fillRoundedRectangle (bar, 3.0f);
        }
        else if (! hasPattern)
        {
            g.setColour (inkMuted.withAlpha (0.25f));
            g.fillRect (area.withHeight (2.0f).withY (area.getBottom() - 3.0f));
        }

        if (step == cursorStep)
        {
            g.setColour (accent.withAlpha (0.85f));
            g.drawRoundedRectangle (area, 3.0f, 1.5f);
        }

        // The beat columns get a brighter edge, so "1 · 2 · 3 · 4" is visible.
        if (step % RhythmPattern::stepsPerBeat == 0)
        {
            g.setColour (panel);
            g.drawLine (area.getX(), area.getY(), area.getX(), area.getBottom(), 1.0f);
        }
    }
}

void TrackDraftAudioProcessorEditor::RhythmGrid::mouseDown (const juce::MouseEvent& event)
{
    const int step = stepAt (event.getPosition());
    if (step < 0)
        return;

    auto& slot = owner.selectedProgression().slots[(std::size_t) owner.selectedSlot];
    auto& pattern = slot.rhythm;

    // A first click turns the grid on at "normal", so one click already makes a
    // rhythm; after that it cycles off → normal → accent → ghost.
    if (! pattern.enabled)
    {
        pattern = {};
        pattern.enabled = true;
        pattern.level[(std::size_t) step] = RhythmPattern::normal;
    }
    else
    {
        auto& level = pattern.level[(std::size_t) step];
        level = level == RhythmPattern::off ? RhythmPattern::normal
                : level == RhythmPattern::normal ? RhythmPattern::accent
                : level == RhythmPattern::accent ? RhythmPattern::ghost
                                                 : RhythmPattern::off;
    }

    owner.commit();
    owner.rebuildFromProcessor();
    repaint();
}

juce::Rectangle<int> TrackDraftAudioProcessorEditor::SectionBar::boundsFor (int index) const
{
    const int gap = 6;
    const int total = juce::jmax (1, (int) owner.working.sections.size());
    const int width = juce::jmax (24, (getWidth() - gap * (total - 1)) / total);
    return { index * (width + gap), 0, width, getHeight() };
}

int TrackDraftAudioProcessorEditor::SectionBar::indexAt (juce::Point<int> position) const
{
    for (int i = 0; i < (int) owner.working.sections.size(); ++i)
        if (boundsFor (i).contains (position))
            return i;

    return -1;
}

void TrackDraftAudioProcessorEditor::SectionBar::paint (juce::Graphics& g)
{
    const auto soundingSection = owner.plugin.playingSection.load();

    for (int i = 0; i < (int) owner.working.sections.size(); ++i)
    {
        const auto area = boundsFor (i).toFloat().reduced (1.0f);
        const auto& section = owner.working.sections[(std::size_t) i];

        g.setColour (well);
        g.fillRoundedRectangle (area, 5.0f);

        if (i == soundingSection)
        {
            g.setColour (accent.withAlpha (0.28f));
            g.fillRoundedRectangle (area, 5.0f);
        }

        const bool selected = (std::size_t) i == owner.selectedSection;
        g.setColour (selected ? accent : panel);
        g.drawRoundedRectangle (area, 5.0f, selected ? 2.0f : 1.0f);

        auto text = area.reduced (5.0f, 3.0f);
        auto countArea = text.removeFromBottom (12.0f);

        g.setColour (ink);
        g.setFont (juce::Font (juce::FontOptions (12.0f)));
        g.drawText (section.name, text, juce::Justification::centred, true);

        g.setColour (inkMuted);
        g.setFont (juce::Font (juce::FontOptions (10.0f)));
        g.drawText (juce::String ((int) section.progression.count) + " chords", countArea,
                    juce::Justification::centred, true);
    }
}

void TrackDraftAudioProcessorEditor::SectionBar::mouseDown (const juce::MouseEvent& event)
{
    const int index = indexAt (event.getPosition());
    if (index < 0)
        return;

    // A name typed but not committed belongs to the section that is still
    // selected, so it is written before the selection moves.
    owner.renameSelectedSection();

    owner.selectedSection = (std::size_t) index;
    owner.selectedSlot = 0;
    owner.rebuildFromProcessor();
}

juce::Rectangle<int> TrackDraftAudioProcessorEditor::ArrangementBar::boundsFor (int index) const
{
    const int gap = 4;
    const int total = juce::jmax (1, (int) owner.working.arrangement.size());
    const int width = juce::jmax (10, (getWidth() - gap * (total - 1)) / total);
    return { index * (width + gap), 0, width, getHeight() };
}

int TrackDraftAudioProcessorEditor::ArrangementBar::indexAt (juce::Point<int> position) const
{
    for (int i = 0; i < (int) owner.working.arrangement.size(); ++i)
        if (boundsFor (i).contains (position))
            return i;

    return -1;
}

void TrackDraftAudioProcessorEditor::ArrangementBar::paint (juce::Graphics& g)
{
    const auto playingPass = owner.plugin.playingPass.load();

    for (int i = 0; i < (int) owner.working.arrangement.size(); ++i)
    {
        const auto& pass = owner.working.arrangement[(std::size_t) i];
        const auto sectionIndex = owner.working.indexOf (pass.sectionId);
        if (sectionIndex == Song::npos)
            continue;

        const auto area = boundsFor (i).toFloat().reduced (1.0f);
        g.setColour (well);
        g.fillRoundedRectangle (area, 4.0f);

        if (i == playingPass)
        {
            g.setColour (accent.withAlpha (0.32f));
            g.fillRoundedRectangle (area, 4.0f);
        }

        const bool selected = (std::size_t) i == owner.selectedPass;
        g.setColour (selected ? accent : panel);
        g.drawRoundedRectangle (area, 4.0f, selected ? 2.0f : 1.0f);

        juce::String label = owner.working.sections[sectionIndex].name;
        if (pass.repeats > 1)
            label << " x" << pass.repeats;

        g.setColour (ink);
        g.setFont (juce::Font (juce::FontOptions (11.0f)));
        g.drawText (label, area.reduced (4.0f, 2.0f), juce::Justification::centred, true);
    }
}

void TrackDraftAudioProcessorEditor::ArrangementBar::mouseDown (const juce::MouseEvent& event)
{
    const int index = indexAt (event.getPosition());
    if (index < 0 || (std::size_t) index >= owner.working.arrangement.size())
        return;

    owner.renameSelectedSection();
    owner.selectedPass = (std::size_t) index;

    // Choosing a pass also chooses the section it plays, so the chord editor
    // follows the arrangement instead of fighting it.
    const auto sectionIndex = owner.working.indexOf (owner.working.arrangement[(std::size_t) index].sectionId);
    if (sectionIndex != Song::npos)
    {
        owner.selectedSection = sectionIndex;
        owner.selectedSlot = juce::jlimit (0, juce::jmax (0, (int) owner.selectedProgression().count - 1),
                                           owner.selectedSlot);
    }

    owner.rebuildFromProcessor();
}

juce::Rectangle<int> TrackDraftAudioProcessorEditor::SlotStrip::boundsFor (int index) const
{
    const int gap = 8;
    const int total = juce::jmax (1, (int) owner.selectedProgression().count);
    const int width = (getWidth() - gap * (total - 1)) / total;
    return { index * (width + gap), 0, width, getHeight() };
}

void TrackDraftAudioProcessorEditor::SlotStrip::paint (juce::Graphics& g)
{
    // A slot only pulses when the section it belongs to is the one on screen.
    const auto soundingSection = owner.plugin.playingSection.load();
    const auto sounding = soundingSection == (int) owner.selectedSection
                              ? owner.plugin.playingSlot.load()
                              : -1;
    static const char* performanceLabels[] = { "", "strum", "pulse", "arp" };

    for (int i = 0; i < (int) owner.selectedProgression().count; ++i)
    {
        const auto area = boundsFor (i).toFloat().reduced (1.0f);
        const auto& slot = owner.selectedProgression().slots[(std::size_t) i];

        g.setColour (juce::Colour (0xff232323));
        g.fillRoundedRectangle (area, 6.0f);

        if (i == sounding)
        {
            g.setColour (accent.withAlpha (0.28f));
            g.fillRoundedRectangle (area, 6.0f);
        }

        g.setColour (i == owner.selectedSlot ? accent : panel);
        g.drawRoundedRectangle (area, 6.0f, i == owner.selectedSlot ? 2.0f : 1.0f);

        // Where the dragged slot would land.
        if (dragFrom >= 0 && i == dragTo && dragTo != dragFrom)
        {
            g.setColour (accent.withAlpha (0.5f));
            g.drawRoundedRectangle (area.reduced (2.0f), 5.0f, 2.0f);
        }

        g.setColour (ink);
        g.setFont (juce::Font (juce::FontOptions (18.0f)).boldened());
        g.drawText (theory::chordNameWithBass (slot.rootPc, slot.quality, slot.voicing),
                    area.reduced (4.0f, 12.0f), juce::Justification::centred);

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

int TrackDraftAudioProcessorEditor::SlotStrip::indexAt (juce::Point<int> position) const
{
    for (int i = 0; i < (int) owner.selectedProgression().count; ++i)
        if (boundsFor (i).contains (position))
            return i;

    return -1;
}

void TrackDraftAudioProcessorEditor::SlotStrip::mouseDown (const juce::MouseEvent& event)
{
    const int index = indexAt (event.getPosition());
    if (index < 0)
        return;

    owner.selectedSlot = index;
    dragFrom = index;
    dragTo = index;
    owner.rebuildFromProcessor();
}

void TrackDraftAudioProcessorEditor::SlotStrip::mouseDrag (const juce::MouseEvent& event)
{
    if (dragFrom < 0)
        return;

    // Reordering is a click-drag: the slot under the pointer is where the
    // dragged one will land, and the strip shows it before the drop.
    const int over = indexAt (event.getPosition());
    const int target = over >= 0 ? over : (event.getPosition().x < 0 ? 0
                                              : (int) owner.selectedProgression().count - 1);

    if (target != dragTo)
    {
        dragTo = juce::jlimit (0, (int) owner.selectedProgression().count - 1, target);
        repaint();
    }
}

void TrackDraftAudioProcessorEditor::SlotStrip::mouseUp (const juce::MouseEvent& event)
{
    const int from = dragFrom;
    const int to = dragTo;
    dragFrom = -1;
    dragTo = -1;

    if (from < 0 || to < 0 || from == to)
    {
        repaint();
        return;
    }

    owner.selectedProgression().moveSlot ((std::size_t) from, (std::size_t) to);
    owner.selectedSlot = to;
    owner.commit();
    owner.rebuildFromProcessor();
    juce::ignoreUnused (event);
}
} // namespace td
