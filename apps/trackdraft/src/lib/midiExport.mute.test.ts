import { describe, expect, it } from "vitest";
import { planDrumStem } from "./midiExport";
import { sectionSpans } from "./arrangement";
import { KIT_PITCHES } from "@drum/library";

/**
 * Lane mute / solo must reach the EXPORT, not just the canvas: the same
 * `drumLaneMute` / `drumLaneSolo` fields the gutter toggles are handed to the
 * shared planner, so the .mid, the live out and the Ableton clips all lose
 * those notes together.
 */
const song = (extra: Record<string, unknown> = {}) =>
  ({
    id: "s1", title: "Mute probe", bpm: 120, key: "C", scale: "ionian",
    arrangement: [],
    sections: [{
      id: "sec1", name: "A", role: "verse", bars: 2,
      timeSignatureNumerator: 4, timeSignatureDenPower: 2,
      velocity: 100, drumPattern: "standard",
      chords: [{ id: "c1", root: "C", quality: "maj", beats: 4 }],
      ...extra,
    }],
  }) as any;

const pitches = (extra: Record<string, unknown> = {}) =>
  planDrumStem(sectionSpans(song(extra)), song(extra)).map((n) => n.pitch);

describe("lane mute / solo in the drum stem", () => {
  it("drops a muted lane's notes and keeps the rest", () => {
    const plain = pitches();
    const muted = pitches({ drumLaneMute: ["snare"] });
    expect(plain).toContain(KIT_PITCHES.snare);
    expect(muted).not.toContain(KIT_PITCHES.snare);
    expect(muted).toContain(KIT_PITCHES.kick);
    expect(muted.length).toBeLessThan(plain.length);
  });

  it("keeps only the soloed lane", () => {
    const soloed = pitches({ drumLaneSolo: ["kick"] });
    expect(soloed).toContain(KIT_PITCHES.kick);
    expect(soloed).not.toContain(KIT_PITCHES.snare);
    expect(soloed).not.toContain(KIT_PITCHES.closedHat);
  });

  it("a muted lane stays silent even when soloed", () => {
    expect(pitches({ drumLaneSolo: ["kick"], drumLaneMute: ["kick"] })).toEqual([]);
  });
});
