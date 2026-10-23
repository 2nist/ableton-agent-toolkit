import { describe, expect, it } from "vitest";
import { applyNarrativeArc, sampleNarrativeArc } from "./narrativeArc";
import { SONG_MAPS } from "../data/songMaps";

import type { BlueprintSong } from "../types/blueprint";
import type { MapSlot } from "../data/songMaps";

const slot = (tension: number, energy: number, warp = 0): MapSlot => ({
  role: "verse",
  label: "V",
  purpose: "",
  narrative: { tension_profile: tension, rhythmic_energy: energy, transition_delta: 0, structural_warp: warp },
});

function songWith(sectionCount: number): BlueprintSong {
  return {
    id: "s",
    title: "t",
    key: "C",
    scale: "ionian",
    bpm: 120,
    concept: "",
    sections: Array.from({ length: sectionCount }, (_, i) => ({
      id: `s${i}`,
      name: `S${i}`,
      role: "verse",
      bars: 8,
      chords: [],
      beatsPerChord: 4,
      velocity: "mf",
      timeSignatureNumerator: 4,
      timeSignatureDenPower: 2,
    })),
    arrangement: [],
  } as unknown as BlueprintSong;
}

describe("sampleNarrativeArc", () => {
  it("returns the authored arc verbatim when the counts match", () => {
    // The property that matters: an archetype applied to a song of the same
    // length must not drift off its own numbers.
    const slots = [slot(0.9, 0.9), slot(0.5, 0.5), slot(0.15, 0.15)];
    expect(sampleNarrativeArc(slots, 3)).toEqual(slots.map((s) => s.narrative));
  });

  it("reads the same curve at the song's own positions", () => {
    const slots = [slot(1, 1), slot(0, 0)];
    // 5 sections over a 2-point curve: 1, .75, .5, .25, 0
    expect(sampleNarrativeArc(slots, 5).map((n) => n!.tension_profile)).toEqual([1, 0.75, 0.5, 0.25, 0]);
  });

  it("clamps past the ends instead of extrapolating", () => {
    const gapped: MapSlot[] = [
      { role: "intro", label: "I", purpose: "" }, // no arc
      slot(0.8, 0.6),
      { role: "outro", label: "O", purpose: "" }, // no arc
    ];
    const out = sampleNarrativeArc(gapped, 7);
    expect(out.every((n) => n !== undefined)).toBe(true);
    expect(out[0]!.tension_profile).toBe(0.8); // before the only control point
    expect(out[6]!.tension_profile).toBe(0.8); // after it
  });

  it("treats a slot without an arc as a gap, not a zero", () => {
    const out = sampleNarrativeArc([slot(0.6, 0.6), { role: "verse", label: "V", purpose: "" }], 2);
    expect(out[0]!.tension_profile).toBe(0.6);
    expect(out[1]!.tension_profile).toBe(0.6); // held, not dropped to 0
  });

  it("says nothing at all when the template carries no arc", () => {
    const out = sampleNarrativeArc([{ role: "verse", label: "V", purpose: "" }], 4);
    expect(out).toEqual([undefined, undefined, undefined, undefined]);
  });
});

describe("applyNarrativeArc", () => {
  const map = SONG_MAPS.find((m) => m.id === "inverted-matrix")!;

  it("re-shapes the arc without touching structure, chords or meter", () => {
    const song = songWith(5);
    song.sections[2].chords = [{ root: "C", quality: "maj", beats: 4 } as never];
    const out = applyNarrativeArc(song, map);
    expect(out.sections.map((s) => s.id)).toEqual(song.sections.map((s) => s.id));
    expect(out.sections[2].chords).toBe(song.sections[2].chords);
    expect(out.sections.map((s) => s.name)).toEqual(song.sections.map((s) => s.name));
    // …and every section now carries the template's arc
    expect(out.sections.map((s) => s.narrative?.tension_profile)).toEqual(
      map.slots.map((s) => s.narrative!.tension_profile),
    );
  });

  it("fits the same shape onto a song of a different length", () => {
    const out = applyNarrativeArc(songWith(9), map);
    const tensions = out.sections.map((s) => s.narrative!.tension_profile);
    expect(tensions).toHaveLength(9);
    expect(tensions[0]).toBe(map.slots[0].narrative!.tension_profile); // starts at the peak
    expect(tensions[8]).toBe(map.slots[map.slots.length - 1].narrative!.tension_profile); // ends settled
    // monotone descent, like the template's own shape
    for (let i = 1; i < tensions.length; i++) {
      expect(tensions[i]).toBeLessThanOrEqual(tensions[i - 1]);
    }
  });

  it("leaves the song's own master alone when the template has none", () => {
    const mine = { tension_profile: 0.3, rhythmic_energy: 0.3, transition_delta: 0, structural_warp: 0 };
    const out = applyNarrativeArc({ ...songWith(3), narrative: mine }, map);
    expect(out.narrative).toEqual(mine);
  });

  it("does nothing to a song with no sections", () => {
    const out = applyNarrativeArc(songWith(0), map);
    expect(out.sections).toEqual([]);
  });
});
