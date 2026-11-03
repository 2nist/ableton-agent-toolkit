#include "ChordImport.h"

#include "../Theory/ChordRecognition.h"

#include <juce_audio_basics/juce_audio_basics.h>

#include <algorithm>
#include <cmath>
#include <vector>

namespace td
{
namespace
{
constexpr int maxImportedSlots = (int) Progression::maxSlots;

/** Harte quality token -> our vocabulary. Unknown tokens fall back to major. */
theory::Quality qualityFromToken (juce::String token)
{
    token = token.trim().toLowerCase();

    // Tensions in parentheses are dropped: "maj(9)" is a maj chord with an
    // added ninth, and the slot vocabulary has no "maj(add9)" spelling.
    const int paren = token.indexOfChar ('(');
    if (paren >= 0)
        token = token.substring (0, paren);

    if (token.isEmpty() || token == "maj" || token == "major") return theory::Quality::maj;
    if (token == "min" || token == "m" || token == "minor") return theory::Quality::min;
    if (token == "dim") return theory::Quality::dim;
    if (token == "aug" || token == "+") return theory::Quality::aug;
    if (token == "sus2") return theory::Quality::sus2;
    if (token == "sus4" || token == "sus") return theory::Quality::sus4;
    if (token == "5" || token == "power") return theory::Quality::five;
    if (token == "6") return theory::Quality::six;
    if (token == "min6" || token == "m6") return theory::Quality::min6;
    if (token == "69" || token == "6/9") return theory::Quality::sixNine;
    if (token == "add9") return theory::Quality::add9;
    if (token == "7" || token == "dom7") return theory::Quality::seven;
    if (token == "maj7" || token == "M7") return theory::Quality::maj7;
    if (token == "min7" || token == "m7" || token == "min7th") return theory::Quality::min7;
    if (token == "dim7" || token == "o7") return theory::Quality::dim7;
    if (token == "hdim7" || token == "m7b5" || token == "min7b5") return theory::Quality::m7b5;
    if (token == "mmaj7" || token == "minmaj7" || token == "mM7") return theory::Quality::mMaj7;
    if (token == "maj7#5" || token == "maj7+5") return theory::Quality::maj7Sharp5;
    if (token == "7sus4") return theory::Quality::sevenSus4;
    if (token == "7b5" || token == "7-5") return theory::Quality::sevenFlat5;
    if (token == "7#5" || token == "aug7" || token == "7+5") return theory::Quality::sevenSharp5;
    if (token == "9") return theory::Quality::nine;
    if (token == "maj9") return theory::Quality::maj9;
    if (token == "min9" || token == "m9") return theory::Quality::min9;
    if (token == "9sus4") return theory::Quality::nineSus4;
    if (token == "7b9") return theory::Quality::sevenFlat9;
    if (token == "7#9") return theory::Quality::sevenSharp9;
    if (token == "7#11") return theory::Quality::sevenSharp11;
    if (token == "7b13") return theory::Quality::sevenFlat13;
    if (token == "11") return theory::Quality::eleven;
    if (token == "min11" || token == "m11") return theory::Quality::min11;
    if (token == "13") return theory::Quality::thirteen;
    if (token == "maj13") return theory::Quality::maj13;
    if (token == "min13" || token == "m13") return theory::Quality::min13;

    return theory::Quality::maj;
}

int pitchClassFromToken (juce::String token)
{
    static const int naturalPc[] = { 0, 2, 4, 5, 7, 9, 11 };  // C D E F G A B
    static const char letters[] = { 'C', 'D', 'E', 'F', 'G', 'A', 'B' };

    token = token.trim();
    if (token.isEmpty())
        return -1;

    // Case matters for the accidental, not for the letter: Harte writes "Bb"
    // (B flat) and "B" (B natural). Uppercasing first would erase the flat.
    const auto letter = juce::CharacterFunctions::toUpperCase (token[0]);
    int index = -1;
    for (int i = 0; i < 7; ++i)
        if (letters[i] == letter)
            index = i;

    if (index < 0)
        return -1;

    int pc = naturalPc[index];
    for (int i = 1; i < token.length(); ++i)
    {
        if (token[i] == '#')
            ++pc;
        else if (token[i] == 'b')
            --pc;
    }

    return ((pc % 12) + 12) % 12;
}

struct RawChord
{
    double seconds = 0.0;
    int rootPc = 0;
    theory::Quality quality = theory::Quality::maj;
};

/** Merges repeats, caps the slot count, and turns seconds into beats. */
Progression buildProgression (std::vector<RawChord> chords, double secondsPerBeat,
                              juce::String& notes)
{
    Progression progression;
    if (chords.empty())
        return progression;

    std::sort (chords.begin(), chords.end(),
               [] (const RawChord& a, const RawChord& b) { return a.seconds < b.seconds; });

    // Drop repeats: a corpus annotates a held chord once per segment.
    std::vector<RawChord> changes;
    for (const auto& chord : chords)
        if (changes.empty() || changes.back().rootPc != chord.rootPc
            || changes.back().quality != chord.quality)
            changes.push_back (chord);

    const int total = (int) changes.size();
    if (total > maxImportedSlots)
        notes << "kept the first " << maxImportedSlots << " of " << total << " chord changes; ";

    progression.count = (std::size_t) juce::jmin (total, maxImportedSlots);

    for (std::size_t i = 0; i < progression.count; ++i)
    {
        const double start = changes[i].seconds;
        const double end = i + 1 < (std::size_t) total ? changes[i + 1].seconds
                                                       : start + 4.0 * secondsPerBeat;
        const double beats = juce::jlimit (0.5, 16.0, (end - start) / secondsPerBeat);

        ChordSlot slot;
        slot.rootPc = changes[i].rootPc;
        slot.quality = changes[i].quality;
        slot.beats = std::round (beats * 2.0) / 2.0;
        progression.slots[i] = slot;
    }

    return progression;
}

double bpmFromJson (const juce::var& root)
{
    if (auto* object = root.getDynamicObject())
    {
        for (const auto& key : { "bpm", "tempo", "tempo_bpm" })
        {
            const auto value = object->getProperty (key);
            if (value.isDouble() || value.isInt())
            {
                const double bpm = (double) value;
                if (bpm > 20.0 && bpm < 400.0)
                    return bpm;
            }
        }

        // JAMS keeps tempo in a separate annotation namespace; the first
        // `tempo` annotation's first value is good enough for a chord map.
        const auto annotations = object->getProperty ("annotations");
        if (auto* list = annotations.getArray())
            for (const auto& annotation : *list)
                if (auto* entry = annotation.getDynamicObject())
                    if (entry->getProperty ("namespace").toString().containsIgnoreCase ("tempo"))
                        if (auto* data = entry->getProperty ("data").getArray())
                            if (! data->isEmpty())
                                if (auto* first = data->getFirst().getDynamicObject())
                                {
                                    const auto value = first->getProperty ("value");
                                    if ((value.isDouble() || value.isInt())
                                        && (double) value > 20.0 && (double) value < 400.0)
                                        return (double) value;
                                }
    }

    return 120.0;
}

void readEntry (const juce::var& entry, std::vector<RawChord>& out)
{
    double seconds = -1.0;
    juce::String label;

    if (auto* object = entry.getDynamicObject())
    {
        for (const auto& key : { "time", "start", "start_time", "timestamp" })
        {
            const auto value = object->getProperty (key);
            if (value.isDouble() || value.isInt())
            {
                seconds = (double) value;
                break;
            }
        }

        for (const auto& key : { "chord", "value", "label", "chord_label" })
        {
            const auto value = object->getProperty (key).toString();
            if (value.isNotEmpty())
            {
                label = value;
                break;
            }
        }
    }
    else if (auto* array = entry.getArray())
    {
        if (array->size() >= 2)
        {
            seconds = (double) array->getReference (0);
            label = array->getReference (1).toString();
        }
    }

    if (seconds < 0.0 || label.isEmpty())
        return;

    int rootPc = 0;
    theory::Quality quality = theory::Quality::maj;
    if (! parseChordLabel (label, rootPc, quality))
        return;

    out.push_back ({ seconds, rootPc, quality });
}
} // namespace

bool parseChordLabel (const juce::String& rawLabel, int& rootPc, theory::Quality& quality)
{
    auto label = rawLabel.trim();

    // `N` (no chord) and the empty label are rests, not chords.
    if (label.isEmpty() || label.equalsIgnoreCase ("N") || label == "X")
        return false;

    // Strip a leading quality-less Harte annotation like "C" (root only) and a
    // slash bass, which the slot model cannot store.
    const int slash = label.indexOfChar ('/');
    if (slash > 0)
        label = label.substring (0, slash);

    const int colon = label.indexOfChar (':');
    const auto rootText = colon >= 0 ? label.substring (0, colon) : label;
    const auto qualityText = colon >= 0 ? label.substring (colon + 1) : juce::String();

    const int pc = pitchClassFromToken (rootText);
    if (pc < 0)
        return false;

    rootPc = pc;
    quality = qualityFromToken (qualityText);
    return true;
}

ImportedProgression importProgressionFromJson (const juce::File& file, theory::Scale, int)
{
    ImportedProgression result;

    if (! file.existsAsFile())
    {
        result.message = "No file at " + file.getFullPathName();
        return result;
    }

    const auto parsed = juce::JSON::parse (file.loadFileAsString());
    if (parsed.isVoid())
    {
        result.message = "Not valid JSON: " + file.getFileName();
        return result;
    }

    std::vector<RawChord> chords;
    juce::Array<juce::var>* entries = nullptr;

    if (auto* object = parsed.getDynamicObject())
    {
        const auto annotations = object->getProperty ("annotations");
        if (auto* list = annotations.getArray())
        {
            // JAMS: take the chord namespace, preferring Harte.
            for (const auto& annotation : *list)
            {
                auto* entry = annotation.getDynamicObject();
                if (entry == nullptr)
                    continue;

                const auto nameSpace = entry->getProperty ("namespace").toString();
                if (! nameSpace.containsIgnoreCase ("chord"))
                    continue;

                if (auto* data = entry->getProperty ("data").getArray())
                    for (const auto& item : *data)
                        readEntry (item, chords);

                if (! chords.empty())
                    break;
            }
        }

        if (chords.empty())
            if (auto* list = object->getProperty ("chords").getArray())
                entries = list;

        if (chords.empty() && entries == nullptr)
            if (auto* list = object->getProperty ("segments").getArray())
                entries = list;
    }
    else if (auto* list = parsed.getArray())
    {
        entries = list;
    }

    if (entries != nullptr)
        for (const auto& item : *entries)
            readEntry (item, chords);

    if (chords.empty())
    {
        result.message = "No chord annotations found in " + file.getFileName();
        return result;
    }

    const double secondsPerBeat = 60.0 / bpmFromJson (parsed);

    juce::String notes;
    result.progression = buildProgression (chords, secondsPerBeat, notes);
    result.ok = result.progression.count > 0;
    result.message = "Imported " + juce::String ((int) result.progression.count) + " chords from "
                     + file.getFileName() + (notes.isNotEmpty() ? " (" + notes.trimCharactersAtEnd ("; ")
                                                                     + ")"
                                                               : juce::String());
    return result;
}

ImportedProgression importProgressionFromMidi (const juce::File& file, theory::Scale scale, int)
{
    ImportedProgression result;

    juce::MidiFile midi;
    {
        juce::FileInputStream stream (file);
        if (! stream.openedOk() || ! midi.readFrom (stream))
        {
            result.message = "Not a readable MIDI file: " + file.getFileName();
            return result;
        }
    }

    // Seconds, including the file's tempo map, so a chord's length is musical
    // rather than a tick count.
    midi.convertTimestampTicksToSeconds();

    double bpm = 120.0;
    for (int track = 0; track < midi.getNumTracks(); ++track)
    {
        const auto* sequence = midi.getTrack (track);
        for (int event = 0; event < sequence->getNumEvents(); ++event)
        {
            const auto message = sequence->getEventPointer (event)->message;
            if (message.isTempoMetaEvent())
            {
                bpm = 60.0 / juce::jmax (1e-6, message.getTempoSecondsPerQuarterNote());
                break;
            }
        }
    }

    const double secondsPerBeat = 60.0 / bpm;

    struct Note
    {
        double start = 0.0;
        double end = 0.0;
        int pitch = 0;
    };
    std::vector<Note> notes;

    for (int track = 0; track < midi.getNumTracks(); ++track)
    {
        const auto* sequence = midi.getTrack (track);
        std::vector<std::pair<int, Note>> open;

        for (int event = 0; event < sequence->getNumEvents(); ++event)
        {
            const auto message = sequence->getEventPointer (event)->message;
            const double time = message.getTimeStamp();

            if (message.isNoteOn())
            {
                open.emplace_back (message.getNoteNumber(), Note { time, -1.0, message.getNoteNumber() });
            }
            else if (message.isNoteOff())
            {
                for (auto it = open.begin(); it != open.end(); ++it)
                {
                    if (it->first != message.getNoteNumber())
                        continue;
                    auto note = it->second;
                    note.end = time;
                    notes.push_back (note);
                    open.erase (it);
                    break;
                }
            }
        }

        for (auto& [pitch, note] : open)
        {
            note.end = note.start + 1.0;
            notes.push_back (note);
        }
    }

    if (notes.empty())
    {
        result.message = "No notes in " + file.getFileName();
        return result;
    }

    const auto qualityVocabulary = theory::diatonicQualities (scale);

    std::vector<RawChord> chords;
    const double barSeconds = 4.0 * secondsPerBeat;

    double lastEnd = 0.0;
    for (const auto& note : notes)
        lastEnd = juce::jmax (lastEnd, note.end);

    RecognizeOptions options;
    options.permitted = qualityVocabulary;
    bool hasPrevious = false;
    int previousRoot = 0;
    theory::Quality previousQuality = theory::Quality::maj;

    for (double barStart = 0.0; barStart < lastEnd; barStart += barSeconds)
    {
        const double barEnd = barStart + barSeconds;

        std::vector<int> sounding;
        int lowest = 128;
        for (const auto& note : notes)
        {
            if (note.start < barEnd && note.end > barStart)
            {
                sounding.push_back (note.pitch);
                lowest = juce::jmin (lowest, note.pitch);
            }
        }

        if (sounding.size() < 2)
            continue;

        options.bassPc = ((lowest % 12) + 12) % 12;
        options.hasPrevious = hasPrevious;
        options.previousRootPc = previousRoot;
        options.previousQuality = previousQuality;

        const auto recognized = recognizeChordFromNotes (sounding, options);
        if (! recognized.valid)
            continue;

        // A bar that names the same chord again is the same chord held.
        if (chords.empty() || chords.back().rootPc != recognized.rootPc
            || chords.back().quality != recognized.quality)
            chords.push_back ({ barStart, recognized.rootPc, recognized.quality });

        hasPrevious = true;
        previousRoot = recognized.rootPc;
        previousQuality = recognized.quality;
    }

    if (chords.empty())
    {
        result.message = "Could not name a chord in " + file.getFileName();
        return result;
    }

    // Bar-quantised: one chord per change, four beats unless repeats collapsed.
    juce::String notes2;
    for (auto& chord : chords)
        chord.seconds *= secondsPerBeat;  // buildProgression consumes seconds

    Progression progression;
    progression.count = (std::size_t) juce::jmin ((int) chords.size(), maxImportedSlots);
    for (std::size_t i = 0; i < progression.count; ++i)
    {
        ChordSlot slot;
        slot.rootPc = chords[i].rootPc;
        slot.quality = chords[i].quality;
        slot.beats = 4.0;
        progression.slots[i] = slot;
    }

    if ((int) chords.size() > maxImportedSlots)
        notes2 << "kept the first " << maxImportedSlots << " of " << (int) chords.size()
               << " chord changes; ";

    result.progression = progression;
    result.ok = true;
    result.message = "Imported " + juce::String ((int) progression.count) + " chords from "
                     + file.getFileName()
                     + (notes2.isNotEmpty() ? " (" + notes2.trimCharactersAtEnd ("; ") + ")"
                                            : juce::String());
    return result;
}

ImportedProgression importProgressionFromFile (const juce::File& file, theory::Scale scale,
                                               int keyPc)
{
    const auto extension = file.getFileExtension().toLowerCase();

    if (extension == ".mid" || extension == ".midi")
        return importProgressionFromMidi (file, scale, keyPc);

    if (extension == ".json" || extension == ".jams")
        return importProgressionFromJson (file, scale, keyPc);

    ImportedProgression result;
    result.message = "Unsupported file type: " + file.getFileName()
                     + " (expected .mid, .midi, .json or .jams)";
    return result;
}
} // namespace td
