#pragma once

#include "Performance.h"
#include "Theory/ChordTheory.h"

#include <array>
#include <cmath>
#include <cstddef>
#include <vector>

namespace td
{
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

    /** Total beats in one pass of the progression. */
    double lengthInBeats() const noexcept override;

    /** Beat offset at which slot `index` starts. */
    double startBeatOf (std::size_t index) const noexcept override;

    std::size_t slotCount() const noexcept override { return count; }

    /** Slot `index`, clamped into the array so callers need no guard. */
    const ChordSlot& slotAt (std::size_t index) const noexcept override;

    /** One section, so every slot is under the same bass voice. */
    const BassLine& bassAt (std::size_t index) const noexcept override;

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
    void applyArticulationToAll (std::size_t source);
};
} // namespace td
