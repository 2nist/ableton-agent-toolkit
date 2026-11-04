#pragma once

#include "ChordScheduler.h"
#include "CycleBuffers.h"
#include "Song.h"
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

    /** Snapshot of the live song, for the editor's first paint. */
    Song getSong() const;
    /** Replace the song (the editor edits a local copy and commits). */
    void setSong (const Song& next);

    /** Where a song position falls, for the editor's readout. */
    Song::Position positionAtBeat (double beat) const;

    juce::ChangeBroadcaster& progressionChanged() noexcept { return progressionBroadcaster; }

    //==== MIDI detection ===================================================
    /** Arm/disarm listening to the notes the host sends this plug-in. */
    void setDetectionArmed (bool shouldListen);
    bool isDetectionArmed() const noexcept { return detectionArmed.load(); }

    /** The chord under the player's fingers, as last recognised. */
    RecognizedChord getHeardChord() const;

    /** Writes the currently heard chord into a slot of a section; false when
        nothing is heard. */
    bool writeHeardChordToSlot (std::size_t section, std::size_t slot);

    /** Plays one slot now, for the "hear this chord" button. */
    void auditionSlot (std::size_t section, std::size_t slot);
    void auditionChord (int rootPc, theory::Quality quality);

    /** Called by the editor to repaint when the transport moves the chord on. */
    std::atomic<int> playingSection { -1 };
    std::atomic<int> playingSlot { -1 };
    std::atomic<int> playingPass { -1 };
    /** Sixteenth within the slot's rhythm grid, or -1 when nothing plays. */
    std::atomic<int> playingStep { -1 };

    std::atomic<bool> detectionArmed { false };
    /** -1 = nothing queued; otherwise the pitch class to audition. */
    std::atomic<int> auditionRoot { -1 };
    std::atomic<int> auditionQuality { 0 };

private:
    juce::AudioProcessorValueTreeState::ParameterLayout makeLayout();
    /** The song's mode, from the Scale parameter: the fallback for a section
        that does not modulate. */
    theory::Scale scaleFromParameters() const;

    juce::AudioProcessorValueTreeState apvts;
    juce::ChangeBroadcaster progressionBroadcaster;

    /** Guards `song` between the threads that edit, copy and save it. The audio
        thread does not take it: it reads a published cycle instead. */
    mutable juce::CriticalSection progressionLock;
    Song song;

    /** The song flattened for the audio thread. The message thread rebuilds an
        unused buffer and publishes it; the callback reads the published one
        without a lock. */
    CycleBuffers cycles;

    ChordScheduler scheduler;
    juce::MidiBuffer passThrough;

    // Detection state. Fixed size and allocation-free: processBlock may not
    // allocate, and a note number is 0-127.
    std::array<bool, 128> heldNotes {};
    std::atomic<int> heardRoot { -1 };
    std::atomic<int> heardQuality { 0 };
    /** `scale` is the playing section's mode, so a modulating song is named
        with its own vocabulary rather than the song key's. */
    void updateDetection (const juce::MidiBuffer& incoming, theory::Scale scale);

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR (TrackDraftAudioProcessor)
};
} // namespace td
