#pragma once

#include "../Progression.h"

#include <juce_core/juce_core.h>

namespace td
{
/**
    Import a progression from an annotation file.

    Two sources, both MIR-standard rather than invented:

    - **MIDI** (`.mid`, `.midi`): notes are collected per bar and recognised with
      the same scorer the rest of the plug-in uses, which is the app's
      `parsers/parseMidi.ts` approach — bar windows, a previous-chord prior, and
      consecutive repeats merged.
    - **JSON** (`.json`): a JAMS annotation (the container ChordMini/McGill/
      Isophonics exports use), a plain `{ chords: [...] }` array, or a bare array
      of `{ time, chord }` / `[time, label]` entries. Labels are parsed as Harte
      syntax — `C:maj7`, `A:min/3`, `N` — which is what every MIR chord corpus
      writes.

    Anything the progression model cannot express (parenthesised tensions, slash
    bass, `N`) is simplified rather than dropped, and the simplifications are
    counted into `message` so the caller can show them.
*/
struct ImportedProgression
{
    bool ok = false;
    Progression progression;
    /** What was imported, and what had to be simplified. */
    juce::String message;
};

/** Reads `file`, choosing the reader from its extension. */
ImportedProgression importProgressionFromFile (const juce::File& file, theory::Scale scale,
                                               int keyPc);

/** Harte chord label to root + quality. Returns false for `N`/empty/unreadable. */
bool parseChordLabel (const juce::String& label, int& rootPc, theory::Quality& quality);

/** Bar-window recognition over a MIDI file. Exposed for tests. */
ImportedProgression importProgressionFromMidi (const juce::File& file, theory::Scale scale,
                                               int keyPc);

/** JAMS / plain chord JSON. Exposed for tests. */
ImportedProgression importProgressionFromJson (const juce::File& file, theory::Scale scale,
                                               int keyPc);
} // namespace td
