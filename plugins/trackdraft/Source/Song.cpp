#include "Song.h"

#include <algorithm>
#include <cmath>

namespace td
{
namespace
{
double beatsOf (const Progression& progression) noexcept
{
    return std::max (0.0, progression.lengthInBeats());
}
} // namespace

double Song::sectionBeats (std::size_t index) const
{
    if (index >= sections.size())
        return 0.0;
    return beatsOf (sections[index].progression);
}

std::size_t Song::indexOf (int sectionId) const
{
    for (std::size_t i = 0; i < sections.size(); ++i)
        if (sections[i].id == sectionId)
            return i;

    return npos;
}

double Song::totalBeats() const
{
    double total = 0.0;
    for (const auto& pass : arrangement)
    {
        const auto index = indexOf (pass.sectionId);
        if (index == npos)
            continue;
        total += sectionBeats (index) * (double) std::max (1, pass.repeats);
    }

    return total;
}

Song::Position Song::positionAt (double beat) const
{
    Position position;

    const double total = totalBeats();
    if (total <= 0.0 || sections.empty())
        return position;

    // A host that keeps rolling past the end repeats the form, which is what a
    // DAW loop does with a shorter cycle anyway.
    double cursor = std::fmod (std::max (0.0, beat), total);

    for (std::size_t i = 0; i < arrangement.size(); ++i)
    {
        const auto& pass = arrangement[i];
        const auto index = indexOf (pass.sectionId);
        if (index == npos)
            continue;

        const double length = sectionBeats (index);
        const double span = length * (double) std::max (1, pass.repeats);
        if (span <= 0.0)
            continue;

        if (cursor < span)
        {
            position.section = index;
            position.pass = i;
            position.beatInSection = length > 0.0 ? std::fmod (cursor, length) : 0.0;
            return position;
        }

        cursor -= span;
    }

    // Only reachable through rounding at the very end of the song.
    const auto last = arrangement.empty() ? npos : indexOf (arrangement.back().sectionId);
    if (last != npos)
    {
        position.section = last;
        position.pass = arrangement.size() - 1;
    }

    return position;
}

ChordSlot Song::chordAt (double beat) const
{
    const auto position = positionAt (beat);
    if (position.section >= sections.size())
        return {};

    const auto& progression = sections[position.section].progression;
    return progression.slots[progression.slotAtBeat (position.beatInSection)];
}

void Song::syncArrangement()
{
    std::vector<Pass> synced;
    synced.reserve (sections.size() + arrangement.size());

    // Keep the order the songwriter chose, and the repeats they set, but never
    // keep a pass that points at a section that no longer exists.
    for (const auto& pass : arrangement)
        if (indexOf (pass.sectionId) != npos)
            synced.push_back (pass);

    for (const auto& section : sections)
    {
        const bool covered = std::any_of (synced.begin(), synced.end(),
                                          [&section] (const Pass& pass)
                                          { return pass.sectionId == section.id; });
        if (! covered)
            synced.push_back ({ section.id, 1 });
    }

    arrangement = std::move (synced);
}

std::size_t Song::addSection (const juce::String& name)
{
    if (sections.size() >= maxSections)
        return npos;

    Section section;
    section.id = nextId++;
    section.name = name.trim().isEmpty() ? juce::String ("Section") : name.trim();
    sections.push_back (section);
    syncArrangement();

    return sections.size() - 1;
}

std::size_t Song::duplicateSection (std::size_t index)
{
    if (index >= sections.size() || sections.size() >= maxSections)
        return npos;

    auto copy = sections[index];
    copy.id = nextId++;
    copy.name = copy.name + " 2";
    sections.insert (sections.begin() + (std::ptrdiff_t) index + 1, copy);
    syncArrangement();

    return index + 1;
}

void Song::removeSection (std::size_t index)
{
    if (index >= sections.size())
        return;

    sections.erase (sections.begin() + (std::ptrdiff_t) index);
    syncArrangement();
}

void Song::moveSection (std::size_t from, std::size_t to)
{
    if (from >= sections.size() || to >= sections.size() || from == to)
        return;

    const auto moved = sections[from];
    // The arrangement names sections by id, so reordering the list cannot
    // change what plays — only where it appears in the editor.
    sections.erase (sections.begin() + (std::ptrdiff_t) from);
    sections.insert (sections.begin() + (std::ptrdiff_t) to, moved);
}

bool Song::appendPass (std::size_t sectionIndex)
{
    if (sectionIndex >= sections.size() || arrangement.size() >= maxPasses)
        return false;

    arrangement.push_back ({ sections[sectionIndex].id, 1 });
    return true;
}

void Song::setRepeats (std::size_t passIndex, int repeats)
{
    if (passIndex >= arrangement.size())
        return;

    arrangement[passIndex].repeats = juce::jlimit (1, maxRepeats, repeats);
}

bool Song::removePass (std::size_t passIndex)
{
    if (passIndex >= arrangement.size() || arrangement.size() <= 1)
        return false;

    arrangement.erase (arrangement.begin() + (std::ptrdiff_t) passIndex);
    return true;
}

//==== SongCycle =============================================================

void SongCycle::rebuild (const Song& song)
{
    entries.clear();
    length = 0.0;

    double cursor = 0.0;
    for (std::size_t passIndex = 0; passIndex < song.arrangement.size(); ++passIndex)
    {
        const auto& pass = song.arrangement[passIndex];
        const auto index = song.indexOf (pass.sectionId);
        if (index == Song::npos)
            continue;

        const auto& progression = song.sections[index].progression;
        const int repeats = juce::jmax (1, pass.repeats);

        for (int repeat = 0; repeat < repeats; ++repeat)
        {
            for (std::size_t slot = 0; slot < progression.count; ++slot)
            {
                const double beats = std::max (0.0, progression.slots[slot].beats);
                if (beats <= 0.0)
                    continue;

                entries.push_back ({ cursor, index, slot, passIndex,
                                     progression.slots[slot], progression.bass });
                cursor += beats;
            }
        }
    }

    length = cursor;
}

double SongCycle::startBeatOf (std::size_t index) const noexcept
{
    return index < entries.size() ? entries[index].startBeat : 0.0;
}

const ChordSlot& SongCycle::slotAt (std::size_t index) const noexcept
{
    static const ChordSlot empty;
    return index < entries.size() ? entries[index].slot : empty;
}

const BassLine& SongCycle::bassAt (std::size_t index) const noexcept
{
    // The section this slot belongs to, so a bass voice follows its own section
    // across every pass of it.
    static const BassLine none;
    return index < entries.size() ? entries[index].bass : none;
}

SongCycle::Playing SongCycle::playingAt (double beat) const
{
    Playing playing;
    if (entries.empty() || length <= 0.0)
        return playing;

    const double position = std::fmod (std::max (0.0, beat), length);

    for (std::size_t i = 0; i < entries.size(); ++i)
    {
        const double end = i + 1 < entries.size() ? entries[i + 1].startBeat : length;
        if (position < end)
        {
            playing.section = entries[i].section;
            playing.slot = entries[i].slotInSection;
            playing.pass = entries[i].pass;
            playing.beatInSlot = position - entries[i].startBeat;
            return playing;
        }
    }

    playing.section = entries.back().section;
    playing.slot = entries.back().slotInSection;
    playing.pass = entries.back().pass;
    return playing;
}
} // namespace td
