#pragma once

#include "Progression.h"

#include <juce_core/juce_core.h>

namespace td
{
/**
    The one writer and reader of a progression's XML form.

    Plugin state and preset files both go through here, so a progression saved
    inside a session and one saved as a preset cannot disagree about what the
    fields mean. Kept out of `Progression` itself so the data type stays free of
    JUCE and the console tests can hold it without an application instance.
*/
juce::XmlElement toXml (const Progression& progression, const juce::String& tagName);

/** Reads a progression, leaving `fallback` untouched when the XML is unusable. */
bool fromXml (const juce::XmlElement& xml, Progression& target);
} // namespace td
