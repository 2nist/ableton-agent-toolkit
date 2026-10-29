import { describe, expect, it } from "vitest";
import { sectionSpans } from "./arrangement";
import { planDrumStem } from "./midiExport";
import type { BlueprintSection, BlueprintSong } from "../types/blueprint";

/**
 * A GOLDEN LOCK on the app's drum output.
 *
 * Row 5 moves variant selection out of the app and into `@drum/library` so the
 * preview, the MIDI export and the Ableton bridge all read one selector. That
 * is a behaviour-preserving refactor or it is a bug — this file is how the
 * difference between the two is detected. Every case here is a distinct path
 * through selection:
 *
 *   auto (heuristic) · explicit preset · explicit variant · muted ·
 *   meter outline · authored blocks · Bend style · narrative · meter change
 *
 * If a value in here changes, the change was intended and reviewed. If one
 * changes by accident, the bridge would have started writing different drum
 * clips than the app previews.
 */

const section = (extra: Partial<BlueprintSection> = {}): BlueprintSection =>
  ({
    id: "sec1",
    name: "Verse",
    role: "verse",
    bars: 2,
    timeSignatureNumerator: 4,
    timeSignatureDenPower: 2,
    velocity: "mf",
    chords: [{ id: "c1", root: "C", quality: "maj", beats: 4 }],
    ...extra,
  }) as unknown as BlueprintSection;

const song = (sections: BlueprintSection[], extra: Partial<BlueprintSong> = {}): BlueprintSong =>
  ({
    id: "song1",
    title: "Golden",
    bpm: 120,
    key: "C",
    scale: "ionian",
    arrangement: [],
    sections,
    ...extra,
  }) as unknown as BlueprintSong;

/** Notes as `pitch@beat` — compact, and diffable by eye. */
const stem = (s: BlueprintSong): string[] =>
  planDrumStem(sectionSpans(s), s).map((n) => `${n.pitch}@${n.startTime}`);

const counts = (s: BlueprintSong) => {
  const notes = planDrumStem(sectionSpans(s), s);
  const byPitch = new Map<number, number>();
  for (const n of notes) byPitch.set(n.pitch, (byPitch.get(n.pitch) ?? 0) + 1);
  return Object.fromEntries([...byPitch.entries()].sort((a, b) => a[0] - b[0]));
};

describe("planDrumStem — golden", () => {
  it("auto: the heuristic picks a groove from role + velocity", () => {
    expect(counts(song([section({ role: "verse", velocity: "mf" })]))).toMatchSnapshot();
  });

  it("auto: a chorus is a different groove from a verse", () => {
    expect(counts(song([section({ role: "chorus", velocity: "mf" })]))).toMatchSnapshot();
  });

  it("explicit preset", () => {
    expect(counts(song([section({ drumPattern: "half_time" })]))).toMatchSnapshot();
  });

  it("explicit variant picks that variant, not the seed's", () => {
    expect(counts(song([section({ drumPattern: "standard", drumVariantIndex: 5 })]))).toMatchSnapshot();
  });

  it("muted: no notes at all", () => {
    expect(stem(song([section({ drumPattern: "none" })]))).toEqual([]);
  });

  it("meter outline with cell voices beats the preset", () => {
    expect(
      counts(
        song([
          section({
            drumPattern: "standard",
            drumMeterOutline: {
              cellBeats: 0.5,
              cells: [2, 2, 3],
              label: "1 2 1 2 3",
              cellVoices: ["kick", "snare", "kick"],
            },
          }),
        ]),
      ),
    ).toMatchSnapshot();
  });

  it("an outline without cell voices gets a default backbeat", () => {
    // It used to degrade to a reference click — hats only. An applied Euclidean
    // pattern now arrives as drums: kick on the bar, snare at its halfway point.
    expect(
      counts(
        song([
          section({
            drumPattern: "standard",
            drumMeterOutline: { cellBeats: 0.5, cells: [2, 2, 3], label: "1 2 1 2 3" },
          }),
        ]),
      ),
    ).toMatchSnapshot();
  });

  it("authored blocks replace the groove in their range", () => {
    const blocks = stem(
      song([
        section({
          drumPattern: "standard",
          drumBlocks: [
            {
              id: "b1",
              lane: "kick",
              startBeat: 0,
              endBeat: 2,
              mode: "steps",
              notes: [{ beat: 1.5, voice: "kick", velocity: 120 }],
            },
          ],
        }),
      ]),
    );
    expect(blocks.filter((n) => n.startsWith("36@"))).toMatchSnapshot();
  });

  it("a Bend style re-seeds the variant", () => {
    expect(
      counts(
        song([section({ drumPattern: "standard" })], {
          bend: { feel: 0.8, backbeat: 0.7 },
        } as Partial<BlueprintSong>),
      ),
    ).toMatchSnapshot();
  });

  it("a meter change resolves one groove per bar length", () => {
    expect(
      counts(
        song([
          section({
            bars: 3,
            drumPattern: "standard",
            meterMap: [
              { bar: 0, numerator: 1, denominator: 2 },
              { bar: 1, numerator: 4, denominator: 4 },
            ],
          }),
        ]),
      ),
    ).toMatchSnapshot();
  });

  it("is deterministic across repeats", () => {
    const s = song([section({ drumPattern: "driving" })]);
    expect(stem(s)).toEqual(stem(s));
  });
});
