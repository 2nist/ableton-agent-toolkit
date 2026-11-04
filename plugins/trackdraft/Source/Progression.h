#pragma once

#include "Performance.h"
#include "Theory/ChordTheory.h"

#include <algorithm>
#include <cstdint>
#include <string>

#include <array>
#include <cmath>
#include <cstddef>
#include <vector>

namespace td
{
/**
    A slot's own rhythm: a bar of sixteenths, each one silent or a hit at one of
    three levels.

    This is the "when" of a chord part, where `Performance` is the "how" of each
    hit: the grid decides which sixteenths sound, and the articulation decides
    whether a hit is a block, a strum or an arpeggio. The grid is **one bar of
    the meter it sits in** — 16 sixteenths in 4/4, 12 in 3/4, 14 in 7/8 — and
    tiles over a longer slot; a shorter slot uses the steps that fit.

    The bar is the pattern's own `length`, so a pattern says how long its bar is:
    that is why the file's digit count *is* the length, and why a grid written
    before meters existed (sixteen digits) still means a bar of 4/4.

    `enabled` with every level at zero is silence, which is a real choice for a
    slot; no pattern at all (`enabled` false) means "play the articulation as
    before", which is what every slot written before this did.
*/
struct RhythmPattern
{
    /** Capacity, not length: a bar of 8/4 is 32 sixteenths, the widest a bar
        gets before it is really two bars. */
    static constexpr std::size_t maxSteps = 32;
    /** The length of a bar of 4/4, and the length a new pattern starts at. */
    static constexpr std::size_t defaultSteps = 16;
    /** Sixteenths in a beat. */
    static constexpr int stepsPerBeat = 4;

    /** 0 silent, 1 ghost, 2 normal, 3 accent. */
    enum Level : std::uint8_t
    {
        off = 0,
        ghost = 1,
        normal = 2,
        accent = 3,
    };

    bool enabled = false;
    /** Sixteenths in the bar this pattern covers: 16 in 4/4, 12 in 3/4. */
    std::size_t length = defaultSteps;
    std::array<std::uint8_t, maxSteps> level {};

    /** Beats one pass of the pattern covers — one bar. */
    double barBeats() const noexcept
    {
        return (double) std::clamp<std::size_t> (length, 1, maxSteps) / (double) stepsPerBeat;
    }

    bool anyHit() const noexcept
    {
        for (std::size_t i = 0; i < length; ++i)
            if (level[i] != off)
                return true;

        return false;
    }

    /** The digits the file holds — one per sixteenth, so their count is the
        length: "3002000030020000" is a bar of 4/4. */
    std::string toDigits() const;

    /** Reads 1-32 digits of 0-3, taking the length from the count; false leaves
        `target` untouched. */
    static bool fromDigits (const std::string& digits, RhythmPattern& target);

    bool operator== (const RhythmPattern& other) const noexcept
    {
        return enabled == other.enabled && length == other.length && level == other.level;
    }
};

/** One slot of the progression: what to play, and for how many beats. */
struct ChordSlot
{
    int rootPc = 0;
    theory::Quality quality = theory::Quality::maj;
    double beats = 4.0;
    Performance performance = Performance::block;
    /** Strum spread in ms, or pulse/arp subdivision. 0 = the default. */
    int param = 0;
    /** Arp direction: 0 up, 1 down, 2 up-down. */
    int direction = 2;
    /** Which chord tone is in the bass, and whether the upper voices are spread
        open — the app's `ChordVoicing`. Default is root position, close. */
    theory::Voicing voicing {};

    /** The slot's own rhythm; no pattern means "the articulation, as before". */
    RhythmPattern rhythm {};

    bool operator== (const ChordSlot& other) const noexcept
    {
        return rootPc == other.rootPc && quality == other.quality
               && performance == other.performance && param == other.param
               && direction == other.direction
               && voicing.inversion == other.voicing.inversion
               && voicing.open == other.voicing.open
               && std::abs (beats - other.beats) < 1e-9;
    }

    /** Everything the articulation needs, from the slot's own fields. */
    PerformanceSettings articulation (double gate) const noexcept
    {
        return { performance, param, direction, gate };
    }
};

/**
    A run of a section that shares one home key — a modulation *inside* a
    section, the app's `TonicRegion`.

    Section-relative beats, and the regions are sorted by `startBeat`: the one in
    force at a beat is the last that starts at or before it, exactly as
    `resolveTonicAt` decides it. A region is a whole home, not a half of one, so
    unlike a section it carries both halves.
*/
struct TonicRegion
{
    double startBeat = 0.0;
    int keyPc = 0;
    theory::Scale scale = theory::Scale::ionian;

    bool operator== (const TonicRegion& other) const noexcept
    {
        return std::abs (startBeat - other.startBeat) < 1e-9 && keyPc == other.keyPc
               && scale == other.scale;
    }
};

/** How a bass voice moves between the chords it plays under — the app's
    `BassMotion`. */
enum class BassMotion
{
    root,
    rootFifth,
    walking,
};

/** How often the bass sounds inside one chord's span — the app's `BassRhythm`. */
enum class BassRhythm
{
    locked,
    half,
    eighth,
};

/**
    A section's bass voice: the app's `BassProfile`.

    Absent from a section, no bass voice plays — the plug-in does not invent one,
    so a session saved before the bass existed sounds exactly as it did. The app
    writes its own default into the file when it exports a song, because its
    `.mid` export has always had a root line; that way the plug-in hears what the
    export heard.
*/
struct BassLine
{
    bool enabled = false;
    /** `octave * 12 + pitch class`, the app's bass numbering: 3 is the standard
        register (MIDI 36). Not the chord register's `(octave + 1) * 12`. */
    int octave = 3;
    BassMotion motion = BassMotion::root;
    BassRhythm rhythm = BassRhythm::locked;
    int velocity = 100;

    bool operator== (const BassLine& other) const noexcept
    {
        return enabled == other.enabled && octave == other.octave && motion == other.motion
               && rhythm == other.rhythm && velocity == other.velocity;
    }
};

/**
    A written meter: how many of what note value fill a bar — 4/4, 3/4, 7/8.

    `denominator` is the note value itself (4, 8), not its power of two, which is
    what the app's `MeterChange` carries and what a musician writes. A bar of
    `numerator * 4 / denominator` quarter-note beats follows from it: 6/8 is
    three beats, not six.
*/
struct Meter
{
    int numerator = 4;
    int denominator = 4;

    /** Quarter-note beats in one bar. */
    double barBeats() const noexcept
    {
        if (numerator <= 0 || denominator <= 0)
            return 4.0;

        return (double) numerator * 4.0 / (double) denominator;
    }

    bool isDefault() const noexcept { return numerator == 4 && denominator == 4; }

    bool operator== (const Meter& other) const noexcept
    {
        return numerator == other.numerator && denominator == other.denominator;
    }
};

/** A meter change at a 0-based bar of the section — the app's `MeterChange`. */
struct MeterChange
{
    int bar = 0;
    Meter meter;

    bool operator== (const MeterChange& other) const noexcept
    {
        return bar == other.bar && meter == other.meter;
    }
};

/**
    What the scheduler needs from whatever it plays: a length to loop on, and a
    flat list of slots with the beat each one starts at.

    `Progression` is one section's worth of this. `SongCycle` flattens a whole
    song — every pass of every section, in arrangement order — into the same
    shape, so there is one set of timing rules rather than one per model. The
    numbers are absolute within the cycle, which is what makes a section change
    indistinguishable from a chord change to the scheduler.
*/
class ChordCycle
{
public:
    ChordCycle() = default;
    /** Copyable: a `Progression` is copied all over the place, and slicing one
        into its base is never what anyone means. */
    ChordCycle (const ChordCycle&) = default;
    ChordCycle& operator= (const ChordCycle&) = default;
    virtual ~ChordCycle() = default;

    virtual double lengthInBeats() const = 0;
    virtual std::size_t slotCount() const = 0;
    virtual double startBeatOf (std::size_t index) const = 0;
    virtual const ChordSlot& slotAt (std::size_t index) const = 0;
    /** The bass voice that belongs to the section `index` falls in. */
    virtual const BassLine& bassAt (std::size_t index) const = 0;

    /** The home key `index` plays under, if the song itself says: a section's
        override or a region inside it. False means "the song's", which is the
        plug-in's Key parameter — the cycle cannot know a parameter. */
    virtual bool hasKeyAt (std::size_t index) const = 0;
    virtual int keyAt (std::size_t index) const = 0;
    virtual bool hasScaleAt (std::size_t index) const = 0;
    virtual theory::Scale scaleAt (std::size_t index) const = 0;

    /** Quarter-note beats in the bar `index` starts in. 4 unless the material
        carries a meter — a rhythm grid is drawn against this. */
    virtual double barBeatsAt (std::size_t index) const noexcept
    {
        (void) index;
        return 4.0;
    }
};

/**
    One section's chords: the progression the plugin plays.

    Deliberately not a JUCE model object: the editor edits a copy, the processor
    owns the live one, and the state is written as XML. Length is fixed at
    `maxSlots` so a saved session always round-trips — a shorter progression is
    expressed by the sum of its `beats`, not by a shorter array.
*/
struct Progression : public ChordCycle
{
    static constexpr std::size_t maxSlots = 8;

    std::array<ChordSlot, maxSlots> slots {};
    std::size_t count = 4;

    /** This section's bass voice; off unless a song or preset turns it on. */
    BassLine bass;

    /** Modulations inside this section, by section-relative beat. */
    std::vector<TonicRegion> regions;

    /**
        The meter the section opens in, and any changes after it.

        The plug-in's chords carry their own beat lengths, so the meter does not
        change what it plays — it decides how long a *bar* is, which is what a
        rhythm grid is drawn against and where the grid's cursor falls. Absent
        (4/4, and no changes) is the default and writes nothing into the file,
        so a section written before meters existed round-trips byte-identically.

        Changes are by 0-based bar, section-relative, sorted by bar: the meter in
        force at bar N is the last change at or before N, and bars before the
        first change use `meter`.
    */
    Meter meter;
    std::vector<MeterChange> meterMap;

    /** The meter in force at `bar`. */
    Meter meterAtBar (int bar) const noexcept;

    /** Quarter-note beats in bar `bar` — 4 in 4/4, 3.5 in a bar of 7/8. */
    double barLengthAt (int bar) const noexcept { return meterAtBar (bar).barBeats(); }

    /** Section-relative beat where bar `bar` starts: the sum of the bars before
        it. Bar 0 starts at 0 whatever the meter is. */
    double beatAtBar (int bar) const noexcept;

    /** Which bar a section-relative beat falls in, and how far into it. */
    struct BarPosition
    {
        int bar = 0;
        double beatInBar = 0.0;
    };
    BarPosition positionAtBeat (double beat) const noexcept;

    /** Quarter-note beats in the bar the slot `index` starts in. */
    double barBeatsAtSlot (std::size_t index) const noexcept
    {
        return barLengthAt (positionAtBeat (startBeatOf (index)).bar);
    }

private:
    /**
        The meter map as runs of equal-length bars, in bar order, starting at
        bar 0.

        `beatAtBar` and `positionAtBeat` walk these rather than counting bars
        one at a time: a file that says `bar="100000"` describes a long section,
        not a request to loop a hundred thousand times while the song loads.
    */
    struct MeterSegment
    {
        int fromBar = 0;
        Meter meter;
    };
    std::vector<MeterSegment> meterSegments() const;

public:

    double barBeatsAt (std::size_t index) const noexcept override { return barBeatsAtSlot (index); }

    /** The region in force at `beat`, or nullptr when the section has one home. */
    const TonicRegion* regionAtBeat (double beat) const noexcept;

    /** The region in force when `index` starts (nullptr when there is none). */
    const TonicRegion* regionAtSlot (std::size_t index) const noexcept;

    /** Total beats in one pass of the progression. */
    double lengthInBeats() const noexcept override;

    /** Beat offset at which slot `index` starts. */
    double startBeatOf (std::size_t index) const noexcept override;

    std::size_t slotCount() const noexcept override { return count; }

    /** Slot `index`, clamped into the array so callers need no guard. */
    const ChordSlot& slotAt (std::size_t index) const noexcept override;

    /** One section, so every slot is under the same bass voice. */
    const BassLine& bassAt (std::size_t index) const noexcept override;

    /** A bare progression knows only its own regions — the section's own key
        lives on the song, not here. */
    bool hasKeyAt (std::size_t index) const noexcept override;
    int keyAt (std::size_t index) const noexcept override;
    bool hasScaleAt (std::size_t index) const noexcept override;
    theory::Scale scaleAt (std::size_t index) const noexcept override;

    /** Slot sounding at `beat` (position inside the loop), or the last one. */
    std::size_t slotAtBeat (double beat) const noexcept;

    /** Fills `count` slots with the diatonic chords of `scale` in `keyPc`. */
    void seedFromScale (int keyPc, theory::Scale scale, std::size_t slotCount = 4);

    /** One borrowed chord the current key does not contain. */
    struct Borrowed
    {
        int rootPc = 0;
        theory::Quality quality = theory::Quality::maj;
        /** The mode it was borrowed from, e.g. "aeolian". */
        const char* from = "";
    };

    /**
        Chords other modes on the same tonic would give this key.

        Derived, not listed: every mode's diatonic chords are built against the
        same tonic, and anything the current mode does not already contain is a
        borrowing — bIII, iv, bVI and bVII in a major key, and so on. Duplicates
        (the same chord reachable from two modes) appear once.
    */
    static std::vector<Borrowed> borrowedChords (theory::Scale scale,
                                                 bool includeEveryMode = false);

    /** The mode a songwriter borrows from: the parallel minor of a major-ish
        mode, or the parallel major of a minor-ish one. */
    static theory::Scale parallelModeOf (theory::Scale scale);

    /** Moves slot `from` so it sits at `to`, shifting the slots it passes. */
    void moveSlot (std::size_t from, std::size_t to);

    /** Copies `source`'s articulation onto every slot (the "apply to all" button). */
    /** Copies a slot's feel — articulation and rhythm — onto every slot. */
    void applyFeelToAll (std::size_t source);
};
} // namespace td
