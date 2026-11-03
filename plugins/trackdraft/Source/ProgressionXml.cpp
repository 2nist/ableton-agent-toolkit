#include "ProgressionXml.h"

#include <algorithm>

namespace td
{
namespace
{
/** The app's `BassMotion` ids, as they appear in the file. */
const char* idOf (BassMotion motion)
{
    switch (motion)
    {
        case BassMotion::root: return "root";
        case BassMotion::rootFifth: return "root_fifth";
        case BassMotion::walking: return "walking";
    }

    return "root";
}

BassMotion motionOf (const juce::String& id)
{
    if (id == "root_fifth") return BassMotion::rootFifth;
    if (id == "walking") return BassMotion::walking;
    return BassMotion::root;
}

const char* idOf (BassRhythm rhythm)
{
    switch (rhythm)
    {
        case BassRhythm::locked: return "locked";
        case BassRhythm::half: return "half";
        case BassRhythm::eighth: return "eighth";
    }

    return "locked";
}

BassRhythm rhythmOf (const juce::String& id)
{
    if (id == "half") return BassRhythm::half;
    if (id == "eighth") return BassRhythm::eighth;
    return BassRhythm::locked;
}
} // namespace

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

        // Root position, close, is the default and stays unspoken, so a file
        // written before voicings existed is byte-identical to one written now.
        if (slot.voicing.inversion != 0)
            element->setAttribute ("inversion", slot.voicing.inversion);
        if (slot.voicing.open)
            element->setAttribute ("spread", "open");

        // Sixteen digits, one per sixteenth: 0 silent, 1 ghost, 2 normal,
        // 3 accent. Absent means the slot has no pattern of its own.
        if (slot.rhythm.enabled)
            element->setAttribute ("rhythm", juce::String (slot.rhythm.toDigits()));
    }

    // Modulations inside the section, in the order they take effect.
    for (const auto& region : progression.regions)
    {
        auto* element = xml.createNewChildElement ("region");
        element->setAttribute ("from", region.startBeat);
        element->setAttribute ("key", region.keyPc);
        element->setAttribute ("scale", theory::idOf (region.scale));
    }

    // A section with no bass voice writes nothing, so a progression from before
    // the voice existed stays byte-identical to one written now.
    if (progression.bass.enabled)
    {
        auto* element = xml.createNewChildElement ("bass");
        element->setAttribute ("octave", progression.bass.octave);
        element->setAttribute ("motion", idOf (progression.bass.motion));
        element->setAttribute ("rhythm", idOf (progression.bass.rhythm));
        element->setAttribute ("velocity", progression.bass.velocity);
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
        // The inversion wraps to the chord's size, so the bound only has to keep
        // the file honest; the spread is the app's "close"/"open" pair.
        slot.voicing.inversion = juce::jlimit (0, 15, element->getIntAttribute ("inversion", 0));
        slot.voicing.open = element->getStringAttribute ("spread", "close") == "open";

        // A malformed grid leaves the slot with no pattern rather than a
        // half-read one: sixteen digits of 0-3, or nothing.
        if (element->hasAttribute ("rhythm"))
        {
            RhythmPattern pattern;
            if (RhythmPattern::fromDigits (element->getStringAttribute ("rhythm").toStdString(),
                                           pattern))
                slot.rhythm = pattern;
        }

        loaded.slots[(std::size_t) index] = slot;
        ++index;
    }

    if (index == 0)
        return false;

    // Regions are read in file order and sorted, so a hand-edited file that
    // lists them out of order still resolves the way the app does.
    for (auto* element : slots->getChildIterator())
    {
        if (! element->hasTagName ("region"))
            continue;

        TonicRegion region;
        region.startBeat = juce::jmax (0.0, element->getDoubleAttribute ("from", 0.0));
        region.keyPc = ((element->getIntAttribute ("key", 0) % 12) + 12) % 12;

        const auto id = element->getStringAttribute ("scale", "ionian");
        for (int mode = 0; mode <= (int) theory::Scale::locrian; ++mode)
            if (id == theory::idOf ((theory::Scale) mode))
                region.scale = (theory::Scale) mode;

        loaded.regions.push_back (region);
    }

    std::sort (loaded.regions.begin(), loaded.regions.end(),
               [] (const TonicRegion& a, const TonicRegion& b)
               { return a.startBeat < b.startBeat; });

    // The bass voice is a section setting that rides inside the progression, so
    // a preset carries it too.
    if (const auto* bass = slots->getChildByName ("bass"))
    {
        loaded.bass.enabled = true;
        loaded.bass.octave = juce::jlimit (0, 8, bass->getIntAttribute ("octave", 3));
        loaded.bass.motion = motionOf (bass->getStringAttribute ("motion", "root"));
        loaded.bass.rhythm = rhythmOf (bass->getStringAttribute ("rhythm", "locked"));
        loaded.bass.velocity = juce::jlimit (1, 127, bass->getIntAttribute ("velocity", 100));
    }

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

        // Only a section that modulates says anything: an absent key means the
        // song's, which is the plug-in's own parameter.
        if (section.hasKey)
            element->setAttribute ("key", section.keyPc);
        if (section.hasScale)
            element->setAttribute ("scale", theory::idOf (section.scale));
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
        bool hasKey = false;
        int keyPc = 0;
        bool hasScale = false;
        theory::Scale scale = theory::Scale::ionian;
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

        if (element->hasAttribute ("key"))
        {
            entry.hasKey = true;
            entry.keyPc = ((element->getIntAttribute ("key", 0) % 12) + 12) % 12;
        }

        if (element->hasAttribute ("scale"))
        {
            const auto id = element->getStringAttribute ("scale");
            for (int mode = 0; mode <= (int) theory::Scale::locrian; ++mode)
            {
                if (id == theory::idOf ((theory::Scale) mode))
                {
                    entry.hasScale = true;
                    entry.scale = (theory::Scale) mode;
                    break;
                }
            }
        }
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
        section.hasKey = entry.hasKey;
        section.keyPc = entry.keyPc;
        section.hasScale = entry.hasScale;
        section.scale = entry.scale;
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
