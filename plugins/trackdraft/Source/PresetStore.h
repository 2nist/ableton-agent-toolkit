#pragma once

#include "Progression.h"

#include <juce_core/juce_core.h>

namespace td
{
/**
    Named progressions on disk.

    One XML file per preset under the user's application data directory, in the
    same shape the plug-in uses for session state (`ProgressionXml`), so a preset
    is readable, diffable and portable between the app and the plug-in later.

    Names are user text: they are sanitised to a filename, never trusted as a
    path, and never allowed to escape the preset directory.
*/
class PresetStore
{
public:
    explicit PresetStore (juce::File directoryToUse = defaultDirectory());

    /** User-level directory: ~/Library/Application Support/TrackDraft/Presets,
        or the platform equivalent. */
    static juce::File defaultDirectory();

    juce::File directory() const { return folder; }

    /** Preset names, sorted, without the extension. */
    juce::StringArray names() const;

    /** Writes `progression` under `name`; false and a reason when it cannot. */
    bool save (const juce::String& name, const Progression& progression, juce::String& error);

    /** Reads `name`; leaves `target` alone and sets `error` when it cannot. */
    bool load (const juce::String& name, Progression& target, juce::String& error);

    /** Renames a preset; false and a reason when either end is unusable. */
    bool rename (const juce::String& from, const juce::String& to, juce::String& error);

    /** Deletes a preset. Missing is reported rather than ignored. */
    bool remove (const juce::String& name, juce::String& error);

    /** Filename for a user-supplied preset name. */
    static juce::String sanitiseName (const juce::String& name);

    /** Progressions that ship with the plug-in: one per mode, plus the two
        borrowings every songwriter reaches for. Not files, so they cannot be
        renamed or deleted by accident. */
    struct Factory
    {
        juce::String name;
        Progression progression;
    };
    static std::vector<Factory> factories();

private:
    juce::File fileFor (const juce::String& name) const;

    juce::File folder;
};
} // namespace td
