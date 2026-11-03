#pragma once

#include "ChordTheory.h"

#include <array>
#include <string>

namespace td
{
/**
    The six neighbours of a degree, in the order the app's honeycomb walk uses.

    The app's grid gives each hex cell a degree by `(3q + r) mod 7`. Stepping one
    cell in its six axial directions therefore yields `d+3, d+4, d+1, d+6, d+2,
    d+5` — every other degree exactly once. That is the whole musical content of
    the honeycomb: from any degree, the six adjacent cells are all the remaining
    diatonic degrees, ordered by direction rather than by taste.

    This is a port of that arithmetic, not a re-invention: the same `DIRS` order
    as `apps/trackdraft/src/lib/harmony/honeycombWalk.ts`, so a walk built in the
    app and one built here list the same chords in the same order.
*/
struct WalkNeighbour
{
    int degree = 0;
    int rootOffset = 0;
    theory::Quality quality = theory::Quality::maj;
    /** Roman numeral label, e.g. "IV" or "ii7". */
    std::string label;
};

/** The six neighbours of `degree`, in DIRS order. */
std::array<WalkNeighbour, 6> neighboursOf (theory::Scale scale, int degree);

/** The neighbour that continues a walk from `degree`: the next one clockwise. */
WalkNeighbour nextAlongWalk (theory::Scale scale, int degree);
} // namespace td
