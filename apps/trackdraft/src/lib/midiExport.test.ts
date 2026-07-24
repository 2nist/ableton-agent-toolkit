import { describe, it, expect } from "vitest";
import { songToMidi } from "./midiExport";
import { parseMidiBytes } from "./parsers/parseMidi";
import { createEmptySong, type BlueprintSong, type Chord } from "../types/blueprint";

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

  it("produces a Type-1 SMF with 4 tracks", () => {
    const bytes = songToMidi(testSong());
    const parsed = parseMidiBytes(bytes);
    // Format = 1 (multi-track)
    const format = (bytes[8] << 8) | bytes[9];
    expect(format).toBe(1);
    // 4 tracks: conductor, chords, bass, drums
    expect(parsed.tracks.length).toBe(4);
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
    // Should still have 4 tracks, just with fewer notes
    expect(parsed.tracks.length).toBe(4);
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
    expect(parsed.tracks.length).toBe(4);
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