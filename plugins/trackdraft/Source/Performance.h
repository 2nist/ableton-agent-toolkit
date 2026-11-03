#pragma once

#include "Theory/ChordTheory.h"

#include <vector>

namespace td
{
/** How a slot's chord is articulated. Mirrors the app's ChordPerformanceEffect. */
enum class Performance
{
    block = 0,  // the whole chord at once
    strum = 1,  // staggered low to high, like a guitar
    pulse = 2,  // re-struck on a subdivision
    arp = 3,    // one tone at a time
};

/** One note of an articulated chord, in beats from the chord's start. */
struct PerformanceEvent
{
    double offsetBeats = 0.0;
    int note = 0;
    int velocity = 100;
    double durationBeats = 1.0;
};

struct PerformanceSettings
{
    Performance kind = Performance::block;
    /** Strum: spread in milliseconds. Pulse/arp: subdivisions across the slot. */
    int param = 0;
    /** Arp only: 0 = up, 1 = down, 2 = up-down. */
    int direction = 2;
    /** Fraction of the slot a plain chord sounds for, before articulation. */
    double gate = 0.9;
};

/**
    Builds the note events for one slot.

    A port of `packages/music-theory/src/performance.ts`, keeping its numbers so
    a strum authored in the app and one played here spread the same way:

    - strum converts milliseconds at 120 bpm (`ms / 1000 * 2` beats), so the
      150 ms default is the 0.3-beat spread the app documents;
    - pulse divides the slot into equal hits at half duty;
    - arp walks the chord tones at the same subdivision, up, down, or up-down.

    Pure: no clock, no host, no allocation beyond the returned vector.
*/
std::vector<PerformanceEvent> shapeChord (int rootMidi,
                                          theory::Quality quality,
                                          double slotBeats,
                                          int velocity,
                                          const PerformanceSettings& settings);
} // namespace td
