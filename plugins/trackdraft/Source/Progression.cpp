#include "Progression.h"

#include <algorithm>

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
    const auto& steps = theory::scaleIntervals (scale);
    const auto qualities = theory::diatonicQualities (scale);

    count = std::clamp<std::size_t> (slotCount, 1, maxSlots);

    for (std::size_t i = 0; i < count; ++i)
    {
        const int degree = (int) i % (int) steps.size();
        const int rootPc = ((keyPc + steps[(std::size_t) degree]) % 12 + 12) % 12;

        // Prefer the seventh-chord spelling of the degree when the mode offers
        // one — a generated progression reads as harmony, not as a stack of
        // triads. Falls back to the triad, which is always in the list.
        const int third = steps[(std::size_t) ((degree + 2) % (int) steps.size())];
        const int fifth = steps[(std::size_t) ((degree + 4) % (int) steps.size())];
        const int seventh = steps[(std::size_t) ((degree + 6) % (int) steps.size())];
        const bool isDiminished = ((third - steps[(std::size_t) degree] + 12) % 12) == 3
                                  && ((fifth - steps[(std::size_t) degree] + 12) % 12) == 6;
        const bool isMinor = ((third - steps[(std::size_t) degree] + 12) % 12) == 3;

        theory::Quality chosen = isDiminished ? theory::Quality::dim
                                 : isMinor   ? theory::Quality::min
                                             : theory::Quality::maj;

        // Seventh only when the mode actually has one on this degree.
        const bool hasSeventh = steps.size() >= 7
                                && std::find (qualities.begin(), qualities.end(),
                                              isDiminished ? theory::Quality::m7b5
                                                           : isMinor ? theory::Quality::min7
                                                                     : theory::Quality::maj7)
                                       != qualities.end();
        if (hasSeventh)
        {
            const int seventhSemitones = ((seventh - steps[(std::size_t) degree]) + 12) % 12;
            if (isDiminished && seventhSemitones == 10) chosen = theory::Quality::m7b5;
            else if (isMinor && seventhSemitones == 10) chosen = theory::Quality::min7;
            else if (! isMinor && ! isDiminished && seventhSemitones == 11) chosen = theory::Quality::maj7;
            else if (! isMinor && ! isDiminished && seventhSemitones == 10) chosen = theory::Quality::seven;
        }

        slots[i] = { rootPc, chosen, 4.0 };
    }
}
} // namespace td
