#include "ChordScheduler.h"
#include "Progression.h"
#include "Song.h"
#include "Theory/ChordRecognition.h"
#include "Theory/ChordTheory.h"
#include "Performance.h"
#include "Import/ChordImport.h"
#include "PresetStore.h"
#include "ProgressionXml.h"
#include "Theory/ChordWalk.h"

#include <juce_audio_basics/juce_audio_basics.h>

#include <cmath>
#include <iostream>
#include <set>
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
int checks = 0;

void check (bool condition, const juce::String& what)
{
    ++checks;

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

void testWalk()
{
    using namespace td::theory;

    // From the tonic of a major key, the six hex neighbours are the six other
    // degrees — every one exactly once. That is the property the app's
    // (3q + r) mod 7 grid gives, and the reason a walk never dead-ends.
    const auto neighbours = td::neighboursOf (Scale::ionian, 0);

    std::set<int> degrees;
    for (const auto& neighbour : neighbours)
        degrees.insert (neighbour.degree);

    checkEqual ((int) degrees.size(), 6, "six distinct neighbour degrees");
    check (degrees.find (0) == degrees.end(), "the tonic is not its own neighbour");

    checkEqual (juce::String (neighbours[0].label), juce::String ("IVmaj7"), "first neighbour is IV");
    checkEqual (juce::String (neighbours[1].label), juce::String ("V7"), "second neighbour is V");

    // Every neighbour is a real, in-key chord: its root offset is in the scale.
    const auto& steps = scaleIntervals (Scale::ionian);
    for (const auto& neighbour : neighbours)
        check (std::find (steps.begin(), steps.end(), neighbour.rootOffset) != steps.end(),
               "neighbour root is in the key");

    // Stepping +3 mod 7 visits every degree before returning: gcd(3, 7) = 1,
    // so the walk is a full 7-cycle, which is why it never dead-ends.
    std::set<int> visited;
    int degree = 0;
    for (int i = 0; i < 7; ++i)
    {
        visited.insert (degree);
        degree = td::nextAlongWalk (Scale::ionian, degree).degree;
    }
    checkEqual ((int) visited.size(), 7, "the walk visits every degree");
    checkEqual (degree, 0, "seven walk steps return to the start");
}

void testRecognition()
{
    using namespace td::theory;

    // The same expectations as apps/trackdraft/src/lib/harmony/chordRecognition.test.ts.
    const auto plain = td::recognizeChord ({ 0, 4, 7 });
    check (plain.valid, "a plain triad is named");
    checkEqual (plain.rootPc, 0, "plain triad root");
    checkEqual (juce::String (idOf (plain.quality)), juce::String ("maj"), "plain triad quality");
    check (std::abs (plain.score - 1.0) < 1e-9, "a complete triad scores 1");

    checkEqual (juce::String (idOf (td::recognizeChord ({ 0, 4, 7, 11 }).quality)),
                juce::String ("maj7"), "maj7 is named");
    checkEqual (juce::String (idOf (td::recognizeChord ({ 0, 3, 7, 10 }).quality)),
                juce::String ("min7"), "min7 is named");

    // Root-3-7 only: the fifth is a tone the quality can do without.
    const auto rootless = td::recognizeChord ({ 0, 4, 11 });
    checkEqual (juce::String (idOf (rootless.quality)), juce::String ("maj7"),
                "a maj7 without its fifth is still a maj7");
    check (rootless.missing.size() == 1, "and it reports the omitted tone");

    // A single note is not a chord.
    check (! td::recognizeChord ({ 0 }).valid, "one pitch class is not a chord");

    // Bass decides an inversion.
    const auto inverted = td::recognizeChordFromNotes ({ 52, 55, 60 });
    checkEqual (inverted.rootPc, 0, "E-G-C reads as C major");
    checkEqual (juce::String (idOf (inverted.quality)), juce::String ("maj"), "and stays major");

    // C E G A is both C6 and Am7; the vocabulary decides.
    td::RecognizeOptions sixOnly;
    sixOnly.permitted = { Quality::six };
    checkEqual (juce::String (idOf (td::recognizeChord ({ 0, 4, 7, 9 }, sixOnly).quality)),
                juce::String ("6"), "permitted 6 picks C6");

    td::RecognizeOptions min7Only;
    min7Only.permitted = { Quality::min7 };
    const auto asAm7 = td::recognizeChord ({ 0, 4, 7, 9 }, min7Only);
    checkEqual (asAm7.rootPc, 9, "permitted min7 picks Am7");
    checkEqual (juce::String (idOf (asAm7.quality)), juce::String ("min7"), "and its quality");

    // A borrowed chord the key cannot explain is still named.
    td::RecognizeOptions inKey;
    inKey.permitted = diatonicQualities (Scale::ionian);
    const auto borrowed = td::recognizeChord ({ 8, 0, 3 }, inKey);
    checkEqual (borrowed.rootPc, 8, "bVI is named against the key");
    checkEqual (juce::String (idOf (borrowed.quality)), juce::String ("maj"), "bVI is major");

    // An extension outside the key is still reachable.
    checkEqual (juce::String (idOf (td::recognizeChord ({ 0, 4, 7, 10, 2, 9 }).quality)),
                juce::String ("13"), "C13 is named");

    // The previous chord is a prior, not a straitjacket.
    td::RecognizeOptions prior;
    prior.hasPrevious = true;
    prior.previousRootPc = 0;
    prior.previousQuality = Quality::maj7;
    const auto primed = td::recognizeChord ({ 0, 4, 11 }, prior);
    checkEqual (juce::String (idOf (primed.quality)), juce::String ("maj7"),
                "the prior keeps a maj7 reading");
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

void testArticulation()
{
    using namespace td::theory;

    // Block: every tone at the same instant, all sounding for the gate.
    td::PerformanceSettings block;
    const auto blockEvents = td::shapeChord (60, Quality::maj, 4.0, 100, block);
    checkEqual ((int) blockEvents.size(), 3, "a blocked triad is three events");
    for (const auto& event : blockEvents)
        check (std::abs (event.offsetBeats) < 1e-9, "blocked notes start together");

    // Strum: the app's 150 ms default is a 0.3-beat spread, split across gaps.
    td::PerformanceSettings strum;
    strum.kind = td::Performance::strum;
    const auto strumEvents = td::shapeChord (60, Quality::maj, 4.0, 100, strum);
    checkEqual ((int) strumEvents.size(), 3, "a strummed triad is three events");
    check (strumEvents[0].offsetBeats < strumEvents[1].offsetBeats
               && strumEvents[1].offsetBeats < strumEvents[2].offsetBeats,
           "strummed notes are staggered low to high");
    check (std::abs (strumEvents.back().offsetBeats - 0.3) < 0.05,
           "the last note lands on the documented 0.3-beat stagger");
    check (strumEvents.back().durationBeats > 0.0, "a strummed note still has duration");

    // Pulse: subdivision hits, and the velocity breathes instead of being flat.
    td::PerformanceSettings pulse;
    pulse.kind = td::Performance::pulse;
    pulse.param = 4;
    const auto pulseEvents = td::shapeChord (60, Quality::maj, 4.0, 100, pulse);
    checkEqual ((int) pulseEvents.size(), 12, "4 subdivisions x 3 tones");
    check (std::abs (pulseEvents[3].offsetBeats - 1.0) < 1e-9, "second pulse is a beat later");
    bool velocitiesDiffer = false;
    for (const auto& event : pulseEvents)
        velocitiesDiffer = velocitiesDiffer || event.velocity != pulseEvents[0].velocity;
    check (velocitiesDiffer, "pulse accents vary");

    // Arp: one tone at a time, up by default, down when asked.
    td::PerformanceSettings arp;
    arp.kind = td::Performance::arp;
    arp.param = 6;
    arp.direction = 0;
    const auto upEvents = td::shapeChord (60, Quality::maj, 4.0, 100, arp);
    checkEqual ((int) upEvents.size(), 6, "6 arp steps");
    check (upEvents[0].note < upEvents[1].note && upEvents[1].note < upEvents[2].note,
           "an up arp rises");

    auto down = arp;
    down.direction = 1;
    const auto downEvents = td::shapeChord (60, Quality::maj, 4.0, 100, down);
    check (downEvents[0].note > downEvents[1].note, "a down arp falls");

    // A slot carries its articulation through to the scheduler's settings.
    td::ChordSlot slot;
    slot.performance = td::Performance::arp;
    slot.param = 8;
    slot.direction = 1;
    const auto settings = slot.articulation (0.9);
    checkEqual ((int) settings.kind, (int) td::Performance::arp, "slot articulation kind");
    checkEqual (settings.param, 8, "slot articulation param");
}

void testBorrowedChords()
{
    using namespace td::theory;

    const auto borrowed = td::Progression::borrowedChords (Scale::ionian);
    check (! borrowed.empty(), "a major key can borrow");

    const auto has = [&borrowed] (int rootOffset, Quality quality)
    {
        return std::any_of (borrowed.begin(), borrowed.end(),
                            [rootOffset, quality] (const td::Progression::Borrowed& chord)
                            { return chord.rootPc == rootOffset && chord.quality == quality; });
    };

    // The ones a songwriter reaches for: bIII, iv, bVI, bVII from the parallel
    // minor, and the major IV of dorian is already diatonic so it must not
    // appear twice.
    check (has (3, Quality::maj), "bIII is offered");
    check (has (5, Quality::min), "minor iv is offered");
    check (has (8, Quality::maj), "bVI is offered");
    check (has (10, Quality::maj), "bVII is offered");

    // Nothing already in the key, and no duplicates.
    std::set<std::pair<int, int>> seen;
    for (const auto& chord : borrowed)
    {
        const bool duplicatesEntry = ! seen.insert ({ chord.rootPc, (int) chord.quality }).second;
        check (! duplicatesEntry, "no duplicate borrowed chord");

        for (int degree = 0; degree < 7; ++degree)
        {
            const auto diatonic = diatonicChordAt (Scale::ionian, degree);
            check (! (diatonic.rootOffset == chord.rootPc && diatonic.quality == chord.quality),
                   "a borrowed chord is not already diatonic");
        }
    }
}

void testReorderAndApplyAll()
{
    td::Progression progression;
    progression.count = 4;
    for (int i = 0; i < 4; ++i)
        progression.slots[(std::size_t) i] = { i, td::theory::Quality::maj, 4.0 };

    // Moving forward shifts the slots it passes back by one.
    progression.moveSlot (0, 2);
    checkEqual (progression.slots[0].rootPc, 1, "moveSlot forward: first is the old second");
    checkEqual (progression.slots[1].rootPc, 2, "moveSlot forward: second is the old third");
    checkEqual (progression.slots[2].rootPc, 0, "moveSlot forward: target is the moved slot");

    // Moving backward shifts the slots it passes forward by one.
    progression.moveSlot (3, 1);
    checkEqual (progression.slots[1].rootPc, 3, "moveSlot backward: target is the moved slot");
    checkEqual (progression.slots[2].rootPc, 2, "moveSlot backward: the rest shift up");

    // Out-of-range and no-op moves leave the progression alone.
    const auto before = progression;
    progression.moveSlot (0, 0);
    progression.moveSlot (9, 1);
    check (progression.slots[0] == before.slots[0], "a no-op or out-of-range move changes nothing");

    // Articulation can be applied to the whole progression from one slot.
    progression.count = 3;
    progression.slots[1].performance = td::Performance::arp;
    progression.slots[1].param = 6;
    progression.slots[1].direction = 1;
    progression.slots[0].performance = td::Performance::block;
    progression.applyArticulationToAll (1);

    for (std::size_t i = 0; i < progression.count; ++i)
    {
        checkEqual ((int) progression.slots[i].performance, (int) td::Performance::arp,
                    "articulation applied to every slot");
        checkEqual (progression.slots[i].param, 6, "param applied to every slot");
        checkEqual (progression.slots[i].direction, 1, "direction applied to every slot");
    }

    // It must not touch the chords themselves.
    checkEqual (progression.slots[2].rootPc, 2, "applying articulation leaves the chords alone");
}

void testProgressionXml()
{
    td::Progression original;
    original.count = 3;
    original.slots[0] = { 0, td::theory::Quality::maj7, 4.0, td::Performance::strum, 150, 2 };
    original.slots[1] = { 5, td::theory::Quality::min, 2.0, td::Performance::pulse, 4, 2 };
    original.slots[2] = { 7, td::theory::Quality::seven, 8.0, td::Performance::arp, 8, 1 };

    const auto xml = td::toXml (original, "TrackDraftHarmony");
    const auto text = xml.toString();

    auto roundTripped = juce::XmlDocument::parse (text);
    check (roundTripped != nullptr, "progression XML parses");

    td::Progression read;
    check (td::fromXml (*roundTripped, read), "progression XML reads back");
    checkEqual ((int) read.count, 3, "slot count round-trips");

    for (std::size_t i = 0; i < original.count; ++i)
    {
        check (read.slots[i] == original.slots[i],
               "slot " + juce::String ((int) i) + " round-trips exactly");
    }

    // An unrecognised quality id falls back to major instead of failing the load.
    juce::XmlElement odd ("TrackDraftPreset");
    odd.setAttribute ("count", 1);
    auto* slot = odd.createNewChildElement ("slot");
    slot->setAttribute ("root", 3);
    slot->setAttribute ("quality", "not-a-quality");
    slot->setAttribute ("beats", 4.0);

    td::Progression oddRead;
    check (td::fromXml (odd, oddRead), "unknown quality still loads");
    checkEqual ((int) oddRead.slots[0].quality, (int) td::theory::Quality::maj,
                "unknown quality falls back to major");

    // XML with no slots is refused rather than producing an empty progression.
    juce::XmlElement empty ("TrackDraftPreset");
    empty.setAttribute ("count", 0);
    td::Progression untouched;
    const auto before = untouched;
    check (! td::fromXml (empty, untouched), "slotless XML is refused");
    check (untouched.slots[0] == before.slots[0], "and leaves the target untouched");
}

void testPresets()
{
    // A scratch directory, so the test never writes into the user's presets.
    auto scratch = juce::File::getSpecialLocation (juce::File::tempDirectory)
                       .getChildFile ("trackdraft-preset-test-" + juce::String (juce::Random::getSystemRandom().nextInt (100000)));
    scratch.deleteRecursively();

    td::PresetStore store (scratch);

    td::Progression progression;
    progression.count = 2;
    progression.slots[0] = { 0, td::theory::Quality::maj, 4.0 };
    progression.slots[1] = { 9, td::theory::Quality::min7, 4.0, td::Performance::strum, 200, 2 };

    juce::String error;
    check (store.save ("My Song", progression, error), "a preset saves: " + error);
    check (scratch.isDirectory(), "the preset directory is created");

    const auto names = store.names();
    checkEqual (names.size(), 1, "one preset is listed");
    checkEqual (names[0], juce::String ("My Song"), "the preset keeps its human name");

    td::Progression loaded;
    check (store.load ("My Song", loaded, error), "the preset loads: " + error);
    checkEqual ((int) loaded.count, 2, "loaded slot count");
    check (loaded.slots[1] == progression.slots[1], "loaded slot matches what was saved");

    // A name is user text: it must never escape the preset directory.
    const auto sanitised = td::PresetStore::sanitiseName ("../../etc/passwd");
    check (! sanitised.contains ("/") && ! sanitised.contains (".."),
           "path traversal is stripped from a preset name");
    checkEqual (td::PresetStore::sanitiseName (juce::String::repeatedString ("A", 100)).length(),
                64, "a very long preset name is truncated");

    td::PresetStore guarded (scratch);
    check (guarded.save ("../../escaped", progression, error), "an unsafe name still saves");
    const auto files = scratch.findChildFiles (juce::File::findFiles, false, "*.tdp.xml");
    for (const auto& file : files)
        checkEqual (file.getParentDirectory().getFullPathName(), scratch.getFullPathName(),
                    "every preset file stays in the preset directory");

    // A missing preset is a clean failure, not a crash or an empty progression.
    td::Progression untouched;
    const auto before = untouched;
    check (! store.load ("No Such Preset", untouched, error), "a missing preset fails");
    check (error.isNotEmpty(), "and reports why");
    check (untouched.slots[0] == before.slots[0], "and leaves the target untouched");

    scratch.deleteRecursively();
}

void testChordLabels()
{
    // Harte syntax, which is what every MIR chord corpus writes.
    struct Case
    {
        const char* label;
        int rootPc;
        td::theory::Quality quality;
    };
    const Case cases[] = {
        { "C:maj", 0, td::theory::Quality::maj },
        { "A:min", 9, td::theory::Quality::min },
        { "F#:min7", 6, td::theory::Quality::min7 },
        { "Bb:maj7", 10, td::theory::Quality::maj7 },
        { "G:7", 7, td::theory::Quality::seven },
        { "B:hdim7", 11, td::theory::Quality::m7b5 },
        { "Eb:dim7", 3, td::theory::Quality::dim7 },
        { "D:sus4", 2, td::theory::Quality::sus4 },
        { "C:maj/3", 0, td::theory::Quality::maj },   // slash bass dropped
        { "C:maj(9)", 0, td::theory::Quality::maj },  // tension dropped
        { "F", 5, td::theory::Quality::maj },         // root only
    };

    for (const auto& testCase : cases)
    {
        int rootPc = -1;
        td::theory::Quality quality = td::theory::Quality::min;
        const bool parsed = td::parseChordLabel (testCase.label, rootPc, quality);
        check (parsed, juce::String ("parses ") + testCase.label);
        checkEqual (rootPc, testCase.rootPc, juce::String ("root of ") + testCase.label);
        checkEqual ((int) quality, (int) testCase.quality,
                    juce::String ("quality of ") + testCase.label);
    }

    // "N" is a rest, not a chord.
    int rootPc = 0;
    td::theory::Quality quality = td::theory::Quality::maj;
    check (! td::parseChordLabel ("N", rootPc, quality), "N is not a chord");
    check (! td::parseChordLabel ("", rootPc, quality), "an empty label is not a chord");
}

void testJsonImport()
{
    auto scratch = juce::File::getSpecialLocation (juce::File::tempDirectory)
                       .getChildFile ("trackdraft-import-test-" + juce::String (juce::Random::getSystemRandom().nextInt (100000)));
    scratch.createDirectory();

    // JAMS: the container ChordMini and the McGill/Isophonics exports use.
    const auto jams = scratch.getChildFile ("song.jams");
    jams.replaceWithText (R"({
      "annotations": [
        { "namespace": "tempo", "data": [ { "time": 0.0, "value": 120.0 } ] },
        { "namespace": "chord", "data": [
            { "time": 0.0, "value": "C:maj" },
            { "time": 2.0, "value": "A:min" },
            { "time": 4.0, "value": "F:maj" },
            { "time": 6.0, "value": "G:7" }
        ] }
      ]
    })");

    const auto jamsResult = td::importProgressionFromFile (jams, td::theory::Scale::ionian, 0);
    check (jamsResult.ok, "JAMS imports: " + jamsResult.message);
    checkEqual ((int) jamsResult.progression.count, 4, "JAMS gives four chords");
    checkEqual (jamsResult.progression.slots[1].rootPc, 9, "JAMS second chord root");
    checkEqual ((int) jamsResult.progression.slots[3].quality, (int) td::theory::Quality::seven,
                "JAMS fourth chord quality");
    // Two seconds at 120 bpm is four beats.
    check (std::abs (jamsResult.progression.slots[0].beats - 4.0) < 1e-9, "JAMS timing becomes beats");

    // A plain array of [time, label] pairs.
    const auto plain = scratch.getChildFile ("plain.json");
    plain.replaceWithText (R"([[0.0, "C:maj7"], [4.0, "D:min7"]])");
    const auto plainResult = td::importProgressionFromFile (plain, td::theory::Scale::ionian, 0);
    check (plainResult.ok, "plain JSON imports: " + plainResult.message);
    checkEqual ((int) plainResult.progression.count, 2, "plain JSON gives two chords");
    checkEqual ((int) plainResult.progression.slots[0].quality, (int) td::theory::Quality::maj7,
                "plain JSON keeps the quality");

    // Repeats collapse, and the cap is reported rather than silent.
    const auto repeated = scratch.getChildFile ("repeats.json");
    juce::StringArray entries;
    for (int i = 0; i < 12; ++i)
        entries.add ("[" + juce::String (i * 2.0) + ", \"C:maj\"]");
    repeated.replaceWithText ("[" + entries.joinIntoString (",") + "]");
    const auto repeatedResult = td::importProgressionFromFile (repeated, td::theory::Scale::ionian, 0);
    check (repeatedResult.ok, "repeated chords import");
    checkEqual ((int) repeatedResult.progression.count, 1, "identical repeats collapse to one chord");

    // A file with no annotations fails cleanly.
    const auto empty = scratch.getChildFile ("empty.json");
    empty.replaceWithText ("{\"songs\": []}");
    const auto emptyResult = td::importProgressionFromFile (empty, td::theory::Scale::ionian, 0);
    check (! emptyResult.ok, "a JSON file without chords is refused");
    check (emptyResult.message.isNotEmpty(), "and says why");

    // Unsupported extensions are refused with the accepted list.
    const auto text = scratch.getChildFile ("notes.txt");
    text.replaceWithText ("hello");
    check (! td::importProgressionFromFile (text, td::theory::Scale::ionian, 0).ok,
           "an unsupported extension is refused");

    scratch.deleteRecursively();
}

void testMidiImport()
{
    auto scratch = juce::File::getSpecialLocation (juce::File::tempDirectory)
                       .getChildFile ("trackdraft-midi-test-" + juce::String (juce::Random::getSystemRandom().nextInt (100000)));
    scratch.createDirectory();

    // Four bars: C major, A minor, F major, G7 — the progression the importer
    // should read back. 480 ticks per quarter, 120 bpm: one bar = 1920 ticks.
    juce::MidiFile midi;
    midi.setTicksPerQuarterNote (480);

    juce::MidiMessageSequence track;
    track.addEvent (juce::MidiMessage::tempoMetaEvent (500000), 0);  // 120 bpm

    const int chords[4][4] = {
        { 60, 64, 67, -1 },
        { 57, 60, 64, -1 },
        { 53, 57, 60, -1 },
        { 55, 59, 62, 65 },
    };
    for (int bar = 0; bar < 4; ++bar)
    {
        const int startTick = bar * 1920;
        const int endTick = startTick + 1880;
        for (int voice = 0; voice < 4; ++voice)
        {
            const int note = chords[bar][voice];
            if (note < 0)
                continue;
            track.addEvent (juce::MidiMessage::noteOn (1, note, (juce::uint8) 90), startTick);
            track.addEvent (juce::MidiMessage::noteOff (1, note), endTick);
        }
    }

    track.updateMatchedPairs();
    midi.addTrack (track);

    const auto file = scratch.getChildFile ("progression.mid");
    {
        juce::FileOutputStream stream (file);
        check (stream.openedOk(), "the test MIDI file opens for writing");
        midi.writeTo (stream);
    }

    const auto result = td::importProgressionFromFile (file, td::theory::Scale::ionian, 0);
    check (result.ok, "MIDI imports: " + result.message);
    checkEqual ((int) result.progression.count, 4, "MIDI gives four bars of chords");
    checkEqual (result.progression.slots[0].rootPc, 0, "bar 1 is C");
    checkEqual (result.progression.slots[1].rootPc, 9, "bar 2 is A minor");
    checkEqual ((int) result.progression.slots[1].quality, (int) td::theory::Quality::min,
                "bar 2 is minor");
    checkEqual (result.progression.slots[2].rootPc, 5, "bar 3 is F");
    checkEqual ((int) result.progression.slots[3].quality, (int) td::theory::Quality::seven,
                "bar 4 is a dominant seventh");

    scratch.deleteRecursively();
}

void testPresetManagement()
{
    auto scratch = juce::File::getSpecialLocation (juce::File::tempDirectory)
                       .getChildFile ("trackdraft-preset-manage-" + juce::String (juce::Random::getSystemRandom().nextInt (100000)));
    scratch.deleteRecursively();

    td::PresetStore store (scratch);
    td::Progression progression;
    progression.count = 2;
    progression.slots[0] = { 0, td::theory::Quality::maj, 4.0 };
    progression.slots[1] = { 7, td::theory::Quality::seven, 4.0 };

    juce::String error;
    check (store.save ("First", progression, error), "save before rename: " + error);
    check (store.rename ("First", "Second", error), "rename succeeds: " + error);
    checkEqual (store.names().size(), 1, "one preset after rename");
    checkEqual (store.names()[0], juce::String ("Second"), "the new name is listed");

    td::Progression loaded;
    check (store.load ("Second", loaded, error), "the renamed preset loads");
    check (loaded.slots[1] == progression.slots[1], "renaming preserves the contents");

    // Renaming onto an existing name is refused rather than overwriting.
    check (store.save ("Third", progression, error), "save a second preset");
    check (! store.rename ("Third", "Second", error), "rename onto an existing name is refused");

    check (store.remove ("Second", error), "delete succeeds: " + error);
    checkEqual (store.names().size(), 1, "one preset after delete");
    check (! store.remove ("Second", error), "deleting a missing preset fails");

    // Factory presets are code, one per mode plus the mixture moves.
    const auto factories = td::PresetStore::factories();
    check (factories.size() >= 9, "factory presets exist");
    for (const auto& factory : factories)
        check (factory.progression.count > 0, "every factory preset has chords");

    scratch.deleteRecursively();
}

void testBorrowedScope()
{
    using namespace td::theory;

    // Mixture comes from the parallel mode: major borrows from minor and vice
    // versa, so the classic set appears and the exotic ones do not.
    const auto major = td::Progression::borrowedChords (Scale::ionian);
    const auto everyMode = td::Progression::borrowedChords (Scale::ionian, true);

    check (! major.empty(), "major has parallel borrowings");
    check (everyMode.size() > major.size(), "every-mode browsing is wider than mixture");

    const auto contains = [] (const std::vector<td::Progression::Borrowed>& list, int rootOffset,
                              Quality quality)
    {
        return std::any_of (list.begin(), list.end(),
                            [rootOffset, quality] (const td::Progression::Borrowed& chord)
                            { return chord.rootPc == rootOffset && chord.quality == quality; });
    };

    check (contains (major, 8, Quality::maj), "bVI is a mixture chord");
    check (contains (major, 10, Quality::maj), "bVII is a mixture chord");
    check (contains (everyMode, 1, Quality::maj) || contains (everyMode, 6, Quality::dim),
           "the wider set still reaches the exotic borrowings");

    checkEqual ((int) td::Progression::parallelModeOf (Scale::ionian), (int) Scale::aeolian,
                "major borrows from minor");
    checkEqual ((int) td::Progression::parallelModeOf (Scale::mixolydian), (int) Scale::aeolian,
                "mixolydian borrows from minor");
    checkEqual ((int) td::Progression::parallelModeOf (Scale::aeolian), (int) Scale::ionian,
                "minor borrows from major");
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

    // Articulation is scheduled on the same clock: a strum spreads inside the
    // block instead of landing all at once.
    {
        td::Progression strummed = progression;
        strummed.slots[0].performance = td::Performance::strum;
        strummed.slots[0].param = 150;

        td::ChordScheduler scheduler;
        juce::MidiBuffer out;
        scheduler.process (out, { true, 0.0, 1.0 }, strummed, settings, 512);

        std::vector<int> positions;
        for (const auto metadata : out)
            if (metadata.getMessage().isNoteOn())
                positions.push_back (metadata.samplePosition);

        std::sort (positions.begin(), positions.end());
        checkEqual ((int) positions.size(), 3, "the strummed chord sounds all three tones");
        check (positions[0] < positions[1] && positions[1] < positions[2],
               "the strum spreads across samples");
    }

    // Audition plays a chord with the transport stopped and releases it on its
    // own clock rather than on the transport's.
    {
        td::ChordScheduler scheduler;
        juce::MidiBuffer out;
        td::ChordSlot preview;
        preview.rootPc = 0;
        preview.quality = td::theory::Quality::maj;
        preview.beats = 1.0;

        scheduler.audition (out, preview, settings, 512, 48000.0);
        checkEqual (countNotes (out, true), 3, "audition sounds the chord");

        out.clear();
        scheduler.process (out, { false, 0.0, 0.0 }, progression, settings, 512);
        checkEqual (countNotes (out, false), 0, "a stopped transport does not cut the audition short");

        out.clear();
        for (int i = 0; i < 80; ++i)
            scheduler.process (out, { false, 0.0, 0.0 }, progression, settings, 512);
        check (countNotes (out, false) >= 3, "the audition releases itself after its own window");
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
/** A two-section song: verse (two 4-beat chords) and chorus (one 8-beat chord). */
td::Song makeSong()
{
    td::Song song;
    const auto verse = song.addSection ("Verse");
    song.sections[verse].progression.count = 2;
    song.sections[verse].progression.slots[0] = { 0, td::theory::Quality::maj, 4.0 };
    song.sections[verse].progression.slots[1] = { 5, td::theory::Quality::maj, 4.0 };

    const auto chorus = song.addSection ("Chorus");
    song.sections[chorus].progression.count = 1;
    song.sections[chorus].progression.slots[0] = { 7, td::theory::Quality::seven, 8.0 };

    return song;
}

/** Ascending MIDI notes for a voiced chord, for the parity checks. */
juce::String noteRow (const std::vector<int>& notes)
{
    juce::StringArray parts;
    for (int note : notes)
        parts.add (juce::String (note));
    return parts.joinIntoString (",");
}

void testVoicing()
{
    using namespace td::theory;

    // The app's `voiceChord` rules, spot for spot.
    const Voicing rootPos;
    const Voicing first { 1, false };
    const Voicing second { 2, false };
    const Voicing openRoot { 0, true };

    checkEqual (noteRow (voicedNotes (60, Quality::maj, rootPos)), "60,64,67", "C major, root position");
    checkEqual (noteRow (voicedNotes (60, Quality::maj, first)), "64,67,72", "C major, first inversion");
    checkEqual (noteRow (voicedNotes (60, Quality::maj, second)), "67,72,76", "C major, second inversion");

    // A third inversion on a triad wraps back to root position: the tone in the
    // bass is the root again.
    checkEqual (noteRow (voicedNotes (60, Quality::maj, Voicing { 3, false })), "60,64,67",
                "an inversion past the chord size wraps");

    // "Open" drops the second-highest tone an octave: 4 becomes -8, so the third
    // is the lowest note and the chord spans more than an octave.
    checkEqual (noteRow (voicedNotes (60, Quality::maj, openRoot)), "52,60,67",
                "C major, open spread");

    // Sevenths have four tones, so they have four inversions.
    checkEqual (noteRow (voicedNotes (60, Quality::maj7, first)), "64,67,71,72",
                "Cmaj7, first inversion");
    checkEqual ((int) inversionCount (Quality::maj), 3, "a triad has three inversions");
    checkEqual ((int) inversionCount (Quality::maj7), 4, "a seventh has four");
    checkEqual ((int) inversionCount (Quality::thirteen), 6, "a thirteenth has six");

    // The bass is the inversion's tone, and is unaffected by the spread: an open
    // root-position chord has its third lowest, but the songwriter asked for the
    // root in the bass.
    checkEqual (bassPitchClass (0, Quality::maj, rootPos), 0, "root position basses the root");
    checkEqual (bassPitchClass (0, Quality::maj, first), 4, "first inversion basses the third");
    checkEqual (bassPitchClass (0, Quality::maj, second), 7, "second inversion basses the fifth");
    checkEqual (bassPitchClass (0, Quality::maj, openRoot), 0, "the spread does not move the bass");

    checkEqual (juce::String (chordNameWithBass (0, Quality::maj, rootPos)), juce::String ("C"),
                "root position is spelled without a slash");
    checkEqual (juce::String (chordNameWithBass (0, Quality::maj, first)), juce::String ("C/E"),
                "an inversion is spelled as a slash chord");
}

void testVoicingScheduler()
{
    td::VoiceSettings settings;
    settings.octave = 4;
    settings.velocity = 90;
    settings.gate = 1.0;
    settings.enabled = true;

    auto collect = [] (const juce::MidiBuffer& buffer)
    {
        std::vector<int> notes;
        for (const auto metadata : buffer)
            if (metadata.getMessage().isNoteOn())
                notes.push_back (metadata.getMessage().getNoteNumber());
        std::sort (notes.begin(), notes.end());
        return notes;
    };

    td::Progression progression;
    progression.count = 1;
    progression.slots[0] = { 0, td::theory::Quality::maj, 4.0 };
    progression.slots[0].voicing = { 1, false };

    // A first inversion sounds as its own shape: no C below the E.
    {
        td::ChordScheduler scheduler;
        juce::MidiBuffer out;
        scheduler.process (out, { true, 0.0, 1.0 }, progression, settings, 512);
        check (collect (out) == std::vector<int> { 64, 67, 72 }, "the inversion is what sounds");
    }

    // The bass voice is off unless it is asked for.
    {
        td::ChordScheduler scheduler;
        juce::MidiBuffer out;
        scheduler.process (out, { true, 0.0, 1.0 }, progression, settings, 512);
        check (collect (out).front() == 64, "no bass note by default");
    }

    // Asked for, it plays the inversion's tone in the app's bass register:
    // E at octave 3 is MIDI 40.
    {
        auto withBass = settings;
        withBass.bassOctave = 3;
        td::ChordScheduler scheduler;
        juce::MidiBuffer out;
        scheduler.process (out, { true, 0.0, 1.0 }, progression, withBass, 512);
        const auto notes = collect (out);
        checkEqual ((int) notes.size(), 4, "the bass adds one note");
        checkEqual (notes.front(), 40, "and it is E in the bass register");
    }

    // The bass follows the inversion, not the chord root: second inversion is G.
    {
        auto withBass = settings;
        withBass.bassOctave = 2;
        auto secondInversion = progression;
        secondInversion.slots[0].voicing = { 2, false };
        td::ChordScheduler scheduler;
        juce::MidiBuffer out;
        scheduler.process (out, { true, 0.0, 1.0 }, secondInversion, withBass, 512);
        checkEqual (collect (out).front(), 31, "second inversion basses G at octave 2");
    }
}

void testVoicingXml()
{
    td::Progression progression;
    progression.count = 2;
    progression.slots[0] = { 0, td::theory::Quality::maj, 4.0 };
    progression.slots[0].voicing = { 1, false };
    progression.slots[1] = { 7, td::theory::Quality::min7, 4.0 };
    progression.slots[1].voicing = { 2, true };

    const auto xml = td::toXml (progression, "TrackDraftPreset");
    checkEqual (xml.getChildByName ("slot")->getIntAttribute ("inversion"), 1,
                "an inversion is written");
    checkEqual (xml.getChildElement (1)->getStringAttribute ("spread"), juce::String ("open"),
                "an open spread is written");

    td::Progression loaded;
    check (td::fromXml (xml, loaded), "the progression reads back");
    checkEqual (loaded.slots[0].voicing.inversion, 1, "the inversion survives");
    check (! loaded.slots[0].voicing.open, "and the close spread does");
    checkEqual (loaded.slots[1].voicing.inversion, 2, "the second slot's inversion survives");
    check (loaded.slots[1].voicing.open, "and its open spread");

    // A file from before voicings existed says nothing about them, and must not
    // gain attributes when it is written back out.
    td::Progression plain;
    plain.count = 1;
    plain.slots[0] = { 0, td::theory::Quality::maj, 4.0 };
    const auto plainXml = td::toXml (plain, "TrackDraftPreset");
    check (! plainXml.getChildByName ("slot")->hasAttribute ("inversion"),
           "root position writes no inversion attribute");
    check (! plainXml.getChildByName ("slot")->hasAttribute ("spread"),
           "and no spread attribute");
}

void testSongStructure()
{
    auto song = makeSong();

    checkEqual ((int) song.sections.size(), 2, "two sections");
    checkEqual ((int) song.arrangement.size(), 2, "the default arrangement covers both");
    check (song.arrangement[0].sectionId == song.sections[0].id, "the first pass is the first section");
    check (song.arrangement[1].sectionId == song.sections[1].id, "the second pass is the second section");

    check (std::abs (song.totalBeats() - 16.0) < 1e-9, "16 beats: 8 of verse, 8 of chorus");

    // Repeats multiply the whole section, not one chord.
    song.setRepeats (1, 3);
    check (std::abs (song.totalBeats() - 32.0) < 1e-9, "three choruses are 24 beats after 8");

    // Position walks the arrangement: verse, verse again, then the chorus.
    const auto inFirstVerse = song.positionAt (0.0);
    checkEqual ((int) inFirstVerse.section, 0, "beat 0 is the verse");
    check (std::abs (inFirstVerse.beatInSection) < 1e-9, "beat 0 is the top of the verse");

    const auto late = song.positionAt (7.5);
    checkEqual ((int) late.section, 0, "beat 7.5 is still the verse");
    check (std::abs (late.beatInSection - 7.5) < 1e-9, "beat 7.5 is 7.5 into the verse");

    const auto chorus = song.positionAt (9.0);
    checkEqual ((int) chorus.section, 1, "beat 9 is the chorus");
    check (std::abs (chorus.beatInSection - 1.0) < 1e-9, "beat 9 is 1 beat into the chorus");

    // Past the end the form repeats, which is what a DAW loop does anyway.
    const auto wrapped = song.positionAt (32.0 + 2.0);
    checkEqual ((int) wrapped.section, 0, "the form wraps to the verse");
    check (std::abs (wrapped.beatInSection - 2.0) < 1e-9, "wrapped by exactly one song length");

    // The chord at a beat is the section's chord, not the first section's.
    const auto chorusChord = song.chordAt (9.0);
    checkEqual (chorusChord.rootPc, 7, "the chorus chord is G");
    check (chorusChord.quality == td::theory::Quality::seven, "and it is a G7");
    const auto verseChord = song.chordAt (5.0);
    checkEqual (verseChord.rootPc, 5, "the second verse chord is F");
}

void testSongEditing()
{
    auto song = makeSong();

    // A new section joins the arrangement once, at the end.
    const auto bridge = song.addSection ("Bridge");
    checkEqual ((int) song.sections.size(), 3, "a third section is added");
    checkEqual ((int) song.arrangement.size(), 3, "and joins the arrangement once");
    check (song.arrangement.back().sectionId == song.sections[bridge].id,
           "the new pass is the last one");

    // Duplicating copies the chords and gets its own identity.
    song.sections[bridge].progression.count = 3;
    const auto copy = song.duplicateSection (bridge);
    checkEqual ((int) song.sections.size(), 4, "the copy is a fourth section");
    checkEqual ((int) song.sections[copy].progression.count, 3, "the copy keeps the chords");
    check (song.sections[copy].id != song.sections[bridge].id, "the copy has its own id");

    // Removing a section drops the passes that pointed at it and keeps order.
    const int removedId = song.sections[1].id;
    const int keeperId = song.sections[0].id;
    song.removeSection (1);
    checkEqual ((int) song.sections.size(), 3, "the section is gone");
    for (const auto& pass : song.arrangement)
        check (pass.sectionId != removedId, "no pass points at the removed section");
    check (song.arrangement.front().sectionId == keeperId, "the remaining order is untouched");

    // Reordering the list cannot change what plays: the arrangement names ids.
    const auto before = song.arrangement;
    song.moveSection (0, 2);
    check (song.arrangement == before, "moving a section leaves the arrangement alone");

    // Repeats are clamped, never zero or negative.
    song.setRepeats (0, 0);
    checkEqual (song.arrangement[0].repeats, 1, "repeats clamp to one");
    song.setRepeats (0, 99);
    checkEqual (song.arrangement[0].repeats, td::Song::maxRepeats, "and to the maximum");

    // The same section twice is a real arrangement, not a repeat count.
    const int passesBefore = (int) song.arrangement.size();
    // Section 0 is not the first pass any more — the move above put it third —
    // so this also checks that a pass names a section, not a position.
    const int appendedId = song.sections[0].id;
    song.appendPass (0);
    checkEqual ((int) song.arrangement.size(), passesBefore + 1, "an extra pass is appended");
    check (song.arrangement.back().sectionId == appendedId,
           "and it points at the section that was asked for");

    song.removePass (song.arrangement.size() - 1);
    checkEqual ((int) song.arrangement.size(), passesBefore, "a pass can be removed again");

    // The arrangement is drawn in one row, so it is bounded like everything else.
    td::Song longSong = makeSong();
    const int alreadyThere = (int) longSong.arrangement.size();
    int accepted = 0;
    for (int i = 0; i < 100; ++i)
        if (longSong.appendPass (0))
            ++accepted;

    checkEqual (accepted, (int) td::Song::maxPasses - alreadyThere,
                "passes are accepted up to the cap");
    checkEqual ((int) longSong.arrangement.size(), (int) td::Song::maxPasses,
                "and the arrangement stops growing there");
    check (! longSong.appendPass (0), "one more is refused rather than dropped silently");

    // The last pass stays: an arrangement with none is a song that plays nothing.
    td::Song single = makeSong();
    check (single.removePass (1), "a pass can be removed");
    check (! single.removePass (0), "the last pass cannot");
    checkEqual ((int) single.arrangement.size(), 1, "so one pass is left");
}

void testSongCycle()
{
    auto song = makeSong();
    td::SongCycle cycle;
    cycle.rebuild (song);

    checkEqual ((int) cycle.slotCount(), 3, "three chords across the song");
    check (std::abs (cycle.lengthInBeats() - 16.0) < 1e-9, "the cycle is the song's length");

    check (std::abs (cycle.startBeatOf (0) - 0.0) < 1e-9, "slot 0 at beat 0");
    check (std::abs (cycle.startBeatOf (1) - 4.0) < 1e-9, "slot 1 at beat 4");
    check (std::abs (cycle.startBeatOf (2) - 8.0) < 1e-9, "slot 2 at beat 8 — the chorus");

    checkEqual (cycle.slotAt (2).rootPc, 7, "the third cycle slot is the chorus chord");

    const auto playing = cycle.playingAt (9.0);
    checkEqual ((int) playing.section, 1, "beat 9 is in the chorus");
    checkEqual ((int) playing.slot, 0, "at its first slot");
    checkEqual ((int) playing.pass, 1, "on the second arrangement pass");

    // Repeats are expanded in the cycle, not collapsed.
    song.setRepeats (1, 2);
    cycle.rebuild (song);
    checkEqual ((int) cycle.slotCount(), 4, "a repeated chorus adds its chords again");
    const auto second = cycle.playingAt (16.0 + 2.0);
    checkEqual ((int) second.section, 1, "beat 18 is the repeated chorus");
    checkEqual ((int) second.slot, 0, "at its first slot");

    // An empty song is a zero-length cycle the scheduler can refuse to play.
    td::Song empty;
    cycle.rebuild (empty);
    check (std::abs (cycle.lengthInBeats()) < 1e-9, "an empty song has no length");
    checkEqual ((int) cycle.slotCount(), 0, "and no slots");
}

void testSongScheduler()
{
    auto song = makeSong();
    td::SongCycle cycle;
    cycle.rebuild (song);

    td::VoiceSettings settings;
    settings.octave = 4;
    settings.velocity = 90;
    settings.gate = 1.0;
    settings.enabled = true;

    // Bar 3 opens the chorus: G7, not another verse chord.
    {
        td::ChordScheduler scheduler;
        juce::MidiBuffer out;
        scheduler.process (out, { true, 0.0, 1.0 }, cycle, settings, 512);
        out.clear();
        scheduler.process (out, { true, 7.9, 8.1 }, cycle, settings, 512);

        std::vector<int> notes;
        for (const auto metadata : out)
            if (metadata.getMessage().isNoteOn())
                notes.push_back (metadata.getMessage().getNoteNumber());
        std::sort (notes.begin(), notes.end());

        // G7 at octave 4: G B D F = 67 71 74 77.
        check (notes == std::vector<int> { 67, 71, 74, 77 }, "the chorus arrives as a G7");
    }

    // The song loops on its own total length, so bar 5 starts the form again.
    {
        td::ChordScheduler scheduler;
        juce::MidiBuffer out;
        scheduler.process (out, { true, 15.9, 16.1 }, cycle, settings, 512);

        std::vector<int> notes;
        for (const auto metadata : out)
            if (metadata.getMessage().isNoteOn())
                notes.push_back (metadata.getMessage().getNoteNumber());
        std::sort (notes.begin(), notes.end());

        check (notes == std::vector<int> { 60, 64, 67 }, "the form restarts on C major");
    }
}

void testSongPresets()
{
    auto scratch = juce::File::getSpecialLocation (juce::File::tempDirectory)
                       .getChildFile ("trackdraft-song-presets");
    scratch.deleteRecursively();

    td::PresetStore store (scratch);
    auto song = makeSong();
    juce::String error;

    check (store.saveSong ("My Song", song, error), "a song saves: " + error);
    checkEqual ((int) store.names().size(), 1, "and appears in the list");
    check (store.kindOf ("My Song") == td::PresetStore::Kind::song, "as a song");

    td::Song loaded;
    check (store.loadSong ("My Song", loaded, error), "a song loads: " + error);
    checkEqual ((int) loaded.sections.size(), 2, "with its sections");
    check (std::abs (loaded.totalBeats() - 16.0) < 1e-9, "and its length");

    // One section is not a song, and a song is not one section: each loader
    // says so instead of silently taking the first of the other.
    td::Progression asSection;
    check (! store.load ("My Song", asSection, error), "a song is refused as a section");
    check (error.containsIgnoreCase ("whole song"), "and says why");

    check (store.save ("Just A Section", song.sections[0].progression, error),
           "a section preset saves: " + error);
    check (store.kindOf ("Just A Section") == td::PresetStore::Kind::progression,
           "and is listed as one section");

    td::Song notASong;
    check (! store.loadSong ("Just A Section", notASong, error),
           "a section is refused as a song");
    check (error.containsIgnoreCase ("one section"), "and says why");

    // Deleting works the same for either shape.
    check (store.remove ("My Song", error), "a song can be deleted: " + error);
    check (store.kindOf ("My Song") == td::PresetStore::Kind::unusable,
           "and is gone afterwards");

    scratch.deleteRecursively();
}

void testSongXml()
{
    auto song = makeSong();
    song.sections[0].name = "Verse A";
    song.setRepeats (1, 2);

    const auto xml = td::toXml (song, "TrackDraftSong");
    checkEqual (xml.getStringAttribute ("version"), juce::String ("2"), "song xml is version 2");

    td::Song loaded;
    check (td::fromXml (xml, loaded), "the song reads back");
    checkEqual ((int) loaded.sections.size(), 2, "both sections survive");
    checkEqual (loaded.sections[0].name, juce::String ("Verse A"), "the section name survives");
    checkEqual ((int) loaded.sections[1].progression.count, 1, "the chord counts survive");
    checkEqual ((int) loaded.arrangement.size(), 2, "the arrangement survives");
    checkEqual (loaded.arrangement[1].repeats, 2, "the repeats survive");
    check (loaded.arrangement[1].sectionId == loaded.sections[1].id,
           "and the pass still points at the chorus");
    check (std::abs (loaded.totalBeats() - 24.0) < 1e-9, "the reloaded song is the same length");

    // A session written before songs existed is a one-section song.
    td::Progression old;
    old.count = 2;
    old.slots[0] = { 2, td::theory::Quality::min, 4.0 };
    old.slots[1] = { 9, td::theory::Quality::maj, 4.0 };
    const auto oldXml = td::toXml (old, "TrackDraftHarmony");

    td::Song migrated;
    check (td::fromXml (oldXml, migrated), "a bare progression loads as a song");
    checkEqual ((int) migrated.sections.size(), 1, "with one section");
    checkEqual ((int) migrated.sections[0].progression.count, 2, "and its chords");
    checkEqual ((int) migrated.arrangement.size(), 1, "and one arrangement pass");
    check (std::abs (migrated.totalBeats() - 8.0) < 1e-9, "8 beats long");

    // The app's own bytes — copied from `toTdpSongXml`'s output in
    // apps/trackdraft/src/lib/harmony/tdpPreset.test.ts, LF endings, beats
    // written as whole numbers. This is the direction that has to work: the app
    // authors the song and the plug-in plays it.
    const auto appXml = juce::parseXML (juce::String (R"XML(<?xml version="1.0" encoding="UTF-8"?>

<TrackDraftSong version="2" count="2">
  <section name="Verse">
    <progression version="1" count="2">
      <slot root="9" quality="min" beats="4" performance="1" param="150" direction="2" inversion="1"/>
      <slot root="2" quality="maj" beats="4" performance="0" param="0" direction="2"/>
    </progression>
  </section>
  <section name="Chorus">
    <progression version="1" count="2">
      <slot root="5" quality="maj" beats="4" performance="0" param="0" direction="2"/>
      <slot root="7" quality="7" beats="4" performance="3" param="8" direction="1"/>
    </progression>
  </section>
  <arrangement>
    <pass section="0" repeats="1"/>
    <pass section="1" repeats="2"/>
  </arrangement>
</TrackDraftSong>
)XML"));

    td::Song fromApp;
    check (appXml != nullptr && td::fromXml (*appXml, fromApp), "the app's song file parses");
    checkEqual ((int) fromApp.sections.size(), 2, "the app's two sections arrive");
    checkEqual (fromApp.sections[0].name, juce::String ("Verse"), "with their names");
    checkEqual ((int) fromApp.sections[0].progression.count, 2, "and their chords");
    checkEqual (fromApp.sections[0].progression.slots[0].rootPc, 9, "A minor is root 9");
    check (fromApp.sections[0].progression.slots[0].performance == td::Performance::strum,
           "the strum articulation survives");
    checkEqual (fromApp.sections[0].progression.slots[0].param, 150, "with its spread");
    checkEqual (fromApp.sections[0].progression.slots[0].voicing.inversion, 1,
                "and the inversion the app wrote");
    checkEqual (fromApp.arrangement[1].repeats, 2, "the chorus repeats twice");
    check (std::abs (fromApp.totalBeats() - 24.0) < 1e-9, "24 beats: 8 of verse, 16 of chorus");
}

} // namespace

int main (int argc, char** argv)
{
    // `--dump-xml` prints one progression in the plug-in's on-disk shape. The
    // app's `tdpPreset` tests paste that exact output as a fixture, so the two
    // sides of the format are checked against the same bytes rather than
    // against each other's assumptions.
    if (argc > 1 && juce::String (argv[1]) == "--dump-xml")
    {
        td::Progression sample;
        sample.count = 3;
        sample.slots[0] = { 0, td::theory::Quality::maj7, 4.0, td::Performance::block, 0, 2 };
        sample.slots[1] = { 5, td::theory::Quality::min, 2.0, td::Performance::strum, 150, 2 };
        sample.slots[1].voicing = { 1, false };
        sample.slots[2] = { 7, td::theory::Quality::seven, 8.0, td::Performance::arp, 8, 1 };
        std::cout << td::toXml (sample, "TrackDraftPreset").toString() << std::endl;
        return 0;
    }

    // `--dump-song-xml` prints a whole song in the plug-in's on-disk shape, and
    // the app's `tdpPreset` tests paste that exact output as a fixture.
    if (argc > 1 && juce::String (argv[1]) == "--dump-song-xml")
    {
        td::Song song;

        const auto verse = song.addSection ("Verse");
        song.sections[verse].progression.count = 2;
        song.sections[verse].progression.slots[0] = { 9, td::theory::Quality::min, 4.0,
                                                      td::Performance::strum, 150, 2 };
        song.sections[verse].progression.slots[1] = { 2, td::theory::Quality::maj, 4.0 };

        const auto chorus = song.addSection ("Chorus");
        song.sections[chorus].progression.count = 2;
        song.sections[chorus].progression.slots[0] = { 5, td::theory::Quality::maj, 4.0 };
        song.sections[chorus].progression.slots[1] = { 7, td::theory::Quality::seven, 4.0,
                                                       td::Performance::arp, 8, 1 };

        song.setRepeats (1, 2);
        std::cout << td::toXml (song, "TrackDraftSong").toString() << std::endl;
        return 0;
    }

    // `--dump-names` prints the filename rule over a fixed list of awkward
    // names. The app asserts the same output, so the three copies of the rule
    // (plug-in, renderer, main process) cannot drift apart unnoticed.
    if (argc > 1 && juce::String (argv[1]) == "--dump-names")
    {
        const juce::StringArray samples {
            "Late Night",
            juce::String::fromUTF8 ("Caf\xc3\xa9 Minor"),
            "Chaos/../../etc/passwd",
            "  ..hidden  ",
            "",
            juce::String::fromUTF8 ("\xf0\x9f\x94\xa5\xf0\x9f\x94\xa5\xf0\x9f\x94\xa5"),
            "Song: Part 2 (draft)",
        };

        for (const auto& sample : samples)
            std::cout << sample << "\t" << td::PresetStore::sanitiseName (sample) << std::endl;

        return 0;
    }

    testTheoryParity();
    testDiatonicVocabulary();
    testWalk();
    testRecognition();
    testArticulation();
    testBorrowedChords();
    testReorderAndApplyAll();
    testProgressionXml();
    testPresets();
    testPresetManagement();
    testBorrowedScope();
    testChordLabels();
    testJsonImport();
    testMidiImport();
    testProgressionCycle();
    testScheduler();
    testVoicing();
    testVoicingScheduler();
    testVoicingXml();
    testSongStructure();
    testSongEditing();
    testSongCycle();
    testSongScheduler();
    testSongXml();
    testSongPresets();

    if (failures == 0)
    {
        std::cout << "TrackDraftTests: " << checks << " checks passed" << std::endl;
        return 0;
    }

    std::cerr << "TrackDraftTests: " << failures << " check(s) failed" << std::endl;
    return 1;
}
