#include "ProgressionXml.h"

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
} // namespace td
