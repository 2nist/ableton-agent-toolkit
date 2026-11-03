#pragma once

#include "Theory/ChordTheory.h"

#include <array>
#include <cmath>
#include <cstddef>

namespace td
{
/** One slot of the progression: what to play, and for how many beats. */
struct ChordSlot
{
    int rootPc = 0;
    theory::Quality quality = theory::Quality::maj;
    double beats = 4.0;

    bool operator== (const ChordSlot& other) const noexcept
    {
        return rootPc == other.rootPc && quality == other.quality
               && std::abs (beats - other.beats) < 1e-9;
    }
};

/**
    The progression the plugin plays, as plain data.

    Deliberately not a JUCE model object: the editor edits a copy, the processor
    owns the live one, and the state is written as XML. Length is fixed at
    `maxSlots` so a saved session always round-trips — a shorter progression is
    expressed by the sum of its `beats`, not by a shorter array.
*/
struct Progression
{
    static constexpr std::size_t maxSlots = 8;

    std::array<ChordSlot, maxSlots> slots {};
    std::size_t count = 4;

    /** Total beats in one pass of the progression. */
    double lengthInBeats() const noexcept;

    /** Beat offset at which slot `index` starts. */
    double startBeatOf (std::size_t index) const noexcept;

    /** Slot sounding at `beat` (position inside the loop), or the last one. */
    std::size_t slotAtBeat (double beat) const noexcept;

    /** Fills `count` slots with the diatonic chords of `scale` in `keyPc`. */
    void seedFromScale (int keyPc, theory::Scale scale, std::size_t slotCount = 4);
};
} // namespace td
