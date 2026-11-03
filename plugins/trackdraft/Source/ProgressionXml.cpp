#include "ProgressionXml.h"

#include <algorithm>

namespace td
{
juce::XmlElement toXml (const Progression& progression, const juce::String& tagName)
{
    juce::XmlElement xml (tagName);
    xml.setAttribute ("version", 1);
    xml.setAttribute ("count", (int) progression.count);

    for (std::size_t i = 0; i < progression.count && i < Progression::maxSlots; ++i)
    {
        const auto& slot = progression.slots[i];
        auto* element = xml.createNewChildElement ("slot");
        element->setAttribute ("root", slot.rootPc);
        element->setAttribute ("quality", theory::idOf (slot.quality));
        element->setAttribute ("beats", slot.beats);
        element->setAttribute ("performance", (int) slot.performance);
        element->setAttribute ("param", slot.param);
        element->setAttribute ("direction", slot.direction);
    }

    return xml;
}

bool fromXml (const juce::XmlElement& xml, Progression& target)
{
    const auto* slots = xml.getChildByName ("progression");
    if (slots == nullptr)
        slots = &xml;

    int count = slots->getIntAttribute ("count", -1);
    if (count < 0)
        count = slots->getNumChildElements();

    if (count <= 0)
        return false;

    Progression loaded;
    loaded.count = (std::size_t) juce::jlimit (1, (int) Progression::maxSlots, count);

    int index = 0;
    for (auto* element : slots->getChildIterator())
    {
        if (index >= (int) loaded.count)
            break;
        if (! element->hasTagName ("slot"))
            continue;

        const auto qualityId = element->getStringAttribute ("quality", "maj");
        theory::Quality quality = theory::Quality::maj;
        for (const auto& candidate : theory::qualities())
            if (qualityId == candidate.id)
                quality = candidate.quality;

        ChordSlot slot;
        slot.rootPc = juce::jlimit (0, 11, element->getIntAttribute ("root", 0));
        slot.quality = quality;
        slot.beats = juce::jmax (0.25, element->getDoubleAttribute ("beats", 4.0));
        slot.performance = (Performance) juce::jlimit (
            0, 3, element->getIntAttribute ("performance", 0));
        // param means milliseconds for a strum and a subdivision for pulse/arp,
        // so the file's bound has to admit the widest of those.
        slot.param = juce::jlimit (0, 2000, element->getIntAttribute ("param", 0));
        slot.direction = juce::jlimit (0, 2, element->getIntAttribute ("direction", 2));

        loaded.slots[(std::size_t) index] = slot;
        ++index;
    }

    if (index == 0)
        return false;

    target = loaded;
    return true;
}
juce::XmlElement toXml (const Song& song, const juce::String& tagName)
{
    juce::XmlElement xml (tagName);
    xml.setAttribute ("version", 2);
    xml.setAttribute ("count", (int) song.sections.size());

    // Sections are written in authoring order; the arrangement names them by
    // that position, which is enough for a file that is read back as one piece.
    for (const auto& section : song.sections)
    {
        auto* element = xml.createNewChildElement ("section");
        element->setAttribute ("name", section.name);
        element->addChildElement (
            new juce::XmlElement (toXml (section.progression, "progression")));
    }

    auto* arrangement = xml.createNewChildElement ("arrangement");
    for (const auto& pass : song.arrangement)
    {
        const auto index = song.indexOf (pass.sectionId);
        if (index == Song::npos)
            continue;

        auto* element = arrangement->createNewChildElement ("pass");
        element->setAttribute ("section", (int) index);
        element->setAttribute ("repeats", juce::jmax (1, pass.repeats));
    }

    return xml;
}

bool fromXml (const juce::XmlElement& xml, Song& target)
{
    const auto* sections = xml.getChildByName ("sections");

    // A single progression is a legitimate song: presets are written that way,
    // and so were sessions before songs existed.
    if (sections == nullptr && xml.getChildByName ("section") == nullptr)
    {
        Progression only;
        if (! fromXml (xml, only))
            return false;

        Song song;
        Song::Section section;
        section.id = 1;
        section.name = xml.getStringAttribute ("name", "Section");
        section.progression = only;
        song.sections.push_back (section);
        song.syncArrangement();

        target = std::move (song);
        return true;
    }

    const juce::XmlElement* list = sections != nullptr ? sections : &xml;

    struct Loaded
    {
        juce::String name;
        Progression progression;
    };

    std::vector<Loaded> loaded;
    for (auto* element : list->getChildIterator())
    {
        if (! element->hasTagName ("section"))
            continue;
        if (loaded.size() >= Song::maxSections)
            break;

        Loaded entry;
        entry.name = element->getStringAttribute (
            "name", juce::String ("Section ") + juce::String ((int) loaded.size() + 1));
        // A section whose chords will not parse keeps its place with the default
        // progression: dropping it would silently renumber every later section
        // and misalign the arrangement that refers to them.
        fromXml (*element, entry.progression);
        loaded.push_back (std::move (entry));
    }

    if (loaded.empty())
        return false;

    Song song;
    for (auto& entry : loaded)
    {
        Song::Section section;
        section.id = (int) song.sections.size() + 1;
        section.name = entry.name;
        section.progression = entry.progression;
        song.sections.push_back (section);
    }

    // The arrangement points at section positions; anything out of range or
    // unreadable is dropped rather than guessed at.
    const auto* arrangement = xml.getChildByName ("arrangement");
    const auto* passes = arrangement != nullptr ? arrangement : xml.getChildByName ("passes");

    if (passes != nullptr)
    {
        for (auto* element : passes->getChildIterator())
        {
            if (! element->hasTagName ("pass"))
                continue;

            const int index = element->getIntAttribute ("section", -1);
            if (index < 0 || (std::size_t) index >= song.sections.size())
                continue;

            song.arrangement.push_back (
                { song.sections[(std::size_t) index].id,
                  juce::jlimit (1, Song::maxRepeats, element->getIntAttribute ("repeats", 1)) });
        }
    }

    song.syncArrangement();
    target = std::move (song);
    return true;
}
} // namespace td
