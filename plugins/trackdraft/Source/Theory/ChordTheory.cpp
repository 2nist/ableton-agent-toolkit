#include "ChordTheory.h"

#include <algorithm>
#include <array>
#include <cmath>

namespace td::theory
{
namespace
{
/** CHORD_INTERVALS + CHORD_QUALITY_SUFFIX from packages/music-theory/src/chords.ts. */
const std::vector<QualityDef>& buildQualities()
{
    static const std::vector<QualityDef> table = {
        { Quality::maj, "maj", "", { 0, 4, 7 }, {} },
        { Quality::min, "min", "m", { 0, 3, 7 }, {} },
        { Quality::five, "5", "5", { 0, 7 }, {} },
        { Quality::sus4, "sus4", "sus4", { 0, 5, 7 }, {} },
        { Quality::sus2, "sus2", "sus2", { 0, 2, 7 }, {} },
        { Quality::dim, "dim", "dim", { 0, 3, 6 }, {} },
        { Quality::aug, "aug", "aug", { 0, 4, 8 }, {} },
        { Quality::seven, "7", "7", { 0, 4, 7, 10 }, { 2 } },
        { Quality::maj7, "maj7", "maj7", { 0, 4, 7, 11 }, { 2 } },
        { Quality::min7, "min7", "m7", { 0, 3, 7, 10 }, { 2 } },
        { Quality::m7b5, "m7b5", "m7\u266d5", { 0, 3, 6, 10 }, {} },
        { Quality::dim7, "dim7", "dim7", { 0, 3, 6, 9 }, {} },
        { Quality::mMaj7, "mMaj7", "mMaj7", { 0, 3, 7, 11 }, { 2 } },
        { Quality::six, "6", "6", { 0, 4, 7, 9 }, { 2 } },
        { Quality::min6, "min6", "m6", { 0, 3, 7, 9 }, { 2 } },
        { Quality::add9, "add9", "add9", { 0, 4, 7, 14 }, { 2 } },
        { Quality::sevenSus4, "7sus4", "7sus4", { 0, 5, 7, 10 }, { 2 } },
        { Quality::sevenFlat5, "7b5", "7\u266d5", { 0, 4, 6, 10 }, {} },
        { Quality::sevenSharp5, "7#5", "7\u266f5", { 0, 4, 8, 10 }, {} },
        { Quality::maj7Sharp5, "maj7#5", "maj7\u266f5", { 0, 4, 8, 11 }, {} },
        { Quality::nine, "9", "9", { 0, 4, 7, 10, 14 }, { 2 } },
        { Quality::maj9, "maj9", "maj9", { 0, 4, 7, 11, 14 }, { 2 } },
        { Quality::min9, "min9", "m9", { 0, 3, 7, 10, 14 }, { 2 } },
        { Quality::sevenFlat9, "7b9", "7\u266d9", { 0, 4, 7, 10, 13 }, { 2 } },
        { Quality::sevenSharp9, "7#9", "7\u266f9", { 0, 4, 7, 10, 15 }, { 2 } },
        { Quality::sevenSharp11, "7#11", "7\u266f11", { 0, 4, 7, 10, 18 }, { 2 } },
        // Everything below is beyond the app's historical preference order and
        // sits where CANDIDATE_QUALITIES appends it: ascending tone count.
        { Quality::sixNine, "69", "6/9", { 0, 4, 7, 9, 14 }, { 2 } },
        { Quality::nineSus4, "9sus4", "9sus4", { 0, 5, 7, 10, 14 }, { 2 } },
        { Quality::sevenFlat13, "7b13", "7\u266d13", { 0, 4, 7, 10, 20 }, { 2 } },
        { Quality::eleven, "11", "11", { 0, 7, 10, 14, 17 }, { 1, 3 } },
        { Quality::min11, "min11", "m11", { 0, 3, 7, 10, 14, 17 }, { 2, 4 } },
        { Quality::thirteen, "13", "13", { 0, 4, 7, 10, 14, 21 }, { 2 } },
        { Quality::maj13, "maj13", "maj13", { 0, 4, 7, 11, 14, 21 }, { 2 } },
        { Quality::min13, "min13", "m13", { 0, 3, 7, 10, 14, 21 }, { 2 } },
    };
    return table;
}

const std::array<const char*, 12>& pitchClassNames()
{
    static const std::array<const char*, 12> names = {
        "C", "C\u266f", "D", "E\u266d", "E", "F", "F\u266f", "G", "A\u266d", "A", "B\u266d", "B"
    };
    return names;
}
} // namespace

const std::vector<QualityDef>& qualities() { return buildQualities(); }

const QualityDef& def(Quality quality)
{
    const auto& table = qualities();
    for (const auto& entry : table)
        if (entry.quality == quality)
            return entry;
    return table.front();
}

const char* idOf(Quality quality) { return def(quality).id; }
const char* suffixOf(Quality quality) { return def(quality).suffix; }
const std::vector<int>& intervalsOf(Quality quality) { return def(quality).intervals; }

std::vector<int> pitchClasses(int rootPc, Quality quality)
{
    std::vector<int> pcs;
    for (int interval : intervalsOf(quality))
    {
        const int pc = ((rootPc + interval) % 12 + 12) % 12;
        if (std::find(pcs.begin(), pcs.end(), pc) == pcs.end())
            pcs.push_back(pc);
    }
    return pcs;
}

const char* pitchClassName(int pitchClass)
{
    return pitchClassNames()[(std::size_t) (((pitchClass % 12) + 12) % 12)];
}

std::string chordName(int rootPc, Quality quality)
{
    return std::string(pitchClassName(rootPc)) + suffixOf(quality);
}

const char* idOf(Scale scale)
{
    switch (scale)
    {
        case Scale::ionian: return "ionian";
        case Scale::dorian: return "dorian";
        case Scale::phrygian: return "phrygian";
        case Scale::lydian: return "lydian";
        case Scale::mixolydian: return "mixolydian";
        case Scale::aeolian: return "aeolian";
        case Scale::locrian: return "locrian";
    }
    return "ionian";
}

const char* displayNameOf(Scale scale)
{
    switch (scale)
    {
        case Scale::ionian: return "Major (Ionian)";
        case Scale::dorian: return "Dorian";
        case Scale::phrygian: return "Phrygian";
        case Scale::lydian: return "Lydian";
        case Scale::mixolydian: return "Mixolydian";
        case Scale::aeolian: return "Minor (Aeolian)";
        case Scale::locrian: return "Locrian";
    }
    return "Major (Ionian)";
}

const std::vector<int>& scaleIntervals(Scale scale)
{
    // SCALE_INTERVALS from packages/music-theory/src/scales.ts.
    static const std::vector<int> ionian { 0, 2, 4, 5, 7, 9, 11 };
    static const std::vector<int> dorian { 0, 2, 3, 5, 7, 9, 10 };
    static const std::vector<int> phrygian { 0, 1, 3, 5, 7, 8, 10 };
    static const std::vector<int> lydian { 0, 2, 4, 6, 7, 9, 11 };
    static const std::vector<int> mixolydian { 0, 2, 4, 5, 7, 9, 10 };
    static const std::vector<int> aeolian { 0, 2, 3, 5, 7, 8, 10 };
    static const std::vector<int> locrian { 0, 1, 3, 5, 6, 8, 10 };

    switch (scale)
    {
        case Scale::ionian: return ionian;
        case Scale::dorian: return dorian;
        case Scale::phrygian: return phrygian;
        case Scale::lydian: return lydian;
        case Scale::mixolydian: return mixolydian;
        case Scale::aeolian: return aeolian;
        case Scale::locrian: return locrian;
    }
    return ionian;
}

std::vector<Quality> diatonicQualities(Scale scale)
{
    const auto& steps = scaleIntervals(scale);
    const int size = (int) steps.size();
    std::vector<Quality> found;
    if (size == 0)
        return found;

    // Scale step `degree` (may run past the end) as a pitch class.
    const auto at = [&steps, size](int degree)
    {
        const int octave = (int) std::floor((double) degree / (double) size);
        const int step = ((degree % size) + size) % size;
        return (((steps[(size_t) step] + 12 * octave) % 12) + 12) % 12;
    };

    const auto add = [&found](Quality quality)
    {
        if (std::find(found.begin(), found.end(), quality) == found.end())
            found.push_back(quality);
    };

    for (int degree = 0; degree < size; ++degree)
    {
        const int root = at(degree);
        const int third = (at(degree + 2) - root + 12) % 12;
        const int fifth = (at(degree + 4) - root + 12) % 12;
        const int seventh = (at(degree + 6) - root + 12) % 12;

        Quality triad;
        if (third == 4 && fifth == 7)       triad = Quality::maj;
        else if (third == 3 && fifth == 7)  triad = Quality::min;
        else if (third == 3 && fifth == 6)  triad = Quality::dim;
        else if (third == 4 && fifth == 8)  triad = Quality::aug;
        else continue;

        add(triad);
        if (size < 7)
            continue;

        if (triad == Quality::maj)
            add(seventh == 11 ? Quality::maj7 : seventh == 10 ? Quality::seven : Quality::maj);
        else if (triad == Quality::min)
            add(seventh == 10 ? Quality::min7 : seventh == 11 ? Quality::mMaj7 : Quality::min);
        else if (triad == Quality::dim)
            add(seventh == 10 ? Quality::m7b5 : seventh == 9 ? Quality::dim7 : Quality::dim);
        else
            add(Quality::maj7Sharp5);
    }

    return found;
}
} // namespace td::theory
