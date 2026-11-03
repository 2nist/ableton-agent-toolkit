#pragma once

#include <string>
#include <vector>

/**
    The harmony vocabulary, ported from @music-theory/core so the plugin and the
    app cannot disagree about what a quality sounds like.

    The tables are the contract: CHORD_INTERVALS / CHORD_QUALITY_SUFFIX /
    CHORD_OPTIONAL_TONES in packages/music-theory/src/chords.ts and
    SCALE_INTERVALS in scales.ts. TrackDraftTests compares a sample of entries
    against values pasted from those files, so a drift shows up as a failing
    test rather than as a chord that plays one note differently in the plugin.
*/
namespace td::theory
{
/** Every quality the app can name, in the app's tie-break order. */
enum class Quality
{
    maj,
    min,
    five,
    sus4,
    sus2,
    dim,
    aug,
    seven,
    maj7,
    min7,
    m7b5,
    dim7,
    mMaj7,
    six,
    min6,
    add9,
    sevenSus4,
    sevenFlat5,
    sevenSharp5,
    maj7Sharp5,
    nine,
    maj9,
    min9,
    sevenFlat9,
    sevenSharp9,
    sevenSharp11,
    sixNine,
    nineSus4,
    sevenFlat13,
    eleven,
    min11,
    thirteen,
    maj13,
    min13,
};

struct QualityDef
{
    Quality quality;
    const char* id;      // the app's ChordQuality string
    const char* suffix;  // the app's CHORD_QUALITY_SUFFIX
    std::vector<int> intervals;
    std::vector<int> optional;  // indices into `intervals`
};

/** All definitions, in the app's preference order. */
const std::vector<QualityDef>& qualities();
const QualityDef& def(Quality quality);

/** The app's `ChordQuality` string, e.g. "m7b5". */
const char* idOf(Quality quality);
/** The app's display suffix, e.g. "m7♭5". */
const char* suffixOf(Quality quality);

/** Pitch classes (0-11) of the shape. Deduplicated, so a 9th compares as a triad. */
std::vector<int> pitchClasses(int rootPc, Quality quality);
/** Interval row (semitones from the root, may exceed an octave). */
const std::vector<int>& intervalsOf(Quality quality);

/** 0-11 -> the app's sharp spelling; display only. */
const char* pitchClassName(int pitchClass);
/** e.g. "Cmaj7" — the spelling the app's chordName() produces. */
std::string chordName(int rootPc, Quality quality);

/** The seven modes the app models. */
enum class Scale
{
    ionian,
    dorian,
    phrygian,
    lydian,
    mixolydian,
    aeolian,
    locrian,
};

const char* idOf(Scale scale);
const char* displayNameOf(Scale scale);
const std::vector<int>& scaleIntervals(Scale scale);

/**
    Qualities that occur on the degrees of a mode, derived from the scale the
    same way `diatonicChordQualities` does in the app: stack scale thirds and
    classify. Used to seed an in-key progression.
*/
std::vector<Quality> diatonicQualities(Scale scale);

/** One degree of a mode: how far its root sits above the tonic, and its quality. */
struct DiatonicChord
{
    int rootOffset = 0;
    Quality quality = Quality::maj;
};

/** The chord on `degree` (0-based, may run past the end) of a mode. */
DiatonicChord diatonicChordAt(Scale scale, int degree);

/** Roman numeral for a diatonic chord, cased by quality: "IV", "ii7", "vii°5". */
std::string romanNumeral(int degree, Quality quality);
} // namespace td::theory
