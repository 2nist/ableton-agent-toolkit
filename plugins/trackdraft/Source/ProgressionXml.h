#pragma once

#include "Progression.h"
#include "Song.h"

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

/**
    A whole song: `<section>` elements in authoring order, plus the
    `<arrangement>` list of passes over them.

    Sections are named by index in the file (they have no persistent identity
    outside a session), and the arrangement refers to those indices.
*/
juce::XmlElement toXml (const Song& song, const juce::String& tagName);

/** Reads a song. A bare progression — a preset, or a session written before
    songs existed — loads as a song with one section. */
bool fromXml (const juce::XmlElement& xml, Song& target);
} // namespace td
