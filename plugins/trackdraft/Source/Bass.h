#pragma once

#include "Progression.h"

#include <vector>

namespace td
{
/** One bass note, positioned inside the chord it plays under. */
struct BassNote
{
    double offsetBeats = 0.0;
    int note = 0;
    int velocity = 100;
    double durationBeats = 0.0;
};

/**
    The bass voice for one chord's span — a port of the app's `planSectionBass`
    (`packages/drum-library/src/bass.ts`), rule for rule:

    - `locked` sounds once, `half` twice, `eighth` four times across the span;
    - `rootFifth` alternates the root with the fifth on odd subdivisions;
    - `walking` puts a leading tone (one semitone below the next chord) on the
      last subdivision, but only when the next chord is a different one and the
      span is actually subdivided — a held root otherwise.

    Two deliberate differences, both because the plug-in has more context than
    the planner it was ported from:

    - the pitch it plays under is the chord's **bass** tone, not its root, so a
      `C/E` keeps its E underneath. For root-position chords — the default, and
      everything the app's bass generator was written for — the two are the same
      note, so the port is faithful where it can be checked;
    - "the next chord" is the next slot of the whole song, not of one section, so
      a walking line leads into the next section as readily as into the next bar.

    `nextBassPc` is -1 when there is no next chord.
*/
std::vector<BassNote> planBass (const BassLine& line, int bassPc, int nextBassPc,
                               double spanBeats);
} // namespace td
