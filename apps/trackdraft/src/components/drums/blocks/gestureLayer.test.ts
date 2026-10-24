import { describe, expect, it } from "vitest";
import { gestureLayerFor } from "./gestureLayer";
import { planDrumStem } from "../../../lib/midiExport";
import { resolveSectionLaneHits } from "../../../lib/timeline/drumLaneHits";
import { sectionSpans } from "../../../lib/arrangement";

/**
 * The gesture layer must show exactly the gap between "what plays" and "what
 * the grid draws" — no invented material, and nothing at all when the two
 * agree.
 */
const song = (extra: Record<string, unknown> = {}) =>
  ({
    id: "s1", title: "Gesture probe", bpm: 120, key: "C", scale: "ionian",
    arrangement: [],
    sections: [{
      id: "sec1", name: "A", role: "verse", bars: 4,
      timeSignatureNumerator: 4, timeSignatureDenPower: 2,
      velocity: 100, drumPattern: "standard",
      chords: [{ id: "c1", root: "C", quality: "maj", beats: 4 }],
      ...extra,
    }],
  }) as any;

const layerFor = (extra: Record<string, unknown> = {}) => {
  const s = song(extra);
  const spans = sectionSpans(s);
  return gestureLayerFor(s, spans, spans[0]);
};

const flat = (layer: ReturnType<typeof layerFor>) => {
  if (!layer) return { ghosts: [] as { beat: number; authored: boolean }[], suppressed: [] as number[] };
  return {
    ghosts: [...layer.values()].flatMap((l) => l.ghosts),
    suppressed: [...layer.values()].flatMap((l) => l.suppressed),
  };
};

describe("gestureLayer — what plays vs what the grid draws", () => {
  it("says nothing when the two sides agree", () => {
    // no authored gesture; the section's auto plan happens to roll a clean
    // handoff, so there is nothing to show
    const s = song();
    const spans = sectionSpans(s);
    const planned = planDrumStem(spans, s).length;
    const drawn = [...resolveSectionLaneHits(spans[0].section, s, 0).values()].reduce((n, l) => n + l.length, 0);
    if (planned === drawn) expect(layerFor()).toBeNull();
  });

  it("a detour REPLACES: it strikes the groove's hits rather than adding ghosts", () => {
    const { ghosts, suppressed } = flat(
      layerFor({
        drumVariationOutline: { cells: [3, 3, 3, 3], cellBeats: 2, label: "3" },
        drumVariationBars: 1,
        drumVariationStartBeat: 8,
      }),
    );
    // A sparse detour keeps a couple of the base hits and drops the rest, so
    // the honest picture is struck cells — not extra marks. (This is the
    // whole reason the layer is a window override and not "ghosts on top".)
    expect(suppressed.length).toBeGreaterThan(0);
    expect(ghosts.length).toBe(0);
    expect(Math.min(...suppressed)).toBeGreaterThanOrEqual(8 - 1e-9);
    expect(Math.max(...suppressed)).toBeLessThan(12 + 1e-9);
  });

  it("a build-up ADDS ghosts, drawn solid because the gesture is authored", () => {
    const s = song({ drumTransitionModel: "buildUp", drumTransitionBars: 1 });
    const spans = sectionSpans(s);
    const { ghosts } = flat(gestureLayerFor(s, spans, spans[0]));
    expect(ghosts.length).toBeGreaterThan(0);
    expect(ghosts.every((g) => g.authored)).toBe(true);
  });

  it("the planner's own transition adds grey ghosts (not the user's)", () => {
    const s = {
      id: "s1", title: "g", bpm: 120, key: "C", scale: "ionian", arrangement: [],
      sections: [
        { id: "a", name: "A", role: "verse", bars: 4, timeSignatureNumerator: 4, timeSignatureDenPower: 2, velocity: 100, drumPattern: "standard", chords: [{ id: "a1", root: "C", quality: "maj", beats: 4 }] },
        { id: "b", name: "B", role: "chorus", bars: 4, timeSignatureNumerator: 4, timeSignatureDenPower: 2, velocity: 100, drumPattern: "standard", chords: [{ id: "b1", root: "C", quality: "maj", beats: 4 }] },
      ],
    } as any;
    const spans = sectionSpans(s);
    const { ghosts } = flat(gestureLayerFor(s, spans, spans[0]));
    expect(ghosts.length).toBeGreaterThan(0);
    expect(ghosts.every((g) => !g.authored)).toBe(true);
  });

  it("follows the detour wherever it is placed", () => {
    const early = flat(
      layerFor({ drumVariationOutline: { cells: [3], cellBeats: 2, label: "3" }, drumVariationBars: 1, drumVariationStartBeat: 0 }),
    );
    expect(early.ghosts.every((g) => g.beat < 4 + 1e-9)).toBe(true);
    expect(early.suppressed.some((b) => b < 4)).toBe(true);
  });

  it("drops a muted lane from both sides", () => {
    const layer = layerFor({
      drumVariationOutline: { cells: [3, 3, 3, 3], cellBeats: 2, label: "3" },
      drumVariationBars: 1,
      drumVariationStartBeat: 8,
      drumLaneMute: ["hat"],
    });
    expect(layer?.get("hat")?.ghosts ?? []).toEqual([]);
    expect(layer?.get("hat")?.suppressed ?? []).toEqual([]);
  });

  it("is memoised on the section object", () => {
    const s = song({ drumTransitionModel: "cut", drumTransitionBars: 1 });
    const spans = sectionSpans(s);
    const a = gestureLayerFor(s, spans, spans[0]);
    const b = gestureLayerFor(s, spans, spans[0]);
    expect(a).toBe(b);
  });
});
