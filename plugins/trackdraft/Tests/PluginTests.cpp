#include "ChordScheduler.h"
#include "Progression.h"
#include "Theory/ChordTheory.h"

#include <juce_audio_basics/juce_audio_basics.h>

#include <iostream>
#include <vector>

/**
    Console tests for the parts that decide what the host hears: the theory
    tables, the progression cycle, and the note scheduling rules.

    Run: cmake --build build --target TrackDraftTests && ./build/TrackDraftTests_artefacts/TrackDraftTests
    Exits non-zero on the first failure so CI can gate on it.
*/
namespace
{
int failures = 0;

void check (bool condition, const juce::String& what)
{
    if (! condition)
    {
        ++failures;
        std::cerr << "FAIL: " << what << std::endl;
    }
}

void checkEqual (int actual, int expected, const juce::String& what)
{
    check (actual == expected, what + " (expected " + juce::String (expected)
                                   + ", got " + juce::String (actual) + ")");
}

void checkEqual (const juce::String& actual, const juce::String& expected, const juce::String& what)
{
    check (actual == expected, what + " (expected '" + expected + "', got '" + actual + "')");
}

/** Intervals for a quality, as the app's CHORD_INTERVALS row. */
juce::String intervalRow (td::theory::Quality quality)
{
    juce::StringArray parts;
    for (int interval : td::theory::intervalsOf (quality))
        parts.add (juce::String (interval));
    return parts.joinIntoString (",");
}

void testTheoryParity()
{
    using namespace td::theory;

    // Values pasted from packages/music-theory/src/chords.ts (CHORD_INTERVALS).
    checkEqual (intervalRow (Quality::maj), "0,4,7", "maj intervals");
    checkEqual (intervalRow (Quality::min), "0,3,7", "min intervals");
    checkEqual (intervalRow (Quality::m7b5), "0,3,6,10", "m7b5 intervals");
    checkEqual (intervalRow (Quality::maj7), "0,4,7,11", "maj7 intervals");
    checkEqual (intervalRow (Quality::eleven), "0,7,10,14,17", "11 intervals");
    checkEqual (intervalRow (Quality::thirteen), "0,4,7,10,14,21", "13 intervals");
    checkEqual (intervalRow (Quality::min13), "0,3,7,10,14,21", "m13 intervals");

    checkEqual (juce::String (suffixOf (Quality::m7b5)), juce::String ("m7\u266d5"), "m7b5 suffix");
    checkEqual (juce::String (idOf (Quality::sevenSharp9)), juce::String ("7#9"), "7#9 id");

    checkEqual (qualities().size(), (size_t) 34, "quality count");

    // Naming, matching chordName() in the app.
    checkEqual (juce::String (chordName (0, Quality::maj7)), juce::String ("Cmaj7"), "C maj7 name");
    const auto flatName = juce::String (chordName (10, Quality::min));
    check (flatName.length() == 3 && flatName[0] == 'B'
               && flatName[1] == juce::juce_wchar (0x266d) && flatName[2] == 'm',
           "Bb collapsed to name '" + flatName + "'");

    // The fifth is optional on a seventh chord and not on a triad.
    check (qualities()[(size_t) Quality::maj7].optional == std::vector<int> { 2 },
           "maj7 optional tone is the fifth");
    check (def (Quality::maj).optional.empty(), "a triad has no optional tone");
}

void testDiatonicVocabulary()
{
    using namespace td::theory;

    const auto major = diatonicQualities (Scale::ionian);
    const auto has = [&major] (Quality q)
    {
        return std::find (major.begin(), major.end(), q) != major.end();
    };

    check (has (Quality::maj) && has (Quality::min) && has (Quality::dim), "major has triad qualities");
    check (has (Quality::maj7) && has (Quality::min7) && has (Quality::seven) && has (Quality::m7b5),
           "major has seventh qualities");

    const auto minor = diatonicQualities (Scale::aeolian);
    check (std::find (minor.begin(), minor.end(), Quality::mMaj7) == minor.end(),
           "aeolian has no mMaj7");

    // Every mode's vocabulary must be non-empty and duplicate-free.
    for (int i = 0; i <= (int) Scale::locrian; ++i)
    {
        const auto qualities = diatonicQualities ((Scale) i);
        check (! qualities.empty(), juce::String ("vocabulary for ") + idOf ((Scale) i));
        check (std::set<Quality> (qualities.begin(), qualities.end()).size() == qualities.size(),
               juce::String ("no duplicate qualities in ") + idOf ((Scale) i));
    }
}

void testProgressionCycle()
{
    td::Progression progression;
    progression.count = 3;
    progression.slots[0] = { 0, td::theory::Quality::maj, 4.0 };
    progression.slots[1] = { 5, td::theory::Quality::maj, 4.0 };
    progression.slots[2] = { 7, td::theory::Quality::seven, 4.0 };

    checkEqual ((int) progression.lengthInBeats(), 12, "cycle length");
    checkEqual ((int) progression.startBeatOf (0), 0, "slot 0 starts at 0");
    checkEqual ((int) progression.startBeatOf (2), 8, "slot 2 starts at 8");
    checkEqual ((int) progression.slotAtBeat (0.0), 0, "beat 0 is slot 0");
    checkEqual ((int) progression.slotAtBeat (4.5), 1, "beat 4.5 is slot 1");
    checkEqual ((int) progression.slotAtBeat (11.9), 2, "beat 11.9 is slot 2");

    td::Progression seeded;
    seeded.seedFromScale (0, td::theory::Scale::ionian, 4);
    checkEqual ((int) seeded.count, 4, "seeded slot count");
    checkEqual (seeded.slots[0].rootPc, 0, "seeded slot 0 root");
    checkEqual (seeded.slots[1].rootPc, 2, "seeded slot 1 root is the second degree");
    checkEqual (juce::String (td::theory::idOf (seeded.slots[1].quality)), juce::String ("min7"),
                "seeded ii is a minor seventh");
}

int countNotes (const juce::MidiBuffer& buffer, bool noteOn)
{
    int total = 0;
    for (const auto metadata : buffer)
    {
        const auto message = metadata.getMessage();
        if (message.isNoteOn() == noteOn && (noteOn || message.isNoteOff()))
            ++total;
    }
    return total;
}

void testScheduler()
{
    td::Progression progression;
    progression.count = 2;
    progression.slots[0] = { 0, td::theory::Quality::maj, 4.0 };
    progression.slots[1] = { 5, td::theory::Quality::maj, 4.0 };

    td::VoiceSettings settings;
    settings.octave = 4;
    settings.velocity = 90;
    settings.gate = 1.0;
    settings.enabled = true;

    // A stopped transport generates nothing.
    {
        td::ChordScheduler scheduler;
        juce::MidiBuffer out;
        scheduler.process (out, { false, 0.0, 1.0 }, progression, settings, 512);
        checkEqual (out.getNumEvents(), 0, "stopped transport emits nothing");
    }

    // The downbeat of the cycle emits the first chord: C E G at octave 4.
    {
        td::ChordScheduler scheduler;
        juce::MidiBuffer out;
        scheduler.process (out, { true, 0.0, 1.0 }, progression, settings, 512);
        checkEqual (countNotes (out, true), 3, "first chord is three notes");

        std::vector<int> notes;
        for (const auto metadata : out)
            if (metadata.getMessage().isNoteOn())
                notes.push_back (metadata.getMessage().getNoteNumber());
        std::sort (notes.begin(), notes.end());
        check (notes == std::vector<int> { 60, 64, 67 }, "C major at octave 4 is 60/64/67");
    }

    // Crossing the second slot's boundary releases the first chord and starts
    // the second, within one block.
    {
        td::ChordScheduler scheduler;
        juce::MidiBuffer out;
        scheduler.process (out, { true, 0.0, 1.0 }, progression, settings, 512);
        out.clear();
        scheduler.process (out, { true, 3.0, 5.0 }, progression, settings, 1024);

        check (countNotes (out, false) >= 3, "the first chord is released at the boundary");
        check (countNotes (out, true) == 3, "the second chord starts once");

        std::vector<int> notes;
        for (const auto metadata : out)
            if (metadata.getMessage().isNoteOn())
                notes.push_back (metadata.getMessage().getNoteNumber());
        std::sort (notes.begin(), notes.end());
        check (notes == std::vector<int> { 65, 69, 72 }, "F major at octave 4 is 65/69/72");
    }

    // Stopping the transport puts every generated note back off.
    {
        td::ChordScheduler scheduler;
        juce::MidiBuffer out;
        scheduler.process (out, { true, 0.0, 1.0 }, progression, settings, 512);
        out.clear();
        scheduler.process (out, { false, 1.0, 2.0 }, progression, settings, 512);
        checkEqual (countNotes (out, false), 3, "stop releases all three notes");
        check (scheduler.activeNotes().empty(), "no notes stay active after a stop");
    }

    // A host loop that jumps backwards restarts the cycle instead of hanging.
    {
        td::ChordScheduler scheduler;
        juce::MidiBuffer out;
        scheduler.process (out, { true, 8.0, 9.0 }, progression, settings, 512);
        out.clear();
        scheduler.process (out, { true, 0.0, 1.0 }, progression, settings, 512);
        check (countNotes (out, false) >= 3, "backwards jump releases the ringing chord");
        checkEqual (countNotes (out, true), 3, "and restarts the first chord");
    }

    // Gate below 1.0 ends the chord early, and the note-offs still arrive.
    {
        td::Progression shortGate = progression;
        td::VoiceSettings gated = settings;
        gated.gate = 0.5;

        td::ChordScheduler scheduler;
        juce::MidiBuffer out;
        scheduler.process (out, { true, 0.0, 1.0 }, shortGate, gated, 512);
        out.clear();
        scheduler.process (out, { true, 1.9, 2.1 }, shortGate, gated, 512);
        check (countNotes (out, false) >= 3, "gate closes the chord without a boundary");
    }

    // Disabling emission mid-cycle stops the notes.
    {
        td::VoiceSettings disabled = settings;
        disabled.enabled = false;

        td::ChordScheduler scheduler;
        juce::MidiBuffer out;
        scheduler.process (out, { true, 0.0, 1.0 }, progression, settings, 512);
        out.clear();
        scheduler.process (out, { true, 1.0, 2.0 }, progression, disabled, 512);
        checkEqual (countNotes (out, false), 3, "disabling releases the chord");
    }
}
} // namespace

int main()
{
    testTheoryParity();
    testDiatonicVocabulary();
    testProgressionCycle();
    testScheduler();

    if (failures == 0)
    {
        std::cout << "TrackDraftTests: all checks passed" << std::endl;
        return 0;
    }

    std::cerr << "TrackDraftTests: " << failures << " check(s) failed" << std::endl;
    return 1;
}
