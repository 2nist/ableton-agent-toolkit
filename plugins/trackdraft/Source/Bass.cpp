#include "Bass.h"

#include <algorithm>
#include <cmath>

namespace td
{
namespace
{
int subdivisionsOf (BassRhythm rhythm)
{
    switch (rhythm)
    {
        case BassRhythm::locked: return 1;
        case BassRhythm::half: return 2;
        case BassRhythm::eighth: return 4;
    }

    return 1;
}

/** One semitone below the target: the classic walk-up into the next root. */
int approachPc (int targetPc)
{
    return ((targetPc - 1) % 12 + 12) % 12;
}
} // namespace

std::vector<BassNote> planBass (const BassLine& line, int bassPc, int nextBassPc,
                               double spanBeats)
{
    std::vector<BassNote> notes;
    if (! line.enabled)
        return notes;

    const double span = std::max (0.0, spanBeats);
    if (span <= 0.0)
        return notes;

    const int subdivisions = subdivisionsOf (line.rhythm);
    const double each = span / (double) subdivisions;
    const int velocity = std::clamp (line.velocity, 1, 127);
    const int base = line.octave * 12;

    for (int step = 0; step < subdivisions; ++step)
    {
        int pitchClass = ((bassPc % 12) + 12) % 12;

        if (line.motion == BassMotion::rootFifth && step % 2 == 1)
        {
            pitchClass = (pitchClass + 7) % 12;
        }
        else if (line.motion == BassMotion::walking && subdivisions > 1
                 && step == subdivisions - 1 && nextBassPc >= 0
                 && nextBassPc % 12 != pitchClass)
        {
            pitchClass = approachPc (nextBassPc);
        }

        const int note = base + pitchClass;
        if (note >= 0 && note <= 127)
            notes.push_back ({ (double) step * each, note, velocity, each });
    }

    return notes;
}
} // namespace td
