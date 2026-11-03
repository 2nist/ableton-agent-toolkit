#include "PresetStore.h"
#include "ProgressionXml.h"

#include <algorithm>

namespace td
{
PresetStore::PresetStore (juce::File directoryToUse) : folder (std::move (directoryToUse)) {}

juce::File PresetStore::defaultDirectory()
{
    return juce::File::getSpecialLocation (juce::File::userApplicationDataDirectory)
        .getChildFile ("TrackDraft")
        .getChildFile ("Presets");
}

namespace
{
/** Characters a file name cannot safely carry: separators, the set Windows
    reserves, and control characters. Everything else is left alone so a name
    stays recognisable — "Café Minor" must not become "Caf Minor".
*/
bool isUnsafeInFileName (juce::juce_wchar character) noexcept
{
    return character < 0x20 || character == 0x7f
        || juce::String ("/\\:*?\"<>|").containsChar (character);
}
} // namespace

juce::String PresetStore::sanitiseName (const juce::String& name)
{
    // A preset name is typed by a person, so it may contain anything. Never let
    // it define where the file goes.
    //
    // This is deliberately not a "letters and digits" allow-list: JUCE's Unicode
    // letter test goes through `iswalnum`, which follows the C locale, and a host
    // may or may not have called `setlocale`. The same name would then sanitise
    // differently in different DAWs, and two files would exist for one name.
    juce::String cleaned;

    for (auto character : name.trim())
        if (! isUnsafeInFileName (character))
            cleaned << juce::String::charToString (character);

    // Truncate by character, not by code unit, so a surrogate pair is never cut
    // in half. The renderer and the main process mirror this rule; keep it simple.
    cleaned = cleaned.trim();
    juce::String shortened;
    int count = 0;
    for (auto character : cleaned)
    {
        if (count++ == 64)
            break;
        shortened << juce::String::charToString (character);
    }

    cleaned = shortened;
    while (cleaned.startsWithChar ('.'))
        cleaned = cleaned.substring (1);
    while (cleaned.endsWithChar ('.'))
        cleaned = cleaned.dropLastCharacters (1);

    return cleaned.isEmpty() ? juce::String ("Untitled") : cleaned;
}

juce::File PresetStore::fileFor (const juce::String& name) const
{
    return folder.getChildFile (sanitiseName (name) + ".tdp.xml");
}

bool PresetStore::rename (const juce::String& from, const juce::String& to, juce::String& error)
{
    const auto source = fileFor (from);
    if (! source.existsAsFile())
    {
        error = "No preset named " + from;
        return false;
    }

    const auto target = fileFor (to);
    if (target.existsAsFile())
    {
        error = "A preset named " + to + " already exists";
        return false;
    }

    if (! source.moveFileTo (target))
    {
        error = "Cannot rename " + source.getFileName();
        return false;
    }

    return true;
}

bool PresetStore::remove (const juce::String& name, juce::String& error)
{
    const auto file = fileFor (name);
    if (! file.existsAsFile())
    {
        error = "No preset named " + name;
        return false;
    }

    if (! file.deleteFile())
    {
        error = "Cannot delete " + file.getFileName();
        return false;
    }

    return true;
}

std::vector<PresetStore::Factory> PresetStore::factories()
{
    std::vector<Factory> list;

    for (int mode = 0; mode <= (int) theory::Scale::locrian; ++mode)
    {
        Progression seeded;
        seeded.seedFromScale (0, (theory::Scale) mode, 4);
        list.push_back ({ juce::String ("Factory: ") + theory::displayNameOf ((theory::Scale) mode),
                          seeded });
    }

    // The two mixture moves that open most borrowed-chord songs: bVI-bVII-I in
    // major, and its inverse in minor.
    {
        Progression borrowed;
        borrowed.count = 3;
        borrowed.slots[0] = { 8, theory::Quality::maj, 4.0 };
        borrowed.slots[1] = { 10, theory::Quality::maj, 4.0 };
        borrowed.slots[2] = { 0, theory::Quality::maj, 4.0 };
        list.push_back ({ "Factory: bVI - bVII - I", borrowed });
    }
    {
        Progression borrowed;
        borrowed.count = 4;
        borrowed.slots[0] = { 0, theory::Quality::min, 4.0 };
        borrowed.slots[1] = { 5, theory::Quality::min, 4.0 };
        borrowed.slots[2] = { 8, theory::Quality::maj, 4.0 };
        borrowed.slots[3] = { 7, theory::Quality::seven, 4.0 };
        list.push_back ({ "Factory: i - iv - bVI - V", borrowed });
    }

    return list;
}

juce::StringArray PresetStore::names() const
{
    juce::StringArray found;

    if (! folder.isDirectory())
        return found;

    for (const auto& entry : juce::RangedDirectoryIterator (folder, false, "*.tdp.xml"))
        found.add (entry.getFile().getFileNameWithoutExtension().upToLastOccurrenceOf (".tdp", false, false));

    found.sort (true);
    return found;
}

bool PresetStore::save (const juce::String& name, const Progression& progression,
                        juce::String& error)
{
    const auto result = folder.createDirectory();
    if (result.failed())
    {
        error = "Cannot create " + folder.getFullPathName() + ": " + result.getErrorMessage();
        return false;
    }

    const auto file = fileFor (name);
    if (! file.replaceWithText (toXml (progression, "TrackDraftPreset").toString()))
    {
        error = "Cannot write " + file.getFullPathName();
        return false;
    }

    return true;
}

bool PresetStore::load (const juce::String& name, Progression& target, juce::String& error)
{
    const auto file = fileFor (name);
    if (! file.existsAsFile())
    {
        error = "No preset named " + name;
        return false;
    }

    const auto xml = juce::XmlDocument::parse (file);
    if (xml == nullptr)
    {
        error = "Preset is not valid XML: " + file.getFileName();
        return false;
    }

    if (! fromXml (*xml, target))
    {
        error = "Preset has no usable slots: " + file.getFileName();
        return false;
    }

    return true;
}
} // namespace td
