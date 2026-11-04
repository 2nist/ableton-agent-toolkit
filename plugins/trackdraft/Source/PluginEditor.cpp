#include "PluginEditor.h"
#include "Import/ChordImport.h"
#include "PluginProcessor.h"
#include "Rhythm.h"

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

/** The shortest editor the layout makes sense at: the section bar and the slot
    strip, which is where an edit starts. A host is free to be taller. */
constexpr int minimumHeight = 380;

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

/** One place for the geometry: paint() and resized() both read EditorLayout.h,
    and TrackDraftTests checks that table. */
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

    // A value box sized for its widest value, so the increment buttons beside it
    // keep their width. The default 80-point box left them about ten points
    // each, and the "+" was clipped away.
    octaveSlider.setTextBoxStyle (juce::Slider::TextBoxLeft, false, 34, 22);
    velocitySlider.setTextBoxStyle (juce::Slider::TextBoxLeft, false, 34, 22);
    beatsSlider.setTextBoxStyle (juce::Slider::TextBoxLeft, false, 34, 22);
    paramSlider.setTextBoxStyle (juce::Slider::TextBoxLeft, false, 30, 22);
    bassVelocitySlider.setTextBoxStyle (juce::Slider::TextBoxLeft, false, 34, 22);
    gateSlider.setTextBoxStyle (juce::Slider::TextBoxRight, false, 52, 22);

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

            const int keyPc = workingKeyPc();
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
        const int keyPc = workingKeyPc();
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
                                            file, scale, workingKeyPc());

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
             &rhythmGrid, &clearRhythmButton, &rhythmSeedBox, &ownKeyButton,
             &strip, &presetBox, &presetNameEditor,
             &savePresetButton, &applyAllButton, &renamePresetButton, &deletePresetButton,
             &importButton, &sectionBar, &arrangementBar, &sectionNameEditor,
             &addSectionButton, &duplicateSectionButton, &deleteSectionButton,
             &moveSectionLeftButton, &moveSectionRightButton, &addPassButton,
             &moreRepeatsButton, &fewerRepeatsButton, &removePassButton, &saveSongButton,
             &sectionKeyBox, &sectionScaleBox })
        canvas.addAndMakeVisible (component);

    for (auto& button : neighbourButtons)
        canvas.addAndMakeVisible (button);

    //==== The song ========================================================
    sectionNameEditor.setTextToShowWhenEmpty ("Section name", inkMuted);
    sectionNameEditor.setColour (juce::TextEditor::backgroundColourId, panel);
    sectionNameEditor.setColour (juce::TextEditor::textColourId, ink);
    sectionNameEditor.setColour (juce::TextEditor::outlineColourId, well);
    sectionNameEditor.onReturnKey = [this] { renameSelectedSection(); };
    sectionNameEditor.onFocusLost = [this] { renameSelectedSection(); };

    ownKeyButton.setColour (juce::ToggleButton::textColourId, ink);
    ownKeyButton.setTooltip ("Give this section its own key and mode instead of the song's");
    ownKeyButton.onClick = [this] {
        auto& section = working.sections[selectedSection];
        if (ownKeyButton.getToggleState())
        {
            // Turning it on starts from what the section plays now, so the
            // music does not change key just because the box was ticked.
            section.hasKey = true;
            section.keyPc = workingKeyPc();
            section.hasScale = true;
            section.scale = workingScale();
        }
        else
        {
            section.hasKey = false;
            section.hasScale = false;
        }

        commit();
        rebuildFromProcessor();
    };

    sectionKeyBox.addItemList (keyNames(), 1);
    sectionScaleBox.addItemList (scaleNames(), 1);
    sectionKeyBox.setTooltip ("This section's key");
    sectionScaleBox.setTooltip ("This section's mode");

    sectionKeyBox.onChange = [this] {
        if (selectedSection >= working.sections.size())
            return;

        auto& section = working.sections[selectedSection];
        if (! section.modulates())
            return;

        section.hasKey = true;
        section.keyPc = juce::jlimit (0, 11, sectionKeyBox.getSelectedId() - 1);
        commit();
        rebuildFromProcessor();
    };

    sectionScaleBox.onChange = [this] {
        if (selectedSection >= working.sections.size())
            return;

        auto& section = working.sections[selectedSection];
        if (! section.modulates())
            return;

        section.hasScale = true;
        section.scale = (theory::Scale) juce::jlimit (0, (int) theory::Scale::locrian,
                                                      sectionScaleBox.getSelectedId() - 1);
        commit();
        rebuildFromProcessor();
    };

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
            working.keyAt (added, juce::jmax (0, keyBox.getSelectedId() - 1)),
            working.scaleAt (added, globalScale()), 4);
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

    rhythmSeedBox.setTextWhenNothingSelected ("Seed...");
    rhythmSeedBox.setTooltip ("Fill the grid from the same Euclidean rule the drum engine uses");
    for (int i = 0; i < (int) rhythmSeeds().size(); ++i)
        rhythmSeedBox.addItem (rhythmSeeds()[(std::size_t) i].name, i + 1);

    rhythmSeedBox.onChange = [this] {
        const int id = rhythmSeedBox.getSelectedId();
        rhythmSeedBox.setSelectedId (0, juce::dontSendNotification);
        if (id <= 0 || (std::size_t) (id - 1) >= rhythmSeeds().size())
            return;

        const auto& seed = rhythmSeeds()[(std::size_t) (id - 1)];
        auto& rhythm = selectedProgression().slots[(std::size_t) selectedSlot].rhythm;

        // A seed fills the bar in front of you: twelve sixteenths in a section
        // in 3/4, sixteen in 4/4. Length first, then the seed onto it.
        if (! rhythm.enabled)
            rhythm.length = (std::size_t) rhythmGrid.barSteps();

        seedPattern (rhythm, seed.k, seed.n, seed.rotation);
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
                       &bassOctaveBox, &bassMotionBox, &bassRhythmBox, &rhythmSeedBox,
                       &sectionKeyBox, &sectionScaleBox })
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

    // Everything lives on the canvas; the editor is only the window onto it.
    viewport.setViewedComponent (&canvas, false);
    viewport.setScrollBarsShown (true, false);
    addAndMakeVisible (viewport);
    canvas.setSize (layout::editorWidth, layout::height);

    // The width is the design's and the height is capped by it, so a host that
    // remembers a taller window cannot leave empty space around the layout.
    setResizeLimits (layout::editorWidth, minimumHeight, layout::editorWidth, layout::height);
    setResizable (true, false);

    // Open at the design height when the screen can show it, and at what the
    // screen can show otherwise — the viewport scrolls the rest. The chrome
    // allowance is the standalone's own header and title bar; a host adds its
    // own, which is why the constrainer, not this number, is the real limit.
    int usableHeight = layout::height;

    if (const auto* display = juce::Desktop::getInstance().getDisplays().getPrimaryDisplay())
        usableHeight = juce::jmin (usableHeight, (int) display->userBounds.getHeight() - 40);

    setSize (layout::editorWidth, juce::jmax (minimumHeight, usableHeight));
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

    const auto& section = working.sections[selectedSection];
    sectionNameEditor.setText (section.name, juce::dontSendNotification);

    // A section that does not modulate shows the song's key, greyed, so the
    // boxes are a readout until "Own key" is ticked.
    ownKeyButton.setToggleState (section.modulates(), juce::dontSendNotification);
    sectionKeyBox.setSelectedId (
        section.hasKey ? section.keyPc + 1 : juce::jmax (0, keyBox.getSelectedId() - 1) + 1,
        juce::dontSendNotification);
    sectionScaleBox.setSelectedId (
        section.hasScale ? (int) section.scale + 1
                         : (int) globalScale() + 1,
        juce::dontSendNotification);
    sectionKeyBox.setEnabled (section.modulates());
    sectionScaleBox.setEnabled (section.modulates());

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

    // One repaint for the whole canvas: the strip lights the selected slot, the
    // grid draws its pattern, and the articulation's label says what its number
    // counts. All three read state that has just changed, and the two custom
    // components do not repaint themselves when it does.
    canvas.repaint();

    // The grid follows the transport while the section it belongs to is the one
    // on screen; elsewhere the cursor is meaningless.
    const auto playingSection = plugin.playingSection.load();
    rhythmGrid.setCursor (playingSection == (int) selectedSection ? plugin.playingStep.load() : -1);
}

theory::Scale TrackDraftAudioProcessorEditor::globalScale() const
{
    return (theory::Scale) juce::jlimit (0, (int) theory::Scale::locrian,
                                         juce::jmax (0, scaleBox.getSelectedId() - 1));
}

theory::Scale TrackDraftAudioProcessorEditor::workingScale() const
{
    // A region inside the section beats the section's own mode, which beats the
    // song's — so the walk and the borrowings follow the modulation as the
    // selection moves along the chords.
    if (selectedSection < working.sections.size())
    {
        const auto& progression = working.sections[selectedSection].progression;
        if (const auto* region = progression.regionAtSlot ((std::size_t) selectedSlot))
            return region->scale;
    }

    return working.scaleAt (selectedSection, globalScale());
}

int TrackDraftAudioProcessorEditor::workingKeyPc() const
{
    if (selectedSection < working.sections.size())
    {
        const auto& progression = working.sections[selectedSection].progression;
        if (const auto* region = progression.regionAtSlot ((std::size_t) selectedSlot))
            return region->keyPc;
    }

    return working.keyAt (selectedSection, juce::jmax (0, keyBox.getSelectedId() - 1));
}

int TrackDraftAudioProcessorEditor::workingDegree() const
{
    if (selectedSlot >= (int) selectedProgression().count)
        return 0;

    // The slot stores an absolute pitch class; the walk works in degrees, so
    // map it back through the key. A borrowed chord has no degree and falls
    // back to its position, which keeps the walk usable in a chromatic passage.
    const int keyPc = workingKeyPc();
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
    const int keyPc = workingKeyPc();

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

void TrackDraftAudioProcessorEditor::Canvas::paint (juce::Graphics& g)
{
    owner.paintCanvas (g);
}

void TrackDraftAudioProcessorEditor::paint (juce::Graphics& g)
{
    // The canvas covers this whenever the host gives the editor its design
    // height; this only shows in the strip a taller host leaves behind.
    g.fillAll (background);
}

void TrackDraftAudioProcessorEditor::Canvas::resized()
{
    owner.layoutCanvas();
}

namespace
{
juce::Rectangle<int> toJuce (layout::Rect r)
{
    return { r.x, r.y, r.width, r.height };
}
} // namespace

void TrackDraftAudioProcessorEditor::paintCanvas (juce::Graphics& g)
{
    g.fillAll (background);

    g.setColour (accent);
    g.setFont (juce::Font (juce::FontOptions (20.0f)).boldened());
    g.drawText ("TrackDraft Harmony", toJuce (layout::title), juce::Justification::centredLeft);

    g.setColour (inkMuted);
    g.setFont (juce::Font (juce::FontOptions (12.0f)));
    g.drawText ("MIDI generator - notes go to the track's own instrument",
                toJuce (layout::subtitle), juce::Justification::centredLeft);

    g.drawText ("Sections (" + juce::String ((int) working.sections.size()) + ")",
                toJuce (layout::sectionsLabel), juce::Justification::centredLeft);

    // Every column says what its control is: the numbers in the voice row own
    // nothing else that would tell you whether they are octaves or velocities.
    const auto label = [&g] (const char* text, layout::Rect area, juce::Justification just)
    { g.drawText (text, toJuce (area), just); };

    label ("Key", layout::keyLabel, juce::Justification::centredLeft);
    label ("Scale", layout::scaleLabel, juce::Justification::centredLeft);
    label ("Root", layout::rootLabel, juce::Justification::centredLeft);
    label ("Quality", layout::qualityLabel, juce::Justification::centredLeft);
    label ("Beats", layout::beatsLabel, juce::Justification::centredLeft);

    label ("Rhythm - click a step: off, normal, accent, ghost. "
           "The articulation plays each hit.",
           layout::rhythmLabel, juce::Justification::centredLeft);
    label ("Walk from the selected chord (hex neighbours)", layout::walkLabel,
           juce::Justification::centredLeft);

    label ("Articulation", layout::articulationLabel, juce::Justification::centredLeft);
    label ("Inversion / spread", layout::inversionLabel, juce::Justification::centredLeft);
    label ("Presets", layout::presetsLabel, juce::Justification::centredLeft);
    label ("Arrangement", layout::arrangementLabel, juce::Justification::centredLeft);
    label ("Bass line for this section", layout::bassLabel, juce::Justification::centredLeft);

    // The voice row's own column headings, in line with their controls.
    label ("Octave", layout::octaveLabel, juce::Justification::centredLeft);
    label ("Velocity", layout::velocityLabel, juce::Justification::centredLeft);
    label ("Gate", layout::gateLabel, juce::Justification::centredLeft);
    label ("Velocity", layout::bassVelocityLabel, juce::Justification::centredLeft);

    // What the articulation's number means: a strum counts milliseconds, a pulse
    // hits, an arp steps, and a block has nothing to count. "4" on its own says
    // none of that.
    static const char* amountNames[] = { "n/a", "Spread ms", "Hits", "Steps" };
    const auto& slot = selectedProgression().slots[(std::size_t) selectedSlot];
    label (amountNames[(int) slot.performance], layout::amountLabel,
           juce::Justification::centredLeft);

    // What the arrangement adds up to, so the form can be read at a glance.
    g.setColour (accent.withAlpha (0.85f));
    const auto songBars = working.totalBeats() / 4.0;
    const bool wholeBars = std::abs (songBars - std::round (songBars)) < 1e-6;
    g.drawText (juce::String (songBars, wholeBars ? 0 : 1) + " bars",
                toJuce (layout::arrangementLength), juce::Justification::centredRight);
}

void TrackDraftAudioProcessorEditor::resized()
{
    viewport.setBounds (getLocalBounds());

    // The canvas keeps its design size whatever the host gives us: the viewport
    // is what absorbs a window that is shorter than the design.
    if (canvas.getWidth() != layout::editorWidth || canvas.getHeight() != layout::height)
        canvas.setSize (layout::editorWidth, layout::height);
}

void TrackDraftAudioProcessorEditor::layoutCanvas()
{
    const auto place = [] (juce::Component& component, layout::Rect area)
    {
        component.setBounds (area.x, area.y, area.width, area.height);
    };

    // The song: the bar chooses a section, the row under it names and moves one.
    place (sectionBar, layout::sectionBar);
    place (sectionNameEditor, layout::sectionName);
    place (addSectionButton, layout::addSection);
    place (duplicateSectionButton, layout::duplicateSection);
    place (deleteSectionButton, layout::deleteSection);
    place (moveSectionLeftButton, layout::moveSectionLeft);
    place (moveSectionRightButton, layout::moveSectionRight);
    place (ownKeyButton, layout::ownKey);
    place (sectionKeyBox, layout::sectionKey);
    place (sectionScaleBox, layout::sectionScale);

    place (keyBox, layout::key);
    place (scaleBox, layout::scale);
    place (rootBox, layout::root);
    place (qualityBox, layout::quality);
    place (seedButton, layout::seedFromKey);
    place (beatsSlider, layout::beats);

    place (strip, layout::strip);

    place (rhythmGrid, layout::rhythmGrid);
    place (rhythmSeedBox, layout::rhythmSeed);
    place (clearRhythmButton, layout::clearRhythm);

    for (int i = 0; i < 6; ++i)
        place (neighbourButtons[(std::size_t) i], layout::neighbourButton (i));

    place (borrowedBox, layout::borrowed);
    place (detectButton, layout::detectMidi);
    place (useHeardButton, layout::useHeard);
    place (heardLabel, layout::status);

    place (performanceBox, layout::performance);
    place (paramSlider, layout::amount);
    place (directionBox, layout::direction);
    place (previewButton, layout::preview);
    place (inversionBox, layout::inversion);
    place (spreadBox, layout::spread);
    place (applyAllButton, layout::applyFeel);

    place (octaveSlider, layout::octave);
    place (velocitySlider, layout::velocity);
    place (gateSlider, layout::gate);
    place (generateButton, layout::emitNotes);

    place (presetBox, layout::presetBox);
    place (presetNameEditor, layout::presetName);
    place (savePresetButton, layout::savePreset);
    place (renamePresetButton, layout::renamePreset);
    place (deletePresetButton, layout::deletePreset);
    place (importButton, layout::importPreset);

    place (arrangementBar, layout::arrangementBar);
    place (addPassButton, layout::addPass);
    place (moreRepeatsButton, layout::moreRepeats);
    place (fewerRepeatsButton, layout::fewerRepeats);
    place (removePassButton, layout::removePass);
    place (saveSongButton, layout::saveSong);

    place (bassButton, layout::bassToggle);
    place (bassOctaveBox, layout::bassOctave);
    place (bassMotionBox, layout::bassMotion);
    place (bassRhythmBox, layout::bassRhythm);
    place (bassVelocitySlider, layout::bassVelocity);
}

int TrackDraftAudioProcessorEditor::RhythmGrid::barSteps() const
{
    const auto& slot = owner.selectedProgression().slots[(std::size_t) owner.selectedSlot];

    // A pattern says how long its bar is. With no pattern the grid is drawn
    // against the bar the slot starts in, so the cells a click would fill are
    // the cells of *that* bar rather than an assumed 4/4.
    const int steps = slot.rhythm.enabled
                          ? (int) slot.rhythm.length
                          : (int) std::lround (owner.selectedProgression().barBeatsAtSlot (
                                                   (std::size_t) owner.selectedSlot)
                                               * (double) RhythmPattern::stepsPerBeat);

    return juce::jlimit (1, (int) RhythmPattern::maxSteps, steps);
}

juce::Rectangle<int> TrackDraftAudioProcessorEditor::RhythmGrid::boundsFor (int step) const
{
    const int gap = 3;
    const int beatGap = 4;
    const int total = barSteps();
    const int beats = (total - 1) / RhythmPattern::stepsPerBeat;

    // The beat gaps come out of the width before the cells are divided, so the
    // last cell ends inside the control. Dividing first and adding the gaps
    // afterwards pushed it past the right edge, where it was clipped.
    const int width = juce::jmax (8, (getWidth() - gap * (total - 1) - beatGap * beats) / total);

    // Every fourth cell is a beat, so the gaps there are visible.
    const int beatsBefore = step / RhythmPattern::stepsPerBeat;
    return { step * (width + gap) + beatsBefore * beatGap, 0, width, getHeight() };
}

int TrackDraftAudioProcessorEditor::RhythmGrid::stepAt (juce::Point<int> position) const
{
    for (int step = 0; step < barSteps(); ++step)
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

    for (int step = 0; step < barSteps(); ++step)
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
    // rhythm; after that it cycles off → normal → accent → ghost. The new
    // pattern takes its length from the bar it was drawn in, which is what
    // makes the next twelve clicks a 3/4 groove rather than a truncated 4/4 one.
    if (! pattern.enabled)
    {
        pattern = {};
        pattern.length = (std::size_t) barSteps();
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
