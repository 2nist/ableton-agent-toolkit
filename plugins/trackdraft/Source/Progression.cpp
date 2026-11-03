#include "Progression.h"

#include <algorithm>
#include <set>
#include <utility>

namespace td
{
double Progression::lengthInBeats() const noexcept
{
    double total = 0.0;
    for (std::size_t i = 0; i < count; ++i)
        total += std::max (0.0, slots[i].beats);
    return total;
}

double Progression::startBeatOf (std::size_t index) const noexcept
{
    double start = 0.0;
    for (std::size_t i = 0; i < index && i < count; ++i)
        start += std::max (0.0, slots[i].beats);
    return start;
}

std::size_t Progression::slotAtBeat (double beat) const noexcept
{
    if (count == 0)
        return 0;

    double cursor = 0.0;
    for (std::size_t i = 0; i < count; ++i)
    {
        cursor += std::max (0.0, slots[i].beats);
        if (beat < cursor)
            return i;
    }
    return count - 1;
}

void Progression::seedFromScale (int keyPc, theory::Scale scale, std::size_t slotCount)
{
    count = std::clamp<std::size_t> (slotCount, 1, maxSlots);

    for (std::size_t i = 0; i < count; ++i)
    {
        // One rule for "the chord on this degree", shared with the walk
        // suggestions, so seeding and stepping can never disagree.
        const auto chord = theory::diatonicChordAt (scale, (int) i);
        slots[i] = { ((keyPc + chord.rootOffset) % 12 + 12) % 12, chord.quality, 4.0 };
    }
}
std::vector<Progression::Borrowed> Progression::borrowedChords (theory::Scale scale,
                                                               bool includeEveryMode)
{
    // Borrowing is chord-level, and at the triad: what a songwriter reaches for
    // is "the bIII", not "Ebmaj7 because Aeolian's third degree is a seventh".
    // Filtering on quality alone would be wrong too — every mode uses the same
    // handful of qualities, so "the quality is new" finds nothing.
    const auto present = [scale] (int rootOffset, theory::Quality quality)
    {
        for (int degree = 0; degree < 7; ++degree)
        {
            const auto chord = theory::diatonicChordAt (scale, degree);
            if (chord.rootOffset == rootOffset && theory::triadOf (chord.quality) == quality)
                return true;
        }
        return false;
    };

    std::vector<Borrowed> found;
    std::set<std::pair<int, int>> seen;

    const auto parallel = parallelModeOf (scale);

    for (int mode = 0; mode <= (int) theory::Scale::locrian; ++mode)
    {
        const auto other = (theory::Scale) mode;
        if (other == scale)
            continue;

        // Mixture is borrowed from the parallel mode, not from whichever mode
        // happens to share the tonic: every mode's chords would offer ~20
        // exotic borrowings nobody asked for. The full set stays available for
        // callers that want to browse it.
        if (! includeEveryMode && other != parallel)
            continue;

        for (int degree = 0; degree < 7; ++degree)
        {
            const auto chord = theory::diatonicChordAt (other, degree);
            const auto triad = theory::triadOf (chord.quality);
            if (present (chord.rootOffset, triad))
                continue;

            // The same chord is reachable from several modes; keep the first.
            if (! seen.insert ({ chord.rootOffset, (int) triad }).second)
                continue;

            found.push_back ({ chord.rootOffset, triad, theory::idOf (other) });
        }
    }

    return found;
}
void Progression::moveSlot (std::size_t from, std::size_t to)
{
    if (from >= count || to >= count || from == to)
        return;

    const auto moved = slots[from];
    if (from < to)
        for (std::size_t i = from; i < to; ++i)
            slots[i] = slots[i + 1];
    else
        for (std::size_t i = from; i > to; --i)
            slots[i] = slots[i - 1];

    slots[to] = moved;
}

void Progression::applyArticulationToAll (std::size_t source)
{
    if (source >= count)
        return;

    const auto articulation = slots[source];
    for (std::size_t i = 0; i < count; ++i)
    {
        slots[i].performance = articulation.performance;
        slots[i].param = articulation.param;
        slots[i].direction = articulation.direction;
    }
}
theory::Scale Progression::parallelModeOf (theory::Scale scale)
{
    switch (scale)
    {
        case theory::Scale::ionian:
        case theory::Scale::lydian:
        case theory::Scale::mixolydian:
            return theory::Scale::aeolian;
        default:
            return theory::Scale::ionian;
    }
}
} // namespace td
