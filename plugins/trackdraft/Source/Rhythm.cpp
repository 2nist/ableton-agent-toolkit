#include "Rhythm.h"

#include <algorithm>
#include <cmath>

namespace td
{
std::vector<int> euclidSteps (int k, int n, int rotation)
{
    const int steps = std::max (1, n);
    const int hits = std::max (1, std::min (steps, k));
    int rotate = rotation % steps;
    if (rotate < 0)
        rotate += steps;

    std::vector<int> found;
    found.reserve ((std::size_t) hits);
    for (int i = 0; i < hits; ++i)
    {
        const int base = (int) std::lround ((double) (i * steps) / (double) hits);
        found.push_back ((base + rotate) % steps);
    }

    std::sort (found.begin(), found.end());
    return found;
}

const std::vector<RhythmSeed>& rhythmSeeds()
{
    // Drawn from the loops a part actually gets: the two straight ones, the
    // three- and five-note cycles that read as groove rather than as a metronome,
    // and one pushed variant of the three.
    static const std::vector<RhythmSeed> table {
        { "Eighths", 8, 16, 0 },
        { "On the beat", 4, 16, 0 },
        { "Three over the bar", 3, 16, 0 },
        { "Pushed three", 3, 16, 2 },
        { "Five over the bar", 5, 16, 0 },
        { "Six over the bar", 6, 16, 0 },
        { "Seven over the bar", 7, 16, 0 },
    };

    return table;
}

void seedPattern (RhythmPattern& target, int k, int n, int rotation)
{
    RhythmPattern pattern;
    pattern.enabled = true;

    const auto loop = euclidSteps (k, n, rotation);

    // The bar is the meter's, not sixteen by assumption: a seed in 3/4 fills
    // twelve sixteenths, so the groove lands on that section's barlines.
    const int bar = (int) std::clamp<std::size_t> (target.length, 1, RhythmPattern::maxSteps);
    pattern.length = (std::size_t) bar;

    for (int step : loop)
    {
        // Map the loop onto the bar: 8 steps land on the eighths, 16 on the
        // sixteenths, and anything else proportionally.
        const int placed = (int) std::lround ((double) step * (double) bar / (double) std::max (1, n));
        if (placed < 0 || placed >= bar)
            continue;

        pattern.level[(std::size_t) placed] = RhythmPattern::normal;
    }

    // Accent the places a listener anchors to — the downbeat and the middle of
    // the bar — when the loop hits them.
    for (int anchor : { 0, bar / 2 })
        if (pattern.level[(std::size_t) anchor] != RhythmPattern::off)
            pattern.level[(std::size_t) anchor] = RhythmPattern::accent;

    target = pattern;
}
} // namespace td
