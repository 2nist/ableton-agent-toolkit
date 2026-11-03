#pragma once

#include "ChordScheduler.h"
#include "Progression.h"
#include "Theory/ChordRecognition.h"

#include <juce_audio_processors/juce_audio_processors.h>

#include <array>

namespace td
{
/**
    TrackDraft Harmony — a MIDI generator.

    It creates no audio and hosts no instrument: it turns the progression the
    editor shows into MIDI note events on the host's timeline, so the notes
    play whatever instrument the track already has. That is why it declares
    itself a MIDI effect (`isMidiEffect()`), which is also what makes the AU
    build an `aumi` MIDI processor rather than an audio unit.

    Live does not route MIDI out of plug-ins; hosts that do — REAPER, Bitwig,
    Cubase, Studio One — are where this is meant to run.
*/
class TrackDraftAudioProcessor final : public juce::AudioProcessor
{
public:
    TrackDraftAudioProcessor();
    ~TrackDraftAudioProcessor() override;

    //==== AudioProcessor ====================================================
    void prepareToPlay (double sampleRate, int samplesPerBlock) override;
    void releaseResources() override;
    bool isBusesLayoutSupported (const BusesLayout& layouts) const override;
    void processBlock (juce::AudioBuffer<float>&, juce::MidiBuffer&) override;

    juce::AudioProcessorEditor* createEditor() override;
    bool hasEditor() const override { return true; }

    const juce::String getName() const override { return "TrackDraft Harmony"; }
    bool acceptsMidi() const override { return true; }
    bool producesMidi() const override { return true; }
    bool isMidiEffect() const override { return true; }
    double getTailLengthSeconds() const override { return 0.0; }

    int getNumPrograms() override { return 1; }
    int getCurrentProgram() override { return 0; }
    void setCurrentProgram (int) override {}
    const juce::String getProgramName (int) override { return "Default"; }
    void changeProgramName (int, const juce::String&) override {}

    void getStateInformation (juce::MemoryBlock& destData) override;
    void setStateInformation (const void* data, int sizeInBytes) override;

    //==== Editor-facing surface ============================================
    juce::AudioProcessorValueTreeState& parameters() noexcept { return apvts; }

    /** Snapshot of the live progression, for the editor's first paint. */
    Progression getProgression() const;
    /** Replace the progression (the editor edits a local copy and commits). */
    void setProgression (const Progression& next);

    /** The chord sounding at a beat position, for the editor's readout. */
    ChordSlot slotAtBeat (double beat) const;

    juce::ChangeBroadcaster& progressionChanged() noexcept { return progressionBroadcaster; }

    //==== MIDI detection ===================================================
    /** Arm/disarm listening to the notes the host sends this plug-in. */
    void setDetectionArmed (bool shouldListen);
    bool isDetectionArmed() const noexcept { return detectionArmed.load(); }

    /** The chord under the player's fingers, as last recognised. */
    RecognizedChord getHeardChord() const;

    /** Writes the currently heard chord into `slot`; false when nothing is heard. */
    bool writeHeardChordToSlot (std::size_t slot);

    /** Called by the editor to repaint when the transport moves the chord on. */
    std::atomic<int> playingSlot { -1 };

    std::atomic<bool> detectionArmed { false };

private:
    juce::AudioProcessorValueTreeState::ParameterLayout makeLayout();

    juce::AudioProcessorValueTreeState apvts;
    juce::ChangeBroadcaster progressionBroadcaster;

    mutable juce::CriticalSection progressionLock;
    Progression progression;

    ChordScheduler scheduler;
    juce::MidiBuffer passThrough;

    // Detection state. Fixed size and allocation-free: processBlock may not
    // allocate, and a note number is 0-127.
    std::array<bool, 128> heldNotes {};
    std::atomic<int> heardRoot { -1 };
    std::atomic<int> heardQuality { 0 };
    void updateDetection (const juce::MidiBuffer& incoming);

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR (TrackDraftAudioProcessor)
};
} // namespace td
