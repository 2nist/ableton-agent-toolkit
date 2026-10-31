import { describe, it, expect } from "vitest";
import { songToRpp, rppFileName } from "./rppProject";
import { sectionSpans } from "../arrangement";
import { planChordStem, planDrumStem, planBassStem, songToMidi, type MidiNote } from "../midiExport";
import { planColorStem } from "../colorStem";
import { planMelodyStem } from "../melody/melodyStem";
import { STEM_LABELS, type StemId } from "../stems";
import { parseMidiBytes } from "../parsers/parseMidi";
import { createEmptySong, type BlueprintSong, type Chord } from "../../types/blueprint";

/** A song with two sections in different meters, so positions, regions and
 *  per-track splitting all get exercised. */
function testSong(): BlueprintSong {
  const song = createEmptySong("Test Song");
  song.bpm = 104;
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
      name: "Intro",
      role: "intro",
      bars: 2,
      chords,
      beatsPerChord: 4,
      velocity: "mf",
      timeSignatureNumerator: 4,
      timeSignatureDenPower: 2,
    },
    {
      id: "s2",
      name: "Verse",
      role: "verse",
      bars: 2,
      chords,
      beatsPerChord: 3.5,
      velocity: "mf",
      timeSignatureNumerator: 7,
      timeSignatureDenPower: 3,
    },
  ];
  song.arrangement = [
    { sectionId: "s1", repeats: 1 },
    { sectionId: "s2", repeats: 1 },
  ];
  return song;
}

interface ParsedRppNote {
  pitch: number;
  /** Beats from the item's own start. */
  startBeat: number;
  durationBeats: number;
  velocity: number;
}

interface ParsedRppItem {
  positionSec: number;
  lengthSec: number;
  name: string;
  ppq: number;
  notes: ParsedRppNote[];
}

interface ParsedRpp {
  bpm: number | null;
  regions: { startSec: number; name: string }[];
  tracks: { name: string; items: ParsedRppItem[] }[];
}

/**
 * A deliberately strict reader for the subset of the RPP format we write.
 * It is the inverse of the writer, so a round trip proves the file says what
 * the writer meant — including the two things that are easy to get wrong and
 * invisible when you look at the text: that positions are seconds, and that
 * `E` deltas are ticks at the resolution declared by `HASDATA`.
 */
function parseRpp(text: string): ParsedRpp {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  const project: ParsedRpp = { bpm: null, regions: [], tracks: [] };
  const stack: string[] = [];
  let track: ParsedRpp["tracks"][number] | null = null;
  let item: ParsedRppItem | null = null;
  let rawEvents: { tick: number; on: boolean; pitch: number; velocity: number }[] = [];
  let cursor = 0;

  const flushNotes = () => {
    if (!item) return;
    const sorted = [...rawEvents].sort((a, b) => a.tick - b.tick || Number(a.on) - Number(b.on));
    const open = new Map<number, { tick: number; velocity: number }>();
    for (const event of sorted) {
      if (event.on) {
        open.set(event.pitch, { tick: event.tick, velocity: event.velocity });
      } else {
        const started = open.get(event.pitch);
        if (!started) throw new Error(`note off without on at tick ${event.tick}`);
        open.delete(event.pitch);
        item.notes.push({
          pitch: event.pitch,
          startBeat: started.tick / item.ppq,
          durationBeats: (event.tick - started.tick) / item.ppq,
          velocity: started.velocity,
        });
      }
    }
    if (open.size > 0) throw new Error(`stuck note on: ${[...open.keys()].join(",")}`);
    rawEvents = [];
    cursor = 0;
  };

  for (const line of lines) {
    if (line.startsWith("<")) {
      const token = line.slice(1).split(/\s+/)[0].toUpperCase();
      stack.push(token);
      if (token === "TRACK") {
        track = { name: "", items: [] };
        project.tracks.push(track);
      } else if (token === "ITEM") {
        if (!track) throw new Error("item outside track");
        item = { positionSec: 0, lengthSec: 0, name: "", ppq: 0, notes: [] };
        track.items.push(item);
      }
      continue;
    }
    if (line === ">") {
      const closed = stack.pop();
      if (closed === "SOURCE") flushNotes();
      if (closed === "ITEM") item = null;
      if (closed === "TRACK") track = null;
      continue;
    }

    const top = stack[stack.length - 1];
    if (top === "SOURCE") {
      if (line.startsWith("HASDATA")) {
        if (!item) throw new Error("HASDATA outside item");
        item.ppq = Number(line.split(/\s+/)[2]);
      } else if (line.startsWith("E ")) {
        const [, deltaRaw, statusRaw, pitchRaw, velocityRaw] = line.split(/\s+/);
        cursor += Number(deltaRaw);
        const status = parseInt(statusRaw!, 16) & 0xf0;
        if (status !== 0x90 && status !== 0x80) throw new Error(`unexpected status ${statusRaw}`);
        const velocity = parseInt(velocityRaw!, 16);
        rawEvents.push({
          tick: cursor,
          on: status === 0x90 && velocity > 0,
          pitch: parseInt(pitchRaw!, 16),
          velocity,
        });
      }
      continue;
    }
    if (top === "TEMPOENVEX") {
      if (line.startsWith("PT ")) project.bpm = Number(line.split(/\s+/)[2]);
      continue;
    }

    const [keyword, ...rest] = line.split(/\s+/);
    if (keyword === "NAME" && top === "TRACK" && track) {
      track.name = rest.join(" ").replace(/^"|"$/g, "");
    } else if (keyword === "NAME" && top === "ITEM" && item) {
      item.name = rest.join(" ").replace(/^"|"$/g, "");
    } else if (keyword === "POSITION" && item) {
      item.positionSec = Number(rest[0]);
    } else if (keyword === "LENGTH" && item) {
      item.lengthSec = Number(rest[0]);
    } else if (keyword === "TEMPO" && stack.length === 1) {
      project.bpm = Number(rest[0]);
    } else if (keyword === "MARKER") {
      project.regions.push({
        startSec: Number(rest[1]),
        name: rest.slice(2).join(" ").replace(/^"|"\s.*$/g, ""),
      });
    }
  }
  if (stack.length > 0) throw new Error(`unclosed chunks: ${stack.join(",")}`);
  return project;
}

/** The notes we expect the writer to emit for a stem, stem-relative. */
function expectedNotes(song: BlueprintSong): Record<StemId, MidiNote[]> {
  const spans = sectionSpans(song);
  return {
    drums: planDrumStem(spans, song),
    bass: planBassStem(spans, song),
    chords: planChordStem(spans, song),
    color: planColorStem(spans, song),
    melody: planMelodyStem(spans, song),
  };
}

describe("songToRpp — structure", () => {
  it("starts with a REAPER_PROJECT header and ends with a closed project", () => {
    const text = songToRpp(testSong());
    const lines = text.split("\n").filter(Boolean);
    expect(lines[0]).toMatch(/^<REAPER_PROJECT 0\.1 "6\.82\/OSX64" \d+$/);
    expect(lines[lines.length - 1]).toBe(">");
    // Every `<` opens exactly once and every chunk is closed.
    const trimmed = lines.map((l) => l.trim());
    const opened = trimmed.filter((l) => l.startsWith("<")).length;
    const closed = trimmed.filter((l) => l === ">").length;
    expect(closed).toBe(opened);
  });

  it("writes the song tempo as the flat project TEMPO line, with the meter", () => {
    const text = songToRpp(testSong());
    expect(text).toContain("  TIMEMODE 1 5 -1 30 0 0 -1");
    expect(text).toContain("  TEMPO 104 4 4 0");
    expect(parseRpp(text).bpm).toBe(104);
  });

  it("does not rely on a tempo envelope for the project tempo", () => {
    // Round-tripping a 116 BPM song through REAPER proved that a
    // `<TEMPOENVEX>` point alone leaves the project at REAPER's default 120 —
    // it re-saved `TEMPO 120 4 4 0`. The flat line is what actually sets it.
    const text = songToRpp(testSong());
    expect(text).not.toContain("<TEMPOENVEX");
    expect(text).toMatch(/^ {2}TEMPO 104 4 4 0$/m);
  });

  it("names each stem track the way the app names it", () => {
    const song = testSong();
    const tracks = parseRpp(songToRpp(song)).tracks;
    expect(tracks.length).toBeGreaterThan(0);
    for (const track of tracks) {
      expect(Object.values(STEM_LABELS)).toContain(track.name);
    }
  });

  it("skips stems the song is silent on instead of writing empty tracks", () => {
    const song = testSong();
    song.sections[0].chords = [];
    song.sections[1].chords = [];
    const parsed = parseRpp(songToRpp(song));
    for (const track of parsed.tracks) {
      expect(track.items.length).toBeGreaterThan(0);
    }
  });

  it("writes each section as a numbered region", () => {
    const parsed = parseRpp(songToRpp(testSong()));
    expect(parsed.regions.map((r) => r.name)).toEqual(["Intro", "Verse"]);
    // Regions are in seconds, and they are ordered on the timeline.
    expect(parsed.regions[0]!.startSec).toBe(0);
    expect(parsed.regions[1]!.startSec).toBeCloseTo((8 * 60) / 104, 4);
  });

  it("numbers repeated sections", () => {
    const song = testSong();
    song.arrangement = [
      { sectionId: "s1", repeats: 1 },
      { sectionId: "s2", repeats: 2 },
    ];
    const names = parseRpp(songToRpp(song)).regions.map((r) => r.name);
    expect(names).toEqual(["Intro", "Verse", "Verse (2)"]);
  });
});

describe("songToRpp — positions are seconds, events are ticks", () => {
  it("places an item at its section's time in seconds, not beats", () => {
    const song = testSong();
    const parsed = parseRpp(songToRpp(song));
    const chordTrack = parsed.tracks.find((t) => t.name === STEM_LABELS.chords);
    if (!chordTrack) throw new Error("no chords track");

    // Intro is 2 bars of 4/4 = 8 beats; at 104 BPM that is 4.615s, not 8s.
    expect(chordTrack.items[0]!.positionSec).toBeCloseTo(0, 6);
    expect(chordTrack.items[1]!.positionSec).toBeCloseTo((8 * 60) / 104, 4);
    expect(chordTrack.items[1]!.positionSec).toBeLessThan(8);
  });

  it("declares the MIDI source resolution it actually uses", () => {
    const parsed = parseRpp(songToRpp(testSong()));
    for (const track of parsed.tracks) {
      for (const item of track.items) expect(item.ppq).toBe(960);
    }
  });

  it("keeps item length in seconds and long enough for its last note", () => {
    const song = testSong();
    const parsed = parseRpp(songToRpp(song));
    for (const track of parsed.tracks) {
      for (const item of track.items) {
        const lastEnd = Math.max(...item.notes.map((n) => n.startBeat + n.durationBeats));
        const lengthBeats = (item.lengthSec * 104) / 60;
        expect(lengthBeats).toBeGreaterThanOrEqual(lastEnd - 0.001);
        expect(item.lengthSec).toBeGreaterThan(0);
      }
    }
  });
});

describe("songToRpp — item boundaries", () => {
  /** A two-bar section holding three 4-beat chords, so the Color pad rings
   *  past the section line — the shape a real catalog song has, and the only
   *  way an item legitimately overruns its section. */
  function crossingSong(): BlueprintSong {
    const song = testSong();
    song.sections = [
      {
        ...song.sections[0]!,
        bars: 2,
        beatsPerChord: 4,
        chords: [
          { id: "c1", romanNumeral: "I", root: "C", quality: "maj", beats: 4 },
          { id: "c2", romanNumeral: "V", root: "G", quality: "maj", beats: 4 },
          { id: "c3", romanNumeral: "vi", root: "A", quality: "min", beats: 4 },
        ],
      },
      { ...song.sections[1]!, bars: 2 },
    ];
    song.arrangement = [
      { sectionId: "s1", repeats: 1 },
      { sectionId: "s2", repeats: 1 },
    ];
    return song;
  }

  it("never clips a note: every item is long enough for its own last note-off", () => {
    for (const song of [testSong(), crossingSong()]) {
      const parsed = parseRpp(songToRpp(song));
      for (const track of parsed.tracks) {
        for (const item of track.items) {
          const lastOff = Math.max(...item.notes.map((n) => n.startBeat + n.durationBeats));
          const lengthBeats = (item.lengthSec * song.bpm) / 60;
          // Seconds→beats round-tripping carries float noise; a tick is 1e-3
          // of a beat, so 1e-6 is far below anything audible.
          expect(lengthBeats).toBeGreaterThanOrEqual(lastOff - 1e-6);
        }
      }
    }
  });

  it("lets a note that rings past the section line keep its tail", () => {
    const song = crossingSong();
    const parsed = parseRpp(songToRpp(song));
    const color = parsed.tracks.find((t) => t.name === STEM_LABELS.color)!;
    // The section is 2 bars = 8 beats; item 1 grows past that to hold the pad.
    const first = color.items[0]!;
    expect(first.notes.some((n) => n.startBeat + n.durationBeats > 8)).toBe(true);
    expect((first.lengthSec * song.bpm) / 60).toBeGreaterThan(8);
  });

  it("keeps the tail's content disjoint from the next item, so nothing double-triggers", () => {
    const song = crossingSong();
    const parsed = parseRpp(songToRpp(song));
    for (const track of parsed.tracks) {
      // Absolute song time identifies a note: relative starts repeat across
      // items, absolute ones don't.
      const all = track.items.flatMap((item) =>
        item.notes.map(
          (n) =>
            `${n.pitch}@${(item.positionSec + (n.startBeat * 60) / song.bpm).toFixed(4)}+${n.durationBeats.toFixed(4)}`,
        ),
      );
      expect(new Set(all).size).toBe(all.length);
    }
  });
});

describe("songToRpp — round trip", () => {
  it("round-trips every stem's notes through the file", () => {
    const song = testSong();
    const spans = sectionSpans(song);
    const expected = expectedNotes(song);
    const parsed = parseRpp(songToRpp(song));

    // Reassemble each track's items back into note-time, then compare with the
    // planner output: same count, same pitches in the same order.
    const actual: Record<string, MidiNote[]> = {};
    for (const track of parsed.tracks) {
      for (const item of track.items) {
        const itemStartBeat = (item.positionSec * 104) / 60;
        for (const note of item.notes) {
          (actual[track.name] ??= []).push({
            pitch: note.pitch,
            startTime: itemStartBeat + note.startBeat,
            duration: note.durationBeats,
            velocity: note.velocity,
          });
        }
      }
    }

    for (const [stem, notes] of Object.entries(expected)) {
      const label = STEM_LABELS[stem as StemId];
      const written = actual[label];
      if (notes.length === 0) {
        expect(written ?? []).toEqual([]);
        continue;
      }
      if (!written) throw new Error(`track ${label} missing`);
      expect(written.length).toBe(notes.length);
      const sortByPitch = (a: MidiNote, b: MidiNote) => a.startTime - b.startTime || a.pitch - b.pitch;
      expect(written.sort(sortByPitch).map((n) => n.pitch)).toEqual(
        [...notes].sort(sortByPitch).map((n) => n.pitch),
      );
      // Timing survives the seconds↔beats conversion to within a millisecond
      // of the section it sits in.
      expect(spans.length).toBeGreaterThan(0);
      for (const note of written) {
        expect(note.startTime).toBeGreaterThanOrEqual(0);
        expect(note.duration).toBeGreaterThan(0);
      }
    }
  });

  it("writes only in-range MIDI bytes", () => {
    const song = testSong();
    song.sections[0].chords = song.sections[0].chords.map((c) => ({ ...c, velocityOverride: 200 }));
    const text = songToRpp(song);
    const eventLines = text.split("\n").filter((l) => l.trim().startsWith("E "));
    expect(eventLines.length).toBeGreaterThan(0);
    for (const line of eventLines) {
      const [, , status, pitch, velocity] = line.trim().split(/\s+/);
      const s = parseInt(status!, 16);
      expect([0x90, 0x80]).toContain(s & 0xf0);
      const p = parseInt(pitch!, 16);
      const v = parseInt(velocity!, 16);
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThanOrEqual(127);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(127);
    }
  });

  it("resolves same-pitch overlaps exactly as the .mid export does", () => {
    const song = testSong();
    // Two planners overlapping a pitch: whatever the source, the file must
    // not contain a note-on on a pitch that is already sounding.
    const text = songToRpp(song);
    const parsed = parseRpp(text);
    for (const track of parsed.tracks) {
      const seen = new Map<string, { start: number; end: number }>();
      for (const item of track.items) {
        for (const note of item.notes) {
          const key = `${item.positionSec}:${note.pitch}`;
          const previous = seen.get(key);
          if (previous) {
            expect(note.startBeat).toBeGreaterThanOrEqual(previous.end);
          }
          seen.set(key, { start: note.startBeat, end: note.startBeat + note.durationBeats });
        }
      }
    }

    // Parity check against the .mid: same note count per stem, because both
    // exports apply the same overlap policy to the same planner output.
    const midi = parseMidiBytes(songToMidi(song));
    const stemTracks = midi.tracks.filter((t) => t.name !== midi.tracks[0]!.name);
    const rppTracks = parsed.tracks;
    for (const track of rppTracks) {
      const midiMatch = stemTracks.find((t) => t.name === track.name);
      if (!midiMatch) continue;
      const midiOns = midiMatch.events.filter(
        (e) => e.type === "noteOn" && (e.velocity ?? 0) > 0,
      ).length;
      const rppOns = track.items.reduce((sum, item) => sum + item.notes.length, 0);
      expect(rppOns).toBe(midiOns);
    }
  });
});

describe("songToRpp — options", () => {
  it("applies outputOffsetBeats by default, like the .mid export", () => {
    const song = testSong();
    song.outputOffsetBeats = 2;
    const parsed = parseRpp(songToRpp(song));
    const chordTrack = parsed.tracks.find((t) => t.name === STEM_LABELS.chords)!;
    const firstNote = chordTrack.items.flatMap((i) => i.notes)[0]!;
    expect(firstNote.startBeat).toBeCloseTo(2, 3);
  });

  it("can write the grid itself instead, for in-app parity", () => {
    const song = testSong();
    song.outputOffsetBeats = 2;
    const parsed = parseRpp(songToRpp(song, { applyOutputOffset: false }));
    const chordTrack = parsed.tracks.find((t) => t.name === STEM_LABELS.chords)!;
    const firstNote = chordTrack.items.flatMap((i) => i.notes)[0]!;
    expect(firstNote.startBeat).toBeCloseTo(0, 3);
  });

  it("escapes quotes in section names rather than breaking the chunk", () => {
    const song = testSong();
    song.sections[0] = { ...song.sections[0]!, name: 'Say "hi"' };
    const parsed = parseRpp(songToRpp(song));
    expect(parsed.regions[0]!.name).toBe("Say 'hi'");
    expect(() => parseRpp(songToRpp(song))).not.toThrow();
  });
});

describe("rppFileName", () => {
  it("slugifies the song title", () => {
    expect(rppFileName("Lalo Chezia")).toBe("lalo-chezia.rpp");
    expect(rppFileName("  Weird // Name!! ")).toBe("weird-name.rpp");
  });
});
