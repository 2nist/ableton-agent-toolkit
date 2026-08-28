import { describe, it, expect } from "vitest";
import { songToMidi, planDrumStem, planBassStem, resolveChordOccurrences } from "./midiExport";
import { sectionSpans } from "./arrangement";
import { parseMidiBytes } from "./parsers/parseMidi";
import { createEmptySong, type BlueprintSong, type BlueprintSection, type Chord } from "../types/blueprint";

describe("resolveChordOccurrences — follow-drums default", () => {
  const SEVEN_EIGHT = { cellBeats: 0.5, cells: [2, 2, 3] as (2 | 3)[], label: "7/8" };

  function sectionWith(drumMeterOutline?: BlueprintSection["drumMeterOutline"], harmonyFollowsDrums?: boolean): BlueprintSection {
    return {
      id: "s",
      name: "Verse",
      role: "verse",
      bars: 1,
      chords: [
        { id: "c1", romanNumeral: "I", root: "C", quality: "maj", beats: 4 },
        { id: "c2", romanNumeral: "V", root: "G", quality: "maj", beats: 4 },
      ],
      beatsPerChord: 4,
      velocity: "mf",
      timeSignatureNumerator: 7,
      timeSignatureDenPower: 3,
      drumMeterOutline,
      harmonyFollowsDrums,
    };
  }

  it("follows the drums' outline by default when the section has a drum outline (closest sync)", () => {
    const occ = resolveChordOccurrences(sectionWith(SEVEN_EIGHT), 7);
    expect(occ.map((o) => o.startTime)).toEqual([0, 1, 2, 3.5, 4.5, 5.5]);
  });

  it("stays on per-chord beats when harmonyFollowsDrums is explicitly false", () => {
    const occ = resolveChordOccurrences(sectionWith(SEVEN_EIGHT, false), 16);
    expect(occ.map((o) => o.startTime)).toEqual([0, 4, 8, 12]);
  });
});

/** Builds a minimal test song with one section and a I–V–vi–IV progression
 *  in C major — the most common pop progression, good for verifying that
 *  chord pitches land where they should. */
function testSong(): BlueprintSong {
  const song = createEmptySong("Test Song");
  song.bpm = 120;
  song.key = "C";
  song.scale = "ionian";
  song.timeSignatureNumerator = 4;
  song.timeSignatureDenominator = 4;

  const chords: Chord[] = [
    { id: "c1", romanNumeral: "I", root: "C", quality: "maj", beats: 4 },
    { id: "c2", romanNumeral: "V", root: "G", quality: "maj", beats: 4 },
    { id: "c3", romanNumeral: "vi", root: "A", quality: "min", beats: 4 },
    { id: "c4", romanNumeral: "IV", root: "F", quality: "maj", beats: 4 },
  ];

  song.sections = [
    {
      id: "s1",
      name: "Verse",
      role: "verse",
      bars: 4,
      chords,
      beatsPerChord: 4,
      velocity: "mf",
      timeSignatureNumerator: 4,
      timeSignatureDenPower: 2,
    },
  ];
  song.arrangement = [{ sectionId: "s1", repeats: 1 }];
  return song;
}

describe("songToMidi", () => {
  it("produces a valid MIDI file header", () => {
    const bytes = songToMidi(testSong());
    // MThd header
    expect(bytes[0]).toBe(0x4d); // M
    expect(bytes[1]).toBe(0x54); // T
    expect(bytes[2]).toBe(0x68); // h
    expect(bytes[3]).toBe(0x64); // d
  });

  it("produces a Type-1 SMF with 6 tracks", () => {
    const bytes = songToMidi(testSong());
    const parsed = parseMidiBytes(bytes);
    // Format = 1 (multi-track)
    const format = (bytes[8] << 8) | bytes[9];
    expect(format).toBe(1);
    // 6 tracks: conductor, chords, bass, drums, color, melody
    expect(parsed.tracks.length).toBe(6);
  });

  it("encodes the correct tempo", () => {
    const song = testSong();
    song.bpm = 140;
    const bytes = songToMidi(song);
    const parsed = parseMidiBytes(bytes);
    expect(parsed.tempo).toBe(140);
  });

  it("encodes the correct time signature", () => {
    const bytes = songToMidi(testSong());
    const parsed = parseMidiBytes(bytes);
    expect(parsed.timeSigNum).toBe(4);
    expect(parsed.timeSigDen).toBe(4);
  });

  it("encodes the correct key signature (C major)", () => {
    const bytes = songToMidi(testSong());
    const parsed = parseMidiBytes(bytes);
    expect(parsed.key).toBe("C");
    expect(parsed.scale).toBe("ionian");
  });

  it("encodes the correct key signature (A minor)", () => {
    const song = testSong();
    song.key = "A";
    song.scale = "aeolian";
    const bytes = songToMidi(song);
    const parsed = parseMidiBytes(bytes);
    expect(parsed.key).toBe("A");
    expect(parsed.scale).toBe("aeolian");
  });

  it("generates chord notes at the correct pitches", () => {
    const bytes = songToMidi(testSong());
    const parsed = parseMidiBytes(bytes);

    // Track 1 = Chords (index 1). C major chord at octave 5 should
    // include MIDI 60 (C5), 64 (E5), 67 (G5) — the root-position triad.
    const chordTrack = parsed.tracks[1];
    const chordNoteOns = chordTrack.events.filter((e) => e.type === "noteOn" && e.note !== undefined);
    const pitches = new Set(chordNoteOns.map((e) => e.note!));

    // C major: C, E, G
    expect(pitches.has(60)).toBe(true); // C5
    expect(pitches.has(64)).toBe(true); // E5
    expect(pitches.has(67)).toBe(true); // G5
  });

  it("generates bass notes one octave below chord clips", () => {
    const bytes = songToMidi(testSong());
    const parsed = parseMidiBytes(bytes);

    // Track 2 = Bass (index 2). C bass at octave 3 = MIDI 36.
    const bassTrack = parsed.tracks[2];
    const bassNoteOns = bassTrack.events.filter((e) => e.type === "noteOn" && e.note !== undefined);
    const pitches = new Set(bassNoteOns.map((e) => e.note!));

    // Bass root for C = MIDI 36 (C3)
    expect(pitches.has(36)).toBe(true);
    // Bass root for G = MIDI 43 (G3)
    expect(pitches.has(43)).toBe(true);
  });

  it("generates drum notes on the GM drum channel", () => {
    const bytes = songToMidi(testSong());
    const parsed = parseMidiBytes(bytes);

    // Track 3 = Drums (index 3). Should have kick (36), snare (38), hat (42).
    const drumTrack = parsed.tracks[3];
    const drumNoteOns = drumTrack.events.filter((e) => e.type === "noteOn" && e.note !== undefined);
    const pitches = new Set(drumNoteOns.map((e) => e.note!));

    expect(pitches.has(36)).toBe(true); // kick
    expect(pitches.has(38)).toBe(true); // snare
    expect(pitches.has(42)).toBe(true); // closed hat
  });

  it("generates a Color track (Track 4) with bi-tonal notes", () => {
    const bytes = songToMidi(testSong());
    const parsed = parseMidiBytes(bytes);

    // Track 4 = Color (index 4). The bi-tonal layer should sit above the
    // chord octave (octave 6 = MIDI 72+), so at least one note should
    // register in that register.
    const colorTrack = parsed.tracks[4];
    const colorNoteOns = colorTrack.events.filter((e) => e.type === "noteOn" && e.note !== undefined);
    expect(colorNoteOns.length).toBeGreaterThan(0);
    expect(colorNoteOns.some((e) => (e.note ?? 0) >= 72)).toBe(true);
  });

  it("emits a Melody track (Track 5) when a section has a captured melody", () => {
    const song = testSong();
    song.sections[0].melody = {
      notes: [
        { pitch: 60, startTime: 0, duration: 1, velocity: 96 },
        { pitch: 62, startTime: 1, duration: 0.5, velocity: 90 },
      ],
    };
    const bytes = songToMidi(song);
    const parsed = parseMidiBytes(bytes);

    // Track 5 = Melody (index 5). Both captured notes must be present,
    // at their section-relative beats (section starts at beat 0 here).
    const melodyTrack = parsed.tracks[5];
    const melodyOns = melodyTrack.events
      .filter((e) => e.type === "noteOn" && e.note !== undefined)
      .map((e) => ({ pitch: e.note!, tick: e.tick }));
    expect(melodyOns.some((n) => n.pitch === 60 && n.tick === 0)).toBe(true);
    expect(melodyOns.some((n) => n.pitch === 62 && n.tick === 480)).toBe(true); // beat 1 = 480 ticks
  });

  it("omits the melody notes when no section has a melody (empty melody track)", () => {
    const bytes = songToMidi(testSong());
    const parsed = parseMidiBytes(bytes);
    const melodyTrack = parsed.tracks[5];
    const melodyOns = melodyTrack.events.filter((e) => e.type === "noteOn");
    expect(melodyOns.length).toBe(0);
  });

  it("round-trips: exported MIDI parses back without errors", () => {
    const bytes = songToMidi(testSong());
    // Should not throw
    const parsed = parseMidiBytes(bytes);
    expect(parsed.notes.length).toBeGreaterThan(0);
  });

  it("handles a song with no chords (empty progression)", () => {
    const song = testSong();
    song.sections[0].chords = [];
    const bytes = songToMidi(song);
    const parsed = parseMidiBytes(bytes);
    // Should still have 6 tracks, just with fewer notes
    expect(parsed.tracks.length).toBe(6);
  });

  it("handles a song with multiple sections and repeats", () => {
    const song = testSong();
    song.sections = [
      {
        id: "s1",
        name: "Verse",
        role: "verse",
        bars: 4,
        chords: [{ id: "c1", romanNumeral: "I", root: "C", quality: "maj", beats: 4 }],
        beatsPerChord: 4,
        velocity: "mf",
        timeSignatureNumerator: 4,
        timeSignatureDenPower: 2,
      },
      {
        id: "s2",
        name: "Chorus",
        role: "chorus",
        bars: 4,
        chords: [
          { id: "c2", romanNumeral: "V", root: "G", quality: "maj", beats: 2 },
          { id: "c3", romanNumeral: "vi", root: "A", quality: "min", beats: 2 },
        ],
        beatsPerChord: 2,
        velocity: "f",
        timeSignatureNumerator: 4,
        timeSignatureDenPower: 2,
      },
    ];
    song.arrangement = [
      { sectionId: "s1", repeats: 2 },
      { sectionId: "s2", repeats: 3 },
    ];
    const bytes = songToMidi(song);
    const parsed = parseMidiBytes(bytes);
    expect(parsed.tracks.length).toBe(6);
    expect(parsed.notes.length).toBeGreaterThan(0);
  });

  it("applies strum performance effect", () => {
    const song = testSong();
    song.sections[0].chords[0].performance = { style: "strum", params: { strumMs: 150 } };
    const bytes = songToMidi(song);
    const parsed = parseMidiBytes(bytes);
    // Strum should still produce notes, just with staggered start times
    const chordNotes = parsed.notes.filter((n) => n.track === 1);
    expect(chordNotes.length).toBeGreaterThan(0);
  });

  it("applies arpeggiator performance effect", () => {
    const song = testSong();
    song.sections[0].chords[0].performance = { style: "arp", params: { subdivision: 8 } };
    const bytes = songToMidi(song);
    const parsed = parseMidiBytes(bytes);
    // Arp with subdivision=8 should produce 8 notes for the first chord
    // (one per subdivision step), spread across the chord's 4-beat duration.
    // A block chord would only produce 3 notes (the triad), so 8 confirms
    // the arpeggiator is active.
    const chordTrack = parsed.tracks[1];
    const chordNoteOns = chordTrack.events.filter((e) => e.type === "noteOn");
    // First chord = 8 arp notes, remaining 3 chords = 3 notes each (block) = 8 + 9 = 17
    expect(chordNoteOns.length).toBe(8 + 3 * 3);
  });
});

describe("planDrumStem — authoring fields reach the exported drums", () => {
  it("a per-voice override adds a voice the base groove never plays", () => {
    const song = testSong();
    song.sections[0].drumVoicePatterns = { rideBell: { k: 2, n: 8, rotation: 0 } };
    song.arrangement = [{ sectionId: "s1", repeats: 1 }];
    const notes = planDrumStem(sectionSpans(song), song.concept);
    // The heuristic 'standard' groove never plays rideBell (pitch 53) — the
    // override must put it in the exported stem, and it must survive the
    // GM pitch filter.
    expect(notes.some((n) => n.pitch === 53)).toBe(true);
  });

  it("a variation detour replaces the final bar with its own rhythm", () => {
    const song = testSong();
    song.sections[0].bars = 2;
    song.sections[0].drumVariationOutline = { cellBeats: 0.5, cells: [2, 2, 3], label: "1 2 1 2 1 2 3" };
    song.sections[0].drumVariationBars = 1;
    song.arrangement = [{ sectionId: "s1", repeats: 1 }];
    const notes = planDrumStem(sectionSpans(song), song.concept);
    const tail = notes.filter((n) => n.startTime >= 4);
    // The 7/8 click detour replaced the whole final bar — every tail note is
    // the detour's closed hat, regardless of what the real base groove was.
    expect(tail.length).toBeGreaterThan(0);
    expect(tail.every((n) => n.pitch === 42)).toBe(true);
  });

  it("a cut transition truncates the final bar to a single hit", () => {
    const song = testSong();
    song.sections[0].bars = 2;
    song.sections[0].drumTransitionModel = "cut";
    song.sections[0].drumTransitionBars = 1;
    song.arrangement = [{ sectionId: "s1", repeats: 1 }];
    const notes = planDrumStem(sectionSpans(song), song.concept);
    const tail = notes.filter((n) => n.startTime >= 4);
    // cut = one kick+snare hit at beat 4, then dead silence for the span.
    expect(tail.length).toBeGreaterThan(0);
    expect(tail.filter((n) => n.startTime > 4)).toHaveLength(0);
  });
});

describe("planBassStem", () => {
  it("defaults to one sustained root per chord at octave 3", () => {
    const notes = planBassStem(sectionSpans(testSong()));
    expect(notes).toHaveLength(4);
    // I–V–vi–IV in C: C G A F at octave 3 = 36 43 45 41.
    expect(notes.map((n) => n.pitch)).toEqual([36, 43, 45, 41]);
    expect(notes[0]).toMatchObject({ startTime: 0, duration: 4, velocity: 100 });
    expect(notes[3]).toMatchObject({ startTime: 12, duration: 4 });
  });

  it("honors a per-section bassProfile (octave, motion, rhythm, velocity)", () => {
    const song = testSong();
    song.sections[0].bassProfile = { octave: 3, motion: "walking", rhythm: "half", velocity: 60 };
    const notes = planBassStem(sectionSpans(song));
    expect(notes).toHaveLength(8); // 4 chords × 2 subdivisions
    expect(notes[0]).toMatchObject({ pitch: 36, velocity: 60 }); // C root
    expect(notes[1].pitch).toBe(42); // walking approach: F# below G
    expect(notes[2]).toMatchObject({ pitch: 43, velocity: 60 }); // G root
  });
});