#include "ChordRecognition.h"

#include <algorithm>
#include <cmath>
#include <set>

namespace td
{
namespace
{
// The same constants as chordRecognition.ts. Changing one without the other
// makes the plug-in and the app name the same chord differently.
constexpr double extraNotePenalty = 0.35;
constexpr double requiredOmissionPenalty = 0.15;
constexpr double optionalOmissionPenalty = 0.04;
constexpr double bassBonus = 0.08;
constexpr double previousExactBonus = 0.08;
constexpr double previousRootBonus = 0.03;
constexpr double tieBand = 0.06;

double clampValue (double value, double low, double high)
{
    return std::max (low, std::min (high, value));
}

/** Unique pitch classes of a shape, relative to its root. */
std::vector<int> templatePcs (int rootPc, theory::Quality quality)
{
    std::vector<int> pcs;
    for (int interval : theory::intervalsOf (quality))
    {
        const int pc = ((rootPc + interval) % 12 + 12) % 12;
        if (std::find (pcs.begin(), pcs.end(), pc) == pcs.end())
            pcs.push_back (pc);
    }
    return pcs;
}

/** Pitch classes this quality may leave out without changing its name. */
std::set<int> optionalPcs (int rootPc, theory::Quality quality)
{
    const auto& intervals = theory::intervalsOf (quality);
    std::set<int> optional;
    for (int index : theory::def (quality).optional)
        optional.insert (((rootPc + intervals[(size_t) index]) % 12 + 12) % 12);
    return optional;
}

/** Whether a reading accounts for everything that was actually played. */
bool explainsCleanly (const RecognizedChord& chord)
{
    if (! chord.extras.empty())
        return false;

    const auto optional = optionalPcs (chord.rootPc, chord.quality);
    for (int pc : chord.missing)
        if (optional.find (pc) == optional.end())
            return false;

    return true;
}

RecognizedChord bestReading (const std::vector<theory::Quality>& candidates,
                             const std::vector<int>& played,
                             int bassPc,
                             bool hasPrevious,
                             int previousRootPc,
                             theory::Quality previousQuality)
{
    RecognizedChord best;

    for (auto quality : candidates)
    {
        for (int rootPc = 0; rootPc < 12; ++rootPc)
        {
            const auto shape = templatePcs (rootPc, quality);
            std::set<int> shapeSet (shape.begin(), shape.end());

            std::vector<int> extras;
            for (int pc : played)
                if (shapeSet.find (pc) == shapeSet.end())
                    extras.push_back (pc);

            std::vector<int> missing;
            for (int pc : shape)
                if (std::find (played.begin(), played.end(), pc) == played.end())
                    missing.push_back (pc);

            const int matched = (int) shape.size() - (int) missing.size();
            double score = (double) matched / (double) std::max<size_t> (1, shape.size());
            score -= (double) extras.size() * extraNotePenalty;

            const auto optional = optionalPcs (rootPc, quality);
            for (int pc : missing)
                score -= optional.find (pc) != optional.end() ? optionalOmissionPenalty
                                                              : requiredOmissionPenalty;

            const bool bassIsRoot = bassPc == rootPc;
            if (bassIsRoot)
                score += bassBonus;

            if (hasPrevious)
            {
                if (previousRootPc == rootPc && previousQuality == quality)
                    score += previousExactBonus;
                else if (previousRootPc == rootPc)
                    score += previousRootBonus;
            }

            score = clampValue (score, 0.01, 1.0);

            RecognizedChord candidate;
            candidate.valid = true;
            candidate.rootPc = rootPc;
            candidate.quality = quality;
            candidate.score = score;
            candidate.extras = extras;
            candidate.missing = missing;

            if (! best.valid)
            {
                best = candidate;
                continue;
            }

            if (candidate.score > best.score + tieBand)
            {
                best = candidate;
                continue;
            }
            if (candidate.score < best.score - tieBand)
                continue;

            // Inside the band: no unexplained note first, then bass evidence.
            if (candidate.extras.size() != best.extras.size())
            {
                if (candidate.extras.size() < best.extras.size())
                    best = candidate;
                continue;
            }

            const bool bestIsBass = bassPc >= 0 && best.rootPc == bassPc;
            if (bassIsRoot != bestIsBass && bassIsRoot)
                best = candidate;
        }
    }

    return best;
}
} // namespace

RecognizedChord recognizeChord (const std::vector<int>& pitchClasses,
                                const RecognizeOptions& options)
{
    std::vector<int> played;
    for (int pc : pitchClasses)
    {
        const int normalised = ((pc % 12) + 12) % 12;
        if (std::find (played.begin(), played.end(), normalised) == played.end())
            played.push_back (normalised);
    }

    RecognizedChord none;
    if (played.size() < 2)
        return none;

    if (! options.permitted.empty())
    {
        const auto inKey = bestReading (options.permitted, played, options.bassPc,
                                        options.hasPrevious, options.previousRootPc,
                                        options.previousQuality);
        if (inKey.valid && explainsCleanly (inKey))
            return inKey;
    }

    std::vector<theory::Quality> all;
    for (const auto& def : theory::qualities())
        all.push_back (def.quality);

    return bestReading (all, played, options.bassPc, options.hasPrevious,
                        options.previousRootPc, options.previousQuality);
}

RecognizedChord recognizeChordFromNotes (const std::vector<int>& midiNotes,
                                         const RecognizeOptions& options)
{
    if (midiNotes.empty())
        return {};

    std::vector<int> pcs;
    pcs.reserve (midiNotes.size());
    int lowest = 128;
    for (int note : midiNotes)
    {
        pcs.push_back (((note % 12) + 12) % 12);
        lowest = std::min (lowest, note);
    }

    auto withBass = options;
    withBass.bassPc = ((lowest % 12) + 12) % 12;
    return recognizeChord (pcs, withBass);
}
} // namespace td
