#pragma once

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

/** The knobs the scheduler needs; mirrors the automatable parameters. */
struct VoiceSettings
{
    int octave = 4;          // octave of the chord root, where 4 starts at middle C (60)
    int velocity = 100;      // 1-127
    double gate = 0.9;       // fraction of the slot a chord sounds for
    bool enabled = true;
};

/**
    Turns a progression plus the host's musical clock into MIDI note events.

    Kept free of AudioProcessor and of the audio device so the timing rules can
    be tested by feeding it a made-up transport — which is what TrackDraftTests
    does. The rules that matter:

    - every note that is switched on is switched off, even when the transport
      stops, loops, or the block ends mid-chord;
    - a chord starts exactly on its boundary, sample-accurate within the block;
    - the gate shortens the chord without ever leaving a note hanging into the
      next slot;
    - the progression loops on its own length, so a 4-chord, 16-beat cycle
      repeats at bar 5 without the host having to loop.

    Nothing here executes the target, reads files, or allocates per block beyond
    a small, reused buffer.
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
        @param progression    the chord cycle to play
        @param settings       octave / velocity / gate / enabled
        @param numSamples     block length, used to turn ppq offsets into samples
    */
    void process (juce::MidiBuffer& out,
                  const TransportSlice& transport,
                  const Progression& progression,
                  const VoiceSettings& settings,
                  int numSamples);

    /** Note numbers currently held by the generator (not pass-through notes). */
    std::vector<int> activeNotes() const;

private:
    struct Voice
    {
        int note = 0;
        int channel = 1;
        double endPpq = 0.0;
    };

    void stopAll (juce::MidiBuffer& out, int samplePosition);
    void startChord (juce::MidiBuffer& out, int samplePosition, int rootMidi,
                     theory::Quality quality, int velocity, double endPpq);

    std::vector<Voice> voices;
    bool wasPlaying = false;
    double lastPpq = 0.0;
};
} // namespace td
