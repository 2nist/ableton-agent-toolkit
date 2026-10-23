/**
 * The narrative layer is only real if it reaches every stem. These tests pin
 * the two properties that were silently broken:
 *
 *  1. `structural_warp` re-grids the harmony, so Chords, Bass AND Color must
 *     all land on the same (warped) chord boundaries — the Color layer used
 *     to resolve against the flat grid and reference chords that no longer
 *     existed at those beats.
 *  2. A neutral narrative is a true no-op: the same song without `narrative`
 *     produces byte-identical note times.
 */
import { describe, expect, it } from "vitest";
import { sectionSpans } from "./arrangement";
import { planBassStem, planChordStem, planDrumStem, type MidiNote } from "./midiExport";
import { planColorStem } from "./colorStem";
import { createEmptySong, type Chord, type BlueprintSong, type BlueprintSection, type NarrativeProfile } from "../types/blueprint";

let n = 0;
const chord = (romanNumeral: string, root: string, quality: Chord["quality"]): Chord => ({
  id: `c${++n}`,
  romanNumeral,
  root: root as Chord["root"],
  quality,
  beats: 4,
});

function section(overrides: Partial<BlueprintSection> = {}): BlueprintSection {
  return {
    id: "s1",
    name: "A",
    role: "verse",
    bars: 2,
    chords: [chord("I", "C", "maj"), chord("IV", "F", "maj")],
    beatsPerChord: 4,
    velocity: "mf",
    timeSignatureNumerator: 4,
    timeSignatureDenPower: 2,
    ...overrides,
  };
}

function song(narrative?: NarrativeProfile, sectionNarrative?: NarrativeProfile): BlueprintSong {
  const built = createEmptySong("Narrative");
  built.bpm = 120;
  built.key = "C";
  built.scale = "ionian";
  built.timeSignatureNumerator = 4;
  built.timeSignatureDenominator = 4;
  built.sections = [section(sectionNarrative ? { narrative: sectionNarrative } : {})];
  built.arrangement = [{ sectionId: "s1", repeats: 1 }];
  if (narrative) built.narrative = narrative;
  return built;
}

const WARPED: NarrativeProfile = {
  tension_profile: 0.5,
  rhythmic_energy: 0.5,
  transition_delta: 0,
  structural_warp: 1,
};

const onsets = (notes: MidiNote[]): number[] => [...new Set(notes.map((x) => x.startTime))].sort((a, b) => a - b);

describe("narrative reach across the exported stems", () => {
  it("neutral narrative changes nothing", () => {
    const bare = song();
    const neutral = song({ tension_profile: 0.5, rhythmic_energy: 0.5, transition_delta: 0, structural_warp: 0 });
    for (const stem of [planChordStem, planBassStem, planColorStem, planDrumStem] as const) {
      expect(stem(sectionSpans(neutral), neutral)).toEqual(stem(sectionSpans(bare), bare));
    }
  });

  it("warp re-grids chords, bass and colour onto the same boundaries", () => {
    const warpedSong = song(WARPED);
    const spans = sectionSpans(warpedSong);
    const chordOnsets = onsets(planChordStem(spans, warpedSong));
    const bassOnsets = onsets(planBassStem(spans, warpedSong));
    const colorOnsets = onsets(planColorStem(spans, warpedSong));

    // The warp actually fires: the authored 4-beat grid is subdivided.
    expect(chordOnsets.length).toBeGreaterThan(2);
    // Bass restates each chord exactly on its boundary.
    expect(bassOnsets).toEqual(chordOnsets);
    // The Color layer syncopates AFTER each chord (see biTonal's `sync[]`), so
    // it has one onset per chord, not one per boundary-equal onset. What
    // matters is that it resolves the same number of chords: before the fix it
    // still saw the flat 2-chord grid while the harmony had 4 boundaries.
    expect(colorOnsets).toHaveLength(chordOnsets.length);
    for (const t of colorOnsets) {
      const preceding = chordOnsets.filter((o) => o <= t + 1e-9);
      expect(preceding.length).toBeGreaterThan(0); // never before the first chord
    }
  });

  it("below the warp threshold the authored grid is untouched", () => {
    const soft = song({ ...WARPED, structural_warp: 0.4 });
    const spans = sectionSpans(soft);
    expect(onsets(planChordStem(spans, soft))).toEqual([0, 4]);
    expect(onsets(planColorStem(spans, soft))).toHaveLength(2);
  });

  it("re-seeds the drum groove only for a non-neutral arc", () => {
    // The pick is seeded from the style, so a real arc changes which groove is
    // drawn; an all-neutral arc must leave the historical pick untouched.
    const bare = song();
    const neutralArc = song({ tension_profile: 0.5, rhythmic_energy: 0.5, transition_delta: 0, structural_warp: 0 });
    const realArc = song({ ...WARPED, structural_warp: 0, rhythmic_energy: 1 });
    const drums = (s0: BlueprintSong) => planDrumStem(sectionSpans(s0), s0).map((n) => `${n.pitch}@${n.startTime}`);
    expect(drums(neutralArc)).toEqual(drums(bare));
    expect(drums(realArc)).not.toEqual(drums(bare));
  });

  it("scales chord velocity with energy — bend or narrative", () => {
    // Documents a behaviour change that arrived with the layer: chord velocity
    // used to be the flat CHORD_VELOCITY constant. It is now
    // `styleVelocityTarget(CHORD_VELOCITY, profile)`, so the SAME song exported
    // before a bend is set will differ — neutral energy (0.5) is still exactly
    // the old constant, which is what keeps un-bent songs byte-identical.
    const velocity = (songIn: BlueprintSong) => planChordStem(sectionSpans(songIn), songIn)[0]?.velocity ?? 0;
    const bent = (energy: number) => {
      const s0 = song();
      s0.bend = { energy };
      return s0;
    };
    const flat = velocity(song());
    expect(velocity(bent(0.5))).toBe(flat); // neutral energy → unchanged
    expect(velocity(bent(1))).toBeGreaterThan(flat);
    expect(velocity(bent(0))).toBeLessThan(flat);
    // The narrative's energy axis reaches the same knob with no bend at all.
    const energetic = song({ ...WARPED, structural_warp: 0, tension_profile: 0.5, rhythmic_energy: 1 });
    expect(velocity(energetic)).toBeGreaterThan(flat);
  });

  it("a per-section narrative overrides the song master", () => {
    const masterNeutral = song(undefined, WARPED);
    const spans = sectionSpans(masterNeutral);
    expect(onsets(planChordStem(spans, masterNeutral)).length).toBeGreaterThan(2);
  });
});
