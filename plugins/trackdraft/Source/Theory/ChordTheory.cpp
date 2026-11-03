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
        // The optional indices follow the app's derived rule
        // (`optionalTonesFor`): the perfect fifth when there is one, the ninth
        // once an eleventh is present, the eleventh once a thirteenth is.
        { Quality::dim11, "dim11", "dim11", { 0, 3, 6, 9, 14, 17 }, { 4 } },
        { Quality::maj11, "maj11", "maj11", { 0, 4, 7, 11, 14, 17 }, { 2, 4 } },
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

namespace
{
/** The app's `invertIntervals`. */
std::vector<int> invertIntervals (const std::vector<int>& intervals, int inversion)
{
    const auto size = intervals.size();
    if (size == 0)
        return {};

    int shift = inversion % (int) size;
    if (shift < 0)
        shift += (int) size;

    if (shift == 0)
        return intervals;

    std::vector<int> rotated (intervals.begin() + shift, intervals.end());
    for (int i = 0; i < shift; ++i)
        rotated.push_back (intervals[(std::size_t) i] + 12);

    return rotated;
}

/** The app's `openIntervals`: the second-highest tone drops an octave. */
std::vector<int> openIntervals (std::vector<int> intervals)
{
    if (intervals.size() < 3)
        return intervals;

    intervals[intervals.size() - 2] -= 12;
    std::sort (intervals.begin(), intervals.end());
    return intervals;
}
} // namespace

std::size_t inversionCount (Quality quality)
{
    return intervalsOf (quality).size();
}

std::vector<int> voicedNotes (int rootMidi, Quality quality, const Voicing& voicing)
{
    auto intervals = invertIntervals (intervalsOf (quality), voicing.inversion);
    if (voicing.open)
        intervals = openIntervals (std::move (intervals));

    // `voiceChord` re-bases the shape on the tone now in the bass; for the notes
    // themselves that cancels out, so each offset is simply added to the root.
    std::vector<int> notes;
    notes.reserve (intervals.size());
    for (int interval : intervals)
    {
        const int note = rootMidi + interval;
        if (note >= 0 && note <= 127)
            notes.push_back (note);
    }

    std::sort (notes.begin(), notes.end());
    return notes;
}

int bassPitchClass (int rootPc, Quality quality, const Voicing& voicing)
{
    const auto& intervals = intervalsOf (quality);
    if (intervals.empty())
        return ((rootPc % 12) + 12) % 12;

    int shift = voicing.inversion % (int) intervals.size();
    if (shift < 0)
        shift += (int) intervals.size();

    return ((rootPc + intervals[(std::size_t) shift]) % 12 + 12) % 12;
}

std::string chordNameWithBass (int rootPc, Quality quality, const Voicing& voicing)
{
    std::string name = chordName (rootPc, quality);
    if (voicing.isDefault())
        return name;

    return name + "/" + pitchClassName (bassPitchClass (rootPc, quality, voicing));
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

DiatonicChord diatonicChordAt(Scale scale, int degree)
{
    const auto& steps = scaleIntervals(scale);
    const int size = (int) steps.size();
    if (size == 0)
        return {};

    const auto at = [&steps, size](int step)
    {
        const int octave = (int) std::floor((double) step / (double) size);
        const int index = ((step % size) + size) % size;
        return steps[(size_t) index] + 12 * octave;
    };

    const auto normalisedDegree = ((degree % size) + size) % size;
    const int base = steps[(size_t) normalisedDegree];
    const int rootOffset = ((base % 12) + 12) % 12;

    const int third = (at (degree + 2) - at (degree) + 12) % 12;
    const int fifth = (at (degree + 4) - at (degree) + 12) % 12;
    const int seventh = size >= 7 ? (at (degree + 6) - at (degree) + 12) % 12 : -1;

    Quality quality;
    if (third == 4 && fifth == 7)       quality = Quality::maj;
    else if (third == 3 && fifth == 7)  quality = Quality::min;
    else if (third == 3 && fifth == 6)  quality = Quality::dim;
    else if (third == 4 && fifth == 8)  quality = Quality::aug;
    else return { rootOffset, Quality::maj };

    if (seventh >= 0)
    {
        if (quality == Quality::maj)
            quality = seventh == 11 ? Quality::maj7 : seventh == 10 ? Quality::seven : Quality::maj;
        else if (quality == Quality::min)
            quality = seventh == 10 ? Quality::min7 : seventh == 11 ? Quality::mMaj7 : Quality::min;
        else if (quality == Quality::dim)
            quality = seventh == 10 ? Quality::m7b5 : seventh == 9 ? Quality::dim7 : Quality::dim;
        else
            quality = Quality::maj7Sharp5;
    }

    return { rootOffset, quality };
}

Quality triadOf(Quality quality)
{
    switch (quality)
    {
        case Quality::min:
        case Quality::min7:
        case Quality::min9:
        case Quality::min11:
        case Quality::min13:
        case Quality::min6:
        case Quality::mMaj7:
            return Quality::min;
        case Quality::m7b5:
        case Quality::dim:
        case Quality::dim7:
        case Quality::dim11:
            return Quality::dim;
        case Quality::aug:
        case Quality::maj7Sharp5:
            return Quality::aug;
        default:
            return Quality::maj;
    }
}

std::string romanNumeral(int degree, Quality quality)
{
    static const char* upper[] = { "I", "II", "III", "IV", "V", "VI", "VII" };
    static const char* lower[] = { "i", "ii", "iii", "iv", "v", "vi", "vii" };

    const int index = ((degree % 7) + 7) % 7;
    // Quality decides the case, which is what makes "ii7" read as a minor
    // seventh and "II7" as a secondary dominant at a glance.
    const bool minorish = quality == Quality::min || quality == Quality::min7
                          || quality == Quality::m7b5 || quality == Quality::dim
                          || quality == Quality::dim7 || quality == Quality::min6
                          || quality == Quality::min9 || quality == Quality::min11
                          || quality == Quality::min13;

    std::string numeral = minorish ? lower[index] : upper[index];
    if (quality == Quality::dim || quality == Quality::dim7)
        numeral += "\u00b0";

    const auto& suffix = def (quality).suffix;
    if (suffix[0] != '\0')
        numeral += suffix;

    return numeral;
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
