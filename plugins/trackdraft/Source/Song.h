#pragma once

#include "Progression.h"

#include <juce_core/juce_core.h>

#include <vector>

namespace td
{
/**
    A whole song: named sections, each with its own chords, played in an
    arrangement order.

    The plug-in used to play a single `Progression`. A song is the same idea one
    level up — sections are the authored material, the arrangement is the order
    the passes happen in, and chords are reached by absolute song position. That
    keeps the timing model trivial: the song is a flat beat timeline, and a
    section change is just another boundary on it.

    Sections carry a stable `id` rather than being referenced by index, so
    reordering or deleting one cannot silently point the arrangement at a
    different section — the same rule the app's `arrangement` follows, where an
    entry names a `sectionId`.
*/
struct Song
{
    static constexpr std::size_t maxSections = 16;
    /** Passes are drawn in one row, so the arrangement is bounded like the rest
        of the editor rather than by what the file format could carry. */
    static constexpr std::size_t maxPasses = 32;
    static constexpr int maxRepeats = 8;

    struct Section
    {
        int id = 0;
        juce::String name;
        Progression progression;
    };

    /** One entry of the arrangement: the section, and how many passes of it. */
    struct Pass
    {
        int sectionId = 0;
        int repeats = 1;

        bool operator== (const Pass& other) const noexcept
        {
            return sectionId == other.sectionId && repeats == other.repeats;
        }
    };

    std::vector<Section> sections;
    std::vector<Pass> arrangement;

    /** Beats in one pass of `index`, 0 when there is no such section. */
    double sectionBeats (std::size_t index) const;

    /** Beats in the whole song, repeats included. */
    double totalBeats() const;

    bool empty() const noexcept { return sections.empty(); }

    /** Index of the section with this id, or `npos`. */
    std::size_t indexOf (int sectionId) const;
    static constexpr std::size_t npos = static_cast<std::size_t> (-1);

    /** A point in the song, resolved through the arrangement. */
    struct Position
    {
        std::size_t section = 0;
        std::size_t pass = 0;
        double beatInSection = 0.0;
    };

    /** Where `beat` falls, wrapping on the song's length. */
    Position positionAt (double beat) const;

    /** The chord sounding at `beat`, wrapping on the song's length. */
    ChordSlot chordAt (double beat) const;

    /**
        One arrangement entry per section, in section order, keeping the
        repeats of entries that already exist.

        The default arrangement is "every section once, in order", so a song is
        playable the moment it has sections; an entry is never silently dropped
        from playback just because it is missing from `arrangement`.
    */
    void syncArrangement();

    /** Appends a section (all-default chords) and syncs the arrangement. */
    std::size_t addSection (const juce::String& name);

    /** Copies a section, including its chords, and syncs. */
    std::size_t duplicateSection (std::size_t index);

    /** Removes a section and any arrangement pass that pointed at it. */
    void removeSection (std::size_t index);

    /** Moves a section within the list, keeping ids and arrangement intact. */
    void moveSection (std::size_t from, std::size_t to);

    /** Appends one pass of a section to the end of the arrangement, up to
        `maxPasses`. */
    bool appendPass (std::size_t sectionIndex);

    /** Changes how many passes an arrangement entry covers (clamped, >= 1). */
    void setRepeats (std::size_t passIndex, int repeats);

    /** Removes a pass. The last one stays: an arrangement with no passes is a
        song that plays nothing, and there would be nothing left to click. */
    bool removePass (std::size_t passIndex);

private:
    int nextId = 1;
};

/**
    A song flattened into the chord cycle the scheduler plays.

    Built when the song changes — not once per audio block — so the audio thread
    only reads a finished list. `entries` keeps its capacity across rebuilds,
    which is why this is a member of the processor rather than a temporary.
*/
class SongCycle final : public ChordCycle
{
public:
    void rebuild (const Song& song);

    double lengthInBeats() const noexcept override { return length; }
    std::size_t slotCount() const noexcept override { return entries.size(); }
    double startBeatOf (std::size_t index) const noexcept override;
    const ChordSlot& slotAt (std::size_t index) const noexcept override;

    /** What is playing at a song position (wraps): the section, the slot
        inside that section, and which arrangement pass it belongs to. */
    struct Playing
    {
        std::size_t section = 0;
        std::size_t slot = 0;
        std::size_t pass = 0;
    };

    Playing playingAt (double beat) const;

private:
    struct Entry
    {
        double startBeat = 0.0;
        std::size_t section = 0;
        std::size_t slotInSection = 0;
        std::size_t pass = 0;
        ChordSlot slot;
    };

    std::vector<Entry> entries;
    double length = 0.0;
};
} // namespace td
