import { describe, expect, it } from "vitest";
import { songToMidi } from "../midiExport";
import { parseMidiBytes } from "../parsers/parseMidi";
import { STEM_LABELS } from "../stems";
import { createEmptySong, type BlueprintSong } from "../../types/blueprint";

/**
 * What a DAW actually sees when the file is opened.
 *
 * Rung 1 of the delivery ladder is "a .mid any DAW opens cleanly", and the
 * thing that decides whether it feels integrated is not the notes — it is the
 * header and the track names. Open it in REAPER and you either get five named
 * tracks at the right tempo, or five anonymous ones at 120 that you have to
 * rename and rewire by hand.
 *
 * These assertions are byte-level on purpose: the SMF header is the first
 * thing every DAW reads, and a parser round-trip would happily hide a wrong
 * format number.
 */

function song(): BlueprintSong {
  const base = createEmptySong("Contract");
  return {
    ...base,
    id: "contract",
    title: "Contract",
    bpm: 104,
    key: "D",
    scale: "dorian",
    sections: [
      {
        id: "s1",
        name: "Verse",
        role: "verse",
        bars: 4,
        chords: [
          { id: "c1", romanNumeral: "i", root: "D", quality: "min", beats: 2 },
          { id: "c2", romanNumeral: "IV", root: "G", quality: "maj", beats: 2 },
        ],
        beatsPerChord: 2,
        velocity: "mf",
        timeSignatureNumerator: 7,
        timeSignatureDenPower: 3,
        drumPattern: "standard",
      },
    ],
    arrangement: [],
  } as BlueprintSong;
}

/** SMF header as a DAW reads it: "MThd", format, track count, division. */
function header(bytes: Uint8Array) {
  const str = (from: number, len: number) => String.fromCharCode(...bytes.slice(from, from + len));
  const u16 = (at: number) => (bytes[at]! << 8) | bytes[at + 1]!;
  return {
    magic: str(0, 4),
    format: u16(8),
    trackCount: u16(10),
    division: u16(12),
  };
}

describe("exported .mid — what any DAW sees first", () => {
  it("is a standard Type-1 file at 480 PPQ with six tracks", () => {
    const h = header(songToMidi(song()));
    expect(h.magic).toBe("MThd");
    // 1 = multi-track, simultaneous — what every DAW expects for stems.
    expect(h.format).toBe(1);
    // conductor + chords + bass + drums + colour + melody
    expect(h.trackCount).toBe(6);
    // 480 is Ableton/Logic/Cubase/REAPER's common resolution.
    expect(h.division).toBe(480);
  });

  it("names every stem track, so the DAW imports lanes instead of 'Track 1…5'", () => {
    const parsed = parseMidiBytes(songToMidi(song()));
    const names = parsed.tracks.map((track) => track.name);
    // Track 0 is the conductor, named after the song so the DAW's track list
    // reads "Contract" above the five stems rather than "Track 1".
    expect(names[0]).toBe("Contract");
    for (const label of Object.values(STEM_LABELS)) {
      expect(names).toContain(label);
    }
  });

  it("carries the song's tempo, key and meter in the conductor track", () => {
    const parsed = parseMidiBytes(songToMidi(song()));
    // 104 bpm as written by the export, and 7/8 as authored — a DAW that
    // reads these lands on the song's grid without the user typing anything.
    expect(Math.round(parsed.tempo)).toBe(104);
    expect(parsed.timeSigNum).toBe(7);
    expect(parsed.key).toBe("D");

    const conductorEvents = parsed.tracks[0]!.events;
    expect(conductorEvents.some((e) => e.type === "tempo")).toBe(true);
    expect(conductorEvents.some((e) => e.type === "timeSig")).toBe(true);
    // The conductor must not carry playable notes.
    expect(conductorEvents.some((e) => e.type === "noteOn")).toBe(false);
  });

  it("writes a meter change wherever the song's meter changes", () => {
    // Mixed meter is a first-class feature here ("Stress Chart (odd meters)"
    // ships in the library), and a DAW draws bars — and places the section
    // markers — from these events. One 4/4 event for a 7/8 tune put every bar
    // line in the wrong place.
    const base = song();
    const mixed = {
      ...base,
      sections: [
        { ...base.sections[0]!, id: "a", bars: 2, timeSignatureNumerator: 4, timeSignatureDenPower: 2 },
        { ...base.sections[0]!, id: "b", bars: 2, timeSignatureNumerator: 7, timeSignatureDenPower: 3 },
      ],
      arrangement: [],
    } as BlueprintSong;

    const parsed = parseMidiBytes(songToMidi(mixed));
    expect(parsed.timeSignatures.map((m) => `${m.numerator}/${m.denominator}`)).toEqual(["4/4", "7/8"]);
    // The change lands exactly where the second section starts: 2 bars of 4/4.
    expect(parsed.timeSignatures[1]!.tick).toBe(8 * 480);
  });

  it("carries the arrangement as section markers", () => {
    // The parts alone are not a song: without markers, a DAW whose only door
    // is File > Import MIDI (Logic) gets five anonymous lanes of notes with
    // no way to find the chorus. Markers are meta events, so DAWs that ignore
    // them lose nothing.
    const base = song();
    const twoSections = {
      ...base,
      sections: [base.sections[0]!, { ...base.sections[0]!, id: "s2", name: "Chorus", role: "chorus" }],
      arrangement: [
        { sectionId: "s1", repeats: 1 },
        { sectionId: "s2", repeats: 2 },
      ],
    } as BlueprintSong;

    const parsed = parseMidiBytes(songToMidi(twoSections));
    const markers = parsed.tracks[0]!.events.filter((e) => e.type === "marker");
    expect(markers.map((m) => m.name)).toEqual(["Verse", "Chorus", "Chorus (2)"]);
    // First marker on the downbeat; each later one at its section's start.
    expect(markers[0]!.tick).toBe(0);
    // 4 bars of 7/8 = 14 beats = 14 × 480 ticks.
    expect(markers[1]!.tick).toBe(14 * 480);

    // And they stay out of the way of playback.
    const conductor = parsed.tracks[0]!.events;
    expect(conductor.some((e) => e.type === "noteOn")).toBe(false);
  });

  it("writes only in-range MIDI bytes (no wrapped pitches, no zero velocity)", () => {
    const parsed = parseMidiBytes(songToMidi(song()));
    const noteOns = parsed.notes;
    expect(noteOns.length).toBeGreaterThan(50);
    for (const note of noteOns) {
      expect(note.note).toBeGreaterThanOrEqual(0);
      expect(note.note).toBeLessThanOrEqual(127);
      expect(note.velocity).toBeGreaterThanOrEqual(1);
      expect(note.velocity).toBeLessThanOrEqual(127);
      // Every note has positive length and ends after it starts.
      expect(note.endTick).toBeGreaterThan(note.startTick);
    }
  });

  it("keeps every note-on ahead of its own note-off on each channel", () => {
    const parsed = parseMidiBytes(songToMidi(song()));
    const open = new Set<string>();
    const sorted = parsed.tracks.flatMap((track, index) =>
      track.events
        .filter((e) => e.type === "noteOn" || e.type === "noteOff")
        .map((e) => ({ ...e, track: index })),
    );
    // A note-off with no matching on is the classic "hanging note" in a DAW
    // that trusts the file's order.
    for (const event of sorted.sort((a, b) => a.tick - b.tick)) {
      const key = `${event.track}:${event.channel}:${event.note}`;
      if (event.type === "noteOn") open.add(key);
      else open.delete(key);
    }
    expect([...open]).toEqual([]);
  });
});
