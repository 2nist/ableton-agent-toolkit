import { describe, expect, it } from "vitest";
import { DRUM_LANE_VOICES, voiceOf } from "@drum/library";
import { laneHitsFromNotes, resolvePlayedLaneHits, resolveSectionLaneHits } from "./drumLaneHits";
import { planDrumSections, planDrumStem } from "../midiExport";
import { stepIndexOf } from "../drums/stepMath";
import type { BlueprintSection } from "../../types/blueprint";
import type { SectionSpan } from "../arrangement";

const LANE_OF_VOICE = new Map<string, string>();
for (const [lane, voices] of Object.entries(DRUM_LANE_VOICES)) {
  for (const voice of voices as string[]) LANE_OF_VOICE.set(voice, lane);
}

function makeSection(blocks?: BlueprintSection["drumBlocks"]): BlueprintSection {
  return {
    id: "sec-1",
    name: "Verse",
    role: "verse",
    bars: 4,
    chords: [],
    beatsPerChord: 4,
    velocity: "mf",
    timeSignatureNumerator: 4,
    timeSignatureDenPower: 2,
    drumPattern: "standard",
    drumVariantIndex: 0,
    drumBlocks: blocks,
  };
}

describe("resolveSectionLaneHits — the dotted lanes' data source", () => {
  it("resolves the base groove per lane, bounded to the section", () => {
    const hits = resolveSectionLaneHits(makeSection(), undefined, 0);
    expect(hits.get("kick")!.length).toBeGreaterThan(0);
    expect(hits.get("snare")!.length).toBeGreaterThan(0);
    for (const arr of hits.values()) {
      for (const h of arr) {
        expect(h.beat).toBeGreaterThanOrEqual(0);
        expect(h.beat).toBeLessThan(16);
      }
    }
  });

  it("shows the 4-bar cycle the export plays (open hat in bar 2, kick turnaround in bar 4)", () => {
    // The cycle is STRUCTURAL — if the .mid plays it and the dots don't, the
    // grid is lying. Bar 1 has an 8th-note hat grid and no open hat; bar 2
    // opens up on its last eighth.
    const sec = { ...makeSection(), bars: 8 };
    const hits = resolveSectionLaneHits(sec, undefined, 0);
    const openHats = (hits.get("hat") ?? []).filter((h) => h.voice === "openHat").map((h) => h.beat);
    expect(openHats.length, "no open hat in the cycle").toBeGreaterThan(0);
    // 4 + 3.5 = bar 2's last eighth.
    expect(openHats.some((beat) => Math.abs(beat - 7.5) < 0.06)).toBe(true);

    const kicks = (hits.get("kick") ?? []).map((h) => h.beat);
    // 12 + 3.5 = bar 4's last eighth, the turnaround into the next cycle.
    expect(kicks.some((beat) => Math.abs(beat - 15.5) < 0.06)).toBe(true);
  });

  it("compiles an euclid block over the lane's range only", () => {
    const sec = makeSection([
      { id: "b1", lane: "kick", startBeat: 8, endBeat: 12, mode: "euclid", euclid: { k: 2, n: 4, rotation: 0 } },
    ]);
    const hits = resolveSectionLaneHits(sec, undefined, 0);
    const kick = hits.get("kick")!;
    expect(kick.filter((h) => h.beat >= 8 && h.beat < 12).map((h) => h.beat).sort((a, b) => a - b)).toEqual([8, 10]);
    // Base groove outside the block range is untouched.
    expect(kick.some((h) => h.beat < 8)).toBe(true);
    expect(kick.some((h) => h.beat >= 12)).toBe(true);
  });

  it("compiles a steps block as a lane-range replacement (toggle semantics)", () => {
    const sec = makeSection([
      {
        id: "s1", lane: "hat", startBeat: 0, endBeat: 2, mode: "steps",
        notes: [{ beat: 0.5, voice: "closedHat", velocity: 90 }],
      },
    ]);
    const hits = resolveSectionLaneHits(sec, undefined, 0);
    const hatIn = hits.get("hat")!.filter((h) => h.beat < 2);
    expect(hatIn.map((h) => h.beat)).toEqual([0.5]);
    expect(hatIn[0].offGrid).toBe(true);
    expect(hatIn[0].velocity).toBe(90);
    // The rest of the section keeps its base hats.
    expect(hits.get("hat")!.some((h) => h.beat >= 2)).toBe(true);
  });

  it("spreads a cluster across lanes by priority (interleave)", () => {
    const sec = makeSection([
      { id: "c1", lane: "snare", groupId: "g", interleave: true, startBeat: 0, endBeat: 4, mode: "euclid", euclid: { k: 3, n: 4, rotation: 0 } },
      { id: "c2", lane: "tom", groupId: "g", interleave: true, startBeat: 0, endBeat: 4, mode: "euclid", euclid: { k: 3, n: 4, rotation: 0 } },
    ]);
    const hits = resolveSectionLaneHits(sec, undefined, 0);
    // Onsets 0,1,3 → snare, tom, snare.
    expect(hits.get("snare")!.filter((h) => h.beat < 4).map((h) => h.beat)).toEqual([0, 3]);
    expect(hits.get("tom")!.filter((h) => h.beat < 4).map((h) => h.beat)).toEqual([1]);
  });
});

/**
 * Precedence, asserted rather than assumed: a hand-authored range beats the
 * preset it sits on. This is what makes the sequencer and the Euclid editor
 * take effect, and it is the reason a *whole-section* choice has to clear
 * those blocks (see `lib/drums/grooveIntent.ts`) — otherwise the pick would
 * be silently overruled by an edit made against the previous groove.
 */
describe("precedence — authored blocks over the preset", () => {
  it("plays the authored note, not the preset's, inside the block's range", () => {
    const base = resolveSectionLaneHits(makeSection(), undefined, 0).get("kick") ?? [];
    // A kick on an off-beat the `standard` preset does not play.
    const authored = makeSection([
      {
        id: "blk",
        lane: "kick",
        startBeat: 0,
        endBeat: 2,
        mode: "steps",
        notes: [{ beat: 1.5, voice: "kick", velocity: 120 }],
      },
    ]);
    const withBlock = resolveSectionLaneHits(authored, undefined, 0).get("kick") ?? [];
    expect(withBlock.some((h) => Math.abs(h.beat - 1.5) < 1e-6)).toBe(true);
    expect(withBlock.some((h) => h.beat < 2 && Math.abs(h.beat - 1.5) > 1e-6)).toBe(false);
    // Outside the block, the preset is untouched.
    expect(withBlock.some((h) => h.beat >= 2)).toBe(true);
    expect(base.length).toBeGreaterThan(0);
  });

  it("mirrors the Bend: a strong backbeat puts the 2 & 4 snare in the grid", () => {
    // `half_time` has no snare near beats 1 or 3; the export's backbeat
    // inserter adds them when the Bend asks for it, so the grid must too.
    const halfTime = { ...makeSection(), drumPattern: "half_time" as const };
    const plain = resolveSectionLaneHits(halfTime, undefined, 0).get("snare") ?? [];
    const bent = resolveSectionLaneHits(
      { ...halfTime, bend: { backbeat: 1 } },
      undefined,
      0,
    ).get("snare") ?? [];
    expect(plain.some((h) => Math.abs(h.beat - 3) <= 0.25)).toBe(false);
    expect(bent.some((h) => Math.abs(h.beat - 3) < 1e-6)).toBe(true);
    // Nothing the plain groove played is dropped by strengthening.
    for (const hit of plain) {
      expect(bent.some((h) => Math.abs(h.beat - hit.beat) < 1e-6 && h.voice === hit.voice)).toBe(true);
    }
  });

  it("draws the same opening bars the exporter plays", () => {
    const section = { ...makeSection(), bars: 4 };
    const span: SectionSpan = {
      sectionId: section.id,
      section,
      occurrenceIndex: 0,
      startBeat: 0,
      durationBeats: 16,
      startBar: 0,
      bars: 4,
    };
    const step = 0.25;
    const windowEnd = 8; // bars 1–2; fills/transitions own the tail
    const drawn = new Set<string>();
    for (const [lane, list] of resolveSectionLaneHits(section, undefined, 0)) {
      for (const hit of list) {
        if (hit.beat >= windowEnd) continue;
        drawn.add(`${lane}:${stepIndexOf(hit.beat, step)}`);
      }
    }
    const played = new Set<string>();
    for (const note of planDrumStem([span], undefined)) {
      if (note.startTime >= windowEnd) continue;
      const voice = voiceOf(note.pitch as never);
      const lane = voice ? LANE_OF_VOICE.get(voice) : undefined;
      if (!lane) continue;
      played.add(`${lane}:${stepIndexOf(note.startTime, step)}`);
    }
    expect([...drawn].sort()).toEqual([...played].sort());
  });

  it("lets the meter outline beat the preset", () => {
    const outlined = makeSection();
    outlined.drumMeterOutline = { cellBeats: 0.5, cells: [2, 2, 2, 2] as (2 | 3)[], label: "4/4" };
    const presetOnly = makeSection();
    const a = resolveSectionLaneHits(outlined, undefined, 0);
    const b = resolveSectionLaneHits(presetOnly, undefined, 0);
    const total = (m: Map<string, { beat: number }[]>) => [...m.values()].reduce((n, l) => n + l.length, 0);
    expect(total(a)).toBeGreaterThan(0);
    expect(total(a)).not.toBe(total(b));
  });
});

/** One span for a section, so the plan and the lanes are compared on the same
 *  footing. */
function spanFor(section: BlueprintSection, startBeat = 0): SectionSpan {
  return {
    sectionId: section.id,
    section,
    occurrenceIndex: 0,
    startBeat,
    durationBeats: section.bars * 4,
    startBar: 0,
    bars: section.bars,
  };
}

describe("resolvePlayedLaneHits — what the lanes draw is what plays", () => {
  it("draws the export plan beat for beat, fills and all", () => {
    const section = makeSection();
    const spans = [spanFor(section)];
    const played = resolvePlayedLaneHits(spans, undefined, 0);
    const plan = planDrumSections(spans, undefined)[0];

    const drawn = [...played.entries()].flatMap(([lane, hits]) =>
      hits.map((h) => `${lane}:${h.beat.toFixed(4)}:${h.velocity}`),
    ).sort();
    const planned = plan.notes
      .map((n) => {
        const voice = voiceOf(n.pitch as never);
        const lane = voice ? LANE_OF_VOICE.get(voice) : undefined;
        return `${lane}:${n.beat.toFixed(4)}:${n.velocity}`;
      })
      .sort();
    expect(drawn).toEqual(planned);
  });

  it("shows the mid-section detour instead of the pocket it replaces", () => {
    const section = makeSection();
    section.drumVariationOutline = { cells: [3, 3, 3, 3], cellBeats: 2, label: "3" };
    section.drumVariationBars = 1;
    section.drumVariationStartBeat = 8;
    const spans = [spanFor(section)];

    const pocketInWindow = [...resolveSectionLaneHits(section, undefined, 0).values()]
      .flat()
      .filter((h) => h.beat >= 8 && h.beat < 12).length;
    const playedInWindow = [...resolvePlayedLaneHits(spans, undefined, 0).values()]
      .flat()
      .filter((h) => h.beat >= 8 && h.beat < 12).length;

    // The detour is sparser than the pocket, so the drawn count must drop —
    // this is the difference the old ghost overlay only annotated.
    expect(playedInWindow).toBeGreaterThan(0);
    expect(playedInWindow).not.toBe(pocketInWindow);
  });

  it("drops the lanes the planner drops", () => {
    const section = makeSection();
    section.drumLaneMute = ["snare"];
    const played = resolvePlayedLaneHits([spanFor(section)], undefined, 0);
    expect(played.get("snare")).toBeUndefined();
    expect(played.get("kick")!.length).toBeGreaterThan(0);
  });

  it("bins notes by voice into their own lane family", () => {
    const hits = laneHitsFromNotes([{ beat: 1, pitch: 36, velocity: 100 }], makeSection());
    expect(hits.get("kick")).toEqual([
      { beat: 1, velocity: 100, voice: "kick", offGrid: false },
    ]);
  });
});

describe("the lanes a transition rewrites", () => {
  it("draws the fill the export plays in the final bar, not the pocket", () => {
    const section = makeSection();
    section.drumTransitionModel = "buildUp";
    section.drumTransitionBars = 1;
    const spans = [spanFor(section)];

    const cells = (hits: ReturnType<typeof resolvePlayedLaneHits>, step: number) => {
      const out = new Set<string>();
      const stepCount = Math.floor(16 / step);
      for (const [lane, list] of hits) {
        for (const h of list) {
          const idx = stepIndexOf(h.beat, step);
          if (idx >= 0 && idx < stepCount && Math.abs(h.beat - idx * step) <= 0.02) out.add(`${lane}:${idx}`);
        }
      }
      return out;
    };

    const played = resolvePlayedLaneHits(spans, undefined, 0);
    const pocket = resolveSectionLaneHits(section, undefined, 0);
    const inFinalBar = (key: string, step: number) => {
      const idx = Number(key.split(":")[1]);
      return idx * step >= 12;
    };

    // The build-up owns the last bar: the drawn cells there are the fill's.
    const playedFinal = [...cells(played, 0.25)].filter((k) => inFinalBar(k, 0.25));
    const pocketFinal = [...cells(pocket, 0.25)].filter((k) => inFinalBar(k, 0.25));
    expect(playedFinal.length).toBeGreaterThan(0);
    expect(playedFinal).not.toEqual(pocketFinal);
  });
});
