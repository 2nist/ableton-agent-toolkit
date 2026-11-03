#pragma once

#include "Performance.h"
#include "Progression.h"

#include <juce_audio_basics/juce_audio_basics.h>

#include <vector>

namespace td
{
/** What the host told us about this block. */
struct TransportSlice
{
    bool playing = false;
    /** Position at the START of the block, in quarter notes since the start. */
    double ppqStart = 0.0;
    /** Position at the END of the block. */
    double ppqEnd = 0.0;
};

/** The automatable knobs the scheduler needs. */
struct VoiceSettings
{
    int octave = 4;      // octave of the chord root, where 4 starts at middle C (60)
    int velocity = 100;  // 1-127
    double gate = 0.9;   // fraction of the slot a plain chord sounds for
    bool enabled = true;
};

/**
    Turns a chord cycle plus the host's musical clock into MIDI note events.

    Kept free of AudioProcessor and of the audio device so the timing rules can
    be tested by feeding it a made-up transport — which is what TrackDraftTests
    does. The rules that matter:

    - every note that is switched on is switched off, even when the transport
      stops, loops, or the block ends mid-chord;
    - a chord starts exactly on its boundary, sample-accurate within the block;
    - articulation (strum, pulse, arp) is scheduled on the same clock rather than
      approximated per block, so a strum spread stays even at any tempo;
    - the gate shortens the chord without ever leaving a note hanging into the
      next slot;
    - the cycle loops on its own length, so a 4-chord, 16-beat progression
      repeats at bar 5 without the host having to loop, and a whole song
      repeats its form once the last pass ends.

    Nothing here executes the target, reads files, or allocates per block beyond
    reused buffers.
*/
class ChordScheduler
{
public:
    /** Clears state and emits note-offs for anything sounding. */
    void reset (juce::MidiBuffer& out, int sampleOffsetToUse = 0);

    /**
        Appends this block's note events.

        @param out            buffer the host will send on (also used for pass-through by the caller)
        @param transport      block position from the playhead
        @param cycle          the chord cycle to play — a section's progression, or a
                              whole song flattened to absolute song positions
        @param settings       octave / velocity / gate / enabled
        @param numSamples     block length, used to turn ppq offsets into samples
    */
    void process (juce::MidiBuffer& out,
                  const TransportSlice& transport,
                  const ChordCycle& cycle,
                  const VoiceSettings& settings,
                  int numSamples);

    /**
        Plays one slot immediately, regardless of the transport: the "hear what
        this chord is" button. Notes stop on their own after ~0.6 s.
    */
    void audition (juce::MidiBuffer& out,
                   const ChordSlot& slot,
                   const VoiceSettings& settings,
                   int numSamples,
                   double sampleRate);

    /** Note numbers currently held by the generator (not pass-through notes). */
    std::vector<int> activeNotes() const;

private:
    struct Voice
    {
        int note = 0;
        int channel = 1;
        double endPpq = 0.0;
    };

    struct Pending
    {
        double ppq = 0.0;
        int note = 0;
        int velocity = 100;
        double durationBeats = 0.0;
    };

    void stopGenerated (juce::MidiBuffer& out, int samplePosition);
    void stopAudition (juce::MidiBuffer& out, int samplePosition);
    void scheduleChord (double atPpq, const ChordSlot& slot, const VoiceSettings& settings);
    /** The section's bass voice under one slot: root/fifth/walking, on the
        section's own rhythm. Silent unless the section asked for it. */
    void scheduleBass (double atPpq, const ChordCycle& cycle, std::size_t slotIndex);
    void emitPending (juce::MidiBuffer& out, double upToPpqInclusive, double ppqStart,
                      double ppqEnd, int numSamples);
    void retireVoices (juce::MidiBuffer& out, double upToPpqInclusive, double ppqStart,
                       double ppqEnd, int numSamples);

    std::vector<Voice> voices;
    std::vector<Pending> pending;

    // Audition is sample-counted rather than ppq-counted, so it works with a
    // stopped transport too.
    std::vector<std::pair<int, int>> auditionVoices;  // (channel, note)
    int auditionSamplesLeft = 0;

    bool wasPlaying = false;
    double lastPpq = 0.0;
};
} // namespace td
