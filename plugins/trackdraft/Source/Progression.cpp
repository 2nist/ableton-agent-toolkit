#include "Progression.h"

#include <algorithm>
#include <limits>
#include <set>
#include <utility>

namespace td
{
std::string RhythmPattern::toDigits() const
{
    const auto count = std::clamp<std::size_t> (length, 1, maxSteps);

    std::string digits;
    digits.reserve (count);

    for (std::size_t i = 0; i < count; ++i)
        digits.push_back ((char) ('0' + (level[i] > accent ? accent : level[i])));

    return digits;
}

bool RhythmPattern::fromDigits (const std::string& digits, RhythmPattern& target)
{
    // The count is the bar: sixteen digits is a bar of 4/4, twelve a bar of 3/4.
    // A file written before meters existed is sixteen, and reads as it always
    // did, so the length needs no attribute of its own.
    if (digits.empty() || digits.size() > maxSteps)
        return false;

    RhythmPattern pattern;
    for (std::size_t i = 0; i < digits.size(); ++i)
    {
        if (digits[i] < '0' || digits[i] > '3')
            return false;

        pattern.level[i] = (std::uint8_t) (digits[i] - '0');
    }

    pattern.length = digits.size();
    pattern.enabled = true;
    target = pattern;
    return true;
}

Meter Progression::meterAtBar (int bar) const noexcept
{
    // Scanned rather than indexed so a hand-edited file that lists its changes
    // out of order still resolves the way the app does.
    const MeterChange* best = nullptr;
    for (const auto& change : meterMap)
        if (change.bar <= bar && (best == nullptr || change.bar > best->bar))
            best = &change;

    return best != nullptr ? best->meter : meter;
}

std::vector<Progression::MeterSegment> Progression::meterSegments() const
{
    std::vector<MeterSegment> segments { { 0, meter } };

    std::vector<MeterChange> sorted = meterMap;
    std::sort (sorted.begin(), sorted.end(),
               [] (const MeterChange& a, const MeterChange& b) { return a.bar < b.bar; });

    for (const auto& change : sorted)
    {
        // A change at bar 0 is the opening meter, not a second segment: the
        // last one listed wins, which is what `meterAtBar(0)` returns.
        if (change.bar <= 0)
        {
            segments[0].meter = change.meter;
            continue;
        }

        segments.push_back ({ change.bar, change.meter });
    }

    return segments;
}

double Progression::beatAtBar (int bar) const noexcept
{
    double total = 0.0;
    const auto segments = meterSegments();

    for (std::size_t i = 0; i < segments.size(); ++i)
    {
        const int from = segments[i].fromBar;
        if (bar <= from)
            break;

        const int next = i + 1 < segments.size() ? segments[i + 1].fromBar : bar;
        const int end = std::min (next, bar);
        total += (double) (end - from) * segments[i].meter.barBeats();

        if (bar <= next)
            break;
    }

    return total;
}

Progression::BarPosition Progression::positionAtBeat (double beat) const noexcept
{
    double remaining = std::max (0.0, beat);
    const auto segments = meterSegments();

    for (std::size_t i = 0; i < segments.size(); ++i)
    {
        const int from = segments[i].fromBar;
        const double length = std::max (1e-9, segments[i].meter.barBeats());

        const bool lastSegment = i + 1 >= segments.size();
        if (! lastSegment)
        {
            const double run = (double) (segments[i + 1].fromBar - from) * length;
            if (remaining >= run)
            {
                remaining -= run;
                continue;
            }
        }

        // Guarded so an absurd transport position cannot overflow the bar index.
        const double wholeBars = std::floor (remaining / length);
        const int whole = (int) std::min (wholeBars, (double) std::numeric_limits<int>::max() / 2);
        return { from + whole, remaining - (double) whole * length };
    }

    // Unreachable: there is always a segment at bar 0, and the last one returns.
    return { 0, 0.0 };
}

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

const ChordSlot& Progression::slotAt (std::size_t index) const noexcept
{
    return slots[std::min (index, maxSlots - 1)];
}

const BassLine& Progression::bassAt (std::size_t) const noexcept
{
    return bass;
}

const TonicRegion* Progression::regionAtBeat (double beat) const noexcept
{
    // The regions are kept sorted, so the last one that starts at or before the
    // beat wins — the app's `resolveTonicAt`, without the copy.
    const TonicRegion* found = nullptr;
    for (const auto& region : regions)
    {
        if (region.startBeat > beat + 1e-6)
            break;

        found = &region;
    }

    return found;
}

const TonicRegion* Progression::regionAtSlot (std::size_t index) const noexcept
{
    return regionAtBeat (startBeatOf (index));
}

bool Progression::hasKeyAt (std::size_t index) const noexcept
{
    return regionAtSlot (index) != nullptr;
}

int Progression::keyAt (std::size_t index) const noexcept
{
    const auto* region = regionAtSlot (index);
    return region != nullptr ? region->keyPc : 0;
}

bool Progression::hasScaleAt (std::size_t index) const noexcept
{
    return regionAtSlot (index) != nullptr;
}

theory::Scale Progression::scaleAt (std::size_t index) const noexcept
{
    const auto* region = regionAtSlot (index);
    return region != nullptr ? region->scale : theory::Scale::ionian;
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

void Progression::applyFeelToAll (std::size_t source)
{
    if (source >= count)
        return;

    const auto from = slots[source];
    for (std::size_t i = 0; i < count; ++i)
    {
        slots[i].performance = from.performance;
        slots[i].param = from.param;
        slots[i].direction = from.direction;
        slots[i].rhythm = from.rhythm;
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
