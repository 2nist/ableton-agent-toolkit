#pragma once

#include "ChordTheory.h"

#include <array>
#include <vector>

namespace td
{
/**
    Played pitch classes -> a chord name.

    A port of `apps/trackdraft/src/lib/harmony/chordRecognition.ts`, keeping the
    same decisions so the plug-in names a chord the way the app does:

    - the lowest sounding note is evidence for the root;
    - a supplied key vocabulary is tried first, and a reading taken from it must
      explain every played note;
    - an omitted tone the quality can do without costs less than one that
      carries the quality;
    - the previous chord is a weak prior, so a held shape does not flicker;
    - inside the near-tie band, the reading with no unexplained note wins before
      the preference order does.

    Pure: no JUCE, no audio, no time.
*/
struct RecognizedChord
{
    bool valid = false;
    int rootPc = 0;
    theory::Quality quality = theory::Quality::maj;
    /** 0-1; 1 means every played note is a chord tone and the chord is complete. */
    double score = 0.0;
    std::vector<int> extras;
    std::vector<int> missing;
};

struct RecognizeOptions
{
    /** Pitch class of the lowest sounding note, when known. */
    int bassPc = -1;
    /** Qualities the current key permits; empty means "no preference". */
    std::vector<theory::Quality> permitted;
    /** The chord already sounding, as a stability prior. */
    bool hasPrevious = false;
    int previousRootPc = 0;
    theory::Quality previousQuality = theory::Quality::maj;
};

/** Names the chord, or returns an invalid result for fewer than two pitch classes. */
RecognizedChord recognizeChord (const std::vector<int>& pitchClasses,
                                const RecognizeOptions& options = {});

/** Same, from MIDI note numbers (what a keyboard actually sends). */
RecognizedChord recognizeChordFromNotes (const std::vector<int>& midiNotes,
                                         const RecognizeOptions& options = {});
} // namespace td
