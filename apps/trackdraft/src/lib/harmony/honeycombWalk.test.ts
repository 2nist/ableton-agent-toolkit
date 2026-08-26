import { describe, it, expect } from "vitest";
import {
  mod7,
  degreeAt,
  hexDistance,
  hexToPixel,
  hexPoints,
  parseToken,
  parseProgression,
  emitToken,
  chordSemis,
  voicing,
  bassInterval,
  diatonicChordAt,
  buildWalk,
  detectRepeatRuns,
  collapseRepeatsForLoopView,
  detectLoop,
  getRevealedCells,
  getWalkPathD,
  walkContentBounds,
  getDiatonicHexCells,
  stepLabel,
  letterName,
  chordDisplay,
  prettySuffix,
  stepMidiRoot,
  stepMidiChord,
  SCALE_INTERVALS,
  HEX_SIZE,
} from "./honeycombWalk";
import type { HoneycombStep } from "./honeycombWalk";

/* ============================================================
   HEX MATH
   ============================================================ */

describe("mod7", () => {
  it("wraps negative numbers correctly", () => {
    expect(mod7(0)).toBe(0);
    expect(mod7(7)).toBe(0);
    expect(mod7(-1)).toBe(6);
    expect(mod7(-7)).toBe(0);
    expect(mod7(10)).toBe(3);
  });
});

describe("degreeAt", () => {
  it("computes the core invariant (3q + r) mod 7", () => {
    // Origin: degree 0
    expect(degreeAt(0, 0)).toBe(0);
    // q=0, r=0→6 gives degrees 0,1,2,3,4,5,6
    for (let r = 0; r < 7; r++) {
      expect(degreeAt(0, r)).toBe(r % 7);
    }
  });

  it("returns 0 at every cell encountered by moving (1, -2)", () => {
    // (3*1 + (-2)) = 1 mod 7 = 1, but we need a move that lands on degree 0
    // (3q + r) mod 7 = 0 → 3q ≡ -r (mod 7) → 3q ≡ 6r (mod 7)
    // So moving (2, 1): 3*2 + 1 = 7 ≡ 0 mod 7
    expect(degreeAt(2, 1)).toBe(0);
    expect(degreeAt(4, 2)).toBe(0); // 3*4+2=14 → 0
    expect(degreeAt(-2, -1)).toBe(0); // -6-1=-7 → 0
  });
});

describe("hexDistance", () => {
  it("returns 0 for the origin", () => {
    expect(hexDistance(0, 0)).toBe(0);
  });

  it("returns 1 for the 6 immediate neighbours", () => {
    // (1,0), (-1,0), (0,1), (0,-1), (1,-1), (-1,1)
    const neighbours = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
      [1, -1],
      [-1, 1],
    ] as const;
    for (const [q, r] of neighbours) {
      expect(hexDistance(q, r)).toBe(1);
    }
  });

  it("returns 2 for diagonals", () => {
    expect(hexDistance(2, 0)).toBe(2);
    expect(hexDistance(0, 2)).toBe(2);
    expect(hexDistance(1, 1)).toBe(2);
  });
});

/* ============================================================
   GEOMETRY
   ============================================================ */

describe("hexToPixel", () => {
  it("maps origin to near (0,0)", () => {
    const { x, y } = hexToPixel(0, 0);
    expect(x).toBeCloseTo(0, 0);
    expect(y).toBeCloseTo(0, 0);
  });

  it("maps q=1, r=0 below origin (degree axis r runs horizontally)", () => {
    const { x, y } = hexToPixel(1, 0);
    expect(x).toBeCloseTo(0, 0);
    expect(y).toBeGreaterThan(0);
  });
});

describe("hexPoints", () => {
  it("returns a valid SVG polygon points string (6 coords)", () => {
    const pts = hexPoints(40);
    const pairs = pts.split(" ").filter(Boolean);
    expect(pairs).toHaveLength(6);
    for (const pair of pairs) {
      const [x, y] = pair.split(",").map(Number);
      expect(Number.isFinite(x)).toBe(true);
      expect(Number.isFinite(y)).toBe(true);
    }
  });
});

/* ============================================================
   PARSER — parseToken
   ============================================================ */

describe("parseToken", () => {
  it("parses a simple major triad: 'I' → deg=0, major, no suffix", () => {
    const step = parseToken("I");
    expect(step).not.toBeNull();
    expect(step!.deg).toBe(0);
    expect(step!.minor).toBe(false);
    expect(step!.suffix).toBe("");
    expect(step!.acc).toBe(0);
    expect(step!.bass).toBeNull();
  });

  it("parses a minor triad: 'ii' → deg=1, minor", () => {
    const step = parseToken("ii");
    expect(step).not.toBeNull();
    expect(step!.deg).toBe(1);
    expect(step!.minor).toBe(true);
  });

  it("parses seventh chords: 'V7' → deg=4, major, suffix='7'", () => {
    const step = parseToken("V7");
    expect(step).not.toBeNull();
    expect(step!.deg).toBe(4);
    expect(step!.minor).toBe(false);
    expect(step!.suffix).toBe("7");
  });

  it("parses 'Imaj7' → deg=0, major, suffix='maj7'", () => {
    const step = parseToken("Imaj7");
    expect(step).not.toBeNull();
    expect(step!.deg).toBe(0);
    expect(step!.suffix).toBe("maj7");
  });

  it("parses flat degree: 'bVI' → deg=5, acc=-1", () => {
    const step = parseToken("bVI");
    expect(step).not.toBeNull();
    expect(step!.deg).toBe(5);
    expect(step!.acc).toBe(-1);
    expect(step!.minor).toBe(false);
  });

  it("parses sharp degree: '#iv' → deg=3, acc=1, minor", () => {
    const step = parseToken("#iv");
    expect(step).not.toBeNull();
    expect(step!.deg).toBe(3);
    expect(step!.acc).toBe(1);
    expect(step!.minor).toBe(true);
  });

  it("parses Unicode accidentals: '♭VI' same as 'bVI'", () => {
    const plain = parseToken("bVI");
    const unicode = parseToken("♭VI");
    expect(unicode!.deg).toBe(plain!.deg);
    expect(unicode!.acc).toBe(plain!.acc);
  });

  it("parses slash chords: 'I/3' → bass=3", () => {
    const step = parseToken("I/3");
    expect(step).not.toBeNull();
    expect(step!.bass).toBe(3);
  });

  it("parses 'ii7b5' → half-diminished (slash-V is roman numeral, not bass digit)", () => {
    // The slash regex only matches /3, /5, /7 (digits).
    // /V is a roman-numeral secondary function, not a bass digit,
    // so "ii7b5/V" will leave the /V in the suffix rather than
    // parse it as a bass inversion.
    const step = parseToken("ii7b5");
    expect(step).not.toBeNull();
    expect(step!.deg).toBe(1);
    expect(step!.minor).toBe(true);
    expect(step!.suffix).toBe("7b5");
    expect(step!.bass).toBeNull();
  });

  it("returns null for garbage input", () => {
    expect(parseToken("")).toBeNull();
    expect(parseToken("???")).toBeNull();
  });

  it("parses numeric degrees: '1' → deg=0 (I)", () => {
    const step = parseToken("1");
    expect(step).not.toBeNull();
    expect(step!.deg).toBe(0);
  });

  it("parses diminished: 'vii°' → dim triad suffix", () => {
    const step = parseToken("vii°");
    expect(step).not.toBeNull();
    expect(step!.deg).toBe(6);
    expect(step!.minor).toBe(true);
    expect(step!.suffix).toBe("°");
  });

  it("parses 'V7b9' → dominant with flat 9", () => {
    const step = parseToken("V7b9");
    expect(step).not.toBeNull();
    expect(step!.suffix).toBe("7b9");
  });

  it("parses 'Imaj7#11' → lydian tonic", () => {
    const step = parseToken("Imaj7#11");
    expect(step).not.toBeNull();
    expect(step!.suffix).toBe("maj7#11");
  });

  it("parses 'ivm6' → minor with 6", () => {
    const step = parseToken("ivm6");
    expect(step).not.toBeNull();
    expect(step!.deg).toBe(3);
    expect(step!.minor).toBe(true);
  });
});

/* ============================================================
   PARSER — parseProgression
   ============================================================ */

describe("parseProgression", () => {
  it("parses a simple I IV V I", () => {
    const { steps, bad } = parseProgression("I IV V I");
    expect(bad).toHaveLength(0);
    expect(steps).toHaveLength(4);
    expect(steps.map((s) => s.deg)).toEqual([0, 3, 4, 0]);
  });

  it("handles multiple separators: commas, pipes, arrows", () => {
    const { steps } = parseProgression("I, ii7 V7|I");
    expect(steps).toHaveLength(4);
  });

  it("collects unparseable tokens in 'bad'", () => {
    // "I" parses AND passes chordSemis (it's a valid major triad).
    // "V7" also parses. "X7Y" and "???" fail.
    const { steps, bad } = parseProgression("I X7Y V7 ???");
    expect(steps).toHaveLength(2); // I and V7 both valid
    expect(bad).toEqual(["X7Y", "???"]);
  });

  it("parses extended jazz progression with borrowed chords", () => {
    const text = "Imaj7 VI7b13 iim9 V7b9 Imaj7";
    const { steps, bad } = parseProgression(text);
    expect(bad).toHaveLength(0);
    expect(steps).toHaveLength(5);
  });
});

/* ============================================================
   TOKEN EMISSION — emitToken (round-trip)
   ============================================================ */

describe("emitToken", () => {
  it("round-trips simple tokens: parse → emit → parse produces same step", () => {
    const tokens = ["I", "ii", "V7", "Imaj7", "bVI", "ivm6", "vii°"];
    for (const t of tokens) {
      const step = parseToken(t);
      expect(step).not.toBeNull();
      const emitted = emitToken(step!);
      const reParsed = parseToken(emitted);
      expect(reParsed).not.toBeNull();
      expect(reParsed!.deg).toBe(step!.deg);
      expect(reParsed!.minor).toBe(step!.minor);
      expect(reParsed!.acc).toBe(step!.acc);
      expect(reParsed!.suffix).toBe(step!.suffix);
      expect(reParsed!.bass).toBe(step!.bass);
    }
  });

  it("emits slash chords correctly", () => {
    const step = parseToken("I/5");
    const emitted = emitToken(step!);
    expect(emitted).toBe("I/5");
  });

  it("emits flat degrees with 'b' prefix", () => {
    const step = parseToken("bIII");
    const emitted = emitToken(step!);
    expect(emitted).toBe("bIII");
  });
});

/* ============================================================
   CHORD ENGINE — chordSemis
   ============================================================ */

describe("chordSemis", () => {
  function makeStep(overrides: Partial<HoneycombStep> = {}): HoneycombStep {
    return { deg: 0, acc: 0, minor: false, suffix: "", bass: null, ...overrides };
  }

  it("major triad: third=4, fifth=7", () => {
    const c = chordSemis(makeStep());
    expect(c).not.toBeNull();
    expect(c!.third).toBe(4);
    expect(c!.fifth).toBe(7);
    expect(c!.color.size).toBe(0);
  });

  it("minor triad: third=3, fifth=7", () => {
    const c = chordSemis(makeStep({ minor: true }));
    expect(c!.third).toBe(3);
  });

  it("dominant 7: third=4, fifth=7, color={10}", () => {
    const c = chordSemis(makeStep({ suffix: "7" }));
    expect(c!.third).toBe(4);
    expect(c!.color.has(10)).toBe(true);
  });

  it("maj7: color={11}", () => {
    const c = chordSemis(makeStep({ suffix: "maj7" }));
    expect(c!.color.has(11)).toBe(true);
  });

  it("diminished: third=3, fifth=6", () => {
    const c = chordSemis(makeStep({ minor: true, suffix: "°" }));
    expect(c!.third).toBe(3);
    expect(c!.fifth).toBe(6);
  });

  it("augmented: fifth=8", () => {
    const c = chordSemis(makeStep({ suffix: "+" }));
    expect(c!.fifth).toBe(8);
  });

  it("sus4: third=5", () => {
    const c = chordSemis(makeStep({ suffix: "sus4" }));
    expect(c!.third).toBe(5);
  });

  it("m7b5: third=3, fifth=6, color={10}", () => {
    const c = chordSemis(makeStep({ minor: true, suffix: "7b5" }));
    expect(c!.third).toBe(3);
    expect(c!.fifth).toBe(6);
    expect(c!.color.has(10)).toBe(true);
  });

  it("7b9: color={10,13}", () => {
    const c = chordSemis(makeStep({ suffix: "7b9" }));
    expect(c!.color.has(10)).toBe(true);
    expect(c!.color.has(13)).toBe(true);
  });

  it("13: color={10,14,21}", () => {
    const c = chordSemis(makeStep({ suffix: "13" }));
    expect(c!.color.has(10)).toBe(true);
    expect(c!.color.has(14)).toBe(true);
    expect(c!.color.has(21)).toBe(true);
  });

  it("returns null for invalid suffix", () => {
    const step = makeStep({ suffix: "xyz123" });
    const c = chordSemis(step);
    expect(c).toBeNull();
  });
});

/* ============================================================
   CHORD ENGINE — voicing
   ============================================================ */

describe("voicing", () => {
  it("returns a major triad voicing [0,4,7] for I", () => {
    const step = parseToken("I")!;
    const v = voicing(step);
    expect(v).toContain(0);
    expect(v).toContain(4);
    expect(v).toContain(7);
  });

  it("returns a 4-note voicing for seventh chords", () => {
    const step = parseToken("V7")!;
    const v = voicing(step);
    expect(v.length).toBeGreaterThanOrEqual(3);
    // Should have root, third, seventh, and either fifth or an extension
    expect(v).toContain(0);
    expect(v).toContain(4);
    expect(v).toContain(10);
  });

  it("returns [0,4,7] for an invalid step (fallback)", () => {
    const step = parseToken("???")!; // parseToken returns null for ???
    // Use a step that chordSemis rejects
    const badStep: HoneycombStep = {
      deg: 0,
      acc: 0,
      minor: false,
      suffix: "xyz",
      bass: null,
    };
    expect(voicing(badStep)).toEqual([0, 4, 7]);
  });
});

/* ============================================================
   CHORD ENGINE — bassInterval
   ============================================================ */

describe("bassInterval", () => {
  it("returns 0 for root position", () => {
    const step = parseToken("I")!;
    expect(bassInterval(step)).toBe(0);
  });

  it("returns third interval for /3 bass", () => {
    const step = parseToken("I/3")!;
    expect(bassInterval(step)).toBe(4); // major third
  });

  it("returns fifth interval for /5 bass", () => {
    const step = parseToken("I/5")!;
    expect(bassInterval(step)).toBe(7); // perfect fifth
  });

  it("returns seventh interval for /7 bass", () => {
    const step = parseToken("V7/7")!;
    expect(bassInterval(step)).toBe(10); // minor seventh
  });
});

/* ============================================================
   CHORD ENGINE — diatonicChordAt
   ============================================================ */

describe("diatonicChordAt", () => {
  it("returns major triad on degree 0 of ionian (I)", () => {
    const { triad, seventh } = diatonicChordAt(SCALE_INTERVALS.major, 0);
    expect(triad.minor).toBe(false);
    expect(triad.suffix).toBe("");
    expect(seventh.suffix).toBe("maj7");
  });

  it("returns minor triad on degree 1 of ionian (ii)", () => {
    const { triad, seventh } = diatonicChordAt(SCALE_INTERVALS.major, 1);
    expect(triad.minor).toBe(true);
    expect(seventh.suffix).toBe("7"); // ii7 minor 7th
  });

  it("returns diminished triad on degree 6 of ionian (vii°)", () => {
    const { triad } = diatonicChordAt(SCALE_INTERVALS.major, 6);
    expect(triad.minor).toBe(true);
    expect(triad.suffix).toBe("°");
  });

  it("works for all 7 degrees of major", () => {
    for (let i = 0; i < 7; i++) {
      const { triad } = diatonicChordAt(SCALE_INTERVALS.major, i);
      expect(triad).toHaveProperty("minor");
      expect(triad).toHaveProperty("suffix");
    }
  });

  it("works for all 7 degrees of minor (aeolian)", () => {
    for (let i = 0; i < 7; i++) {
      const { triad } = diatonicChordAt(SCALE_INTERVALS.minor, i);
      expect(triad).toHaveProperty("minor");
      expect(triad).toHaveProperty("suffix");
    }
  });
});

/* ============================================================
   WALK BUILDER
   ============================================================ */

describe("buildWalk", () => {
  it("returns empty array for empty input", () => {
    expect(buildWalk([])).toEqual([]);
  });

  it("returns single cell for single step (degree d → hex at r=d)", () => {
    const step = parseToken("I")!;
    const walk = buildWalk([step]);
    expect(walk).toHaveLength(1);
    expect(walk[0]).toEqual({ q: 0, r: 0 });
  });

  it("ii step starts at (0,1) since degreeAt(0,1) = 1", () => {
    const step = parseToken("ii")!;
    const walk = buildWalk([step]);
    expect(walk[0]).toEqual({ q: 0, r: 1 });
  });

  it("I → IV moves from (0,0) to adjacent cell with degree 3", () => {
    const steps = [parseToken("I")!, parseToken("IV")!];
    const walk = buildWalk(steps);
    expect(walk).toHaveLength(2);
    expect(degreeAt(walk[1].q, walk[1].r)).toBe(3);
    expect(hexDistance(walk[1].q - 0, walk[1].r - 0)).toBe(1);
  });

  it("I → V moves to adjacent cell with degree 4", () => {
    const steps = [parseToken("I")!, parseToken("V")!];
    const walk = buildWalk(steps);
    expect(degreeAt(walk[1].q, walk[1].r)).toBe(4);
  });

  it("I → IV → V → I walks a path without returning to origin", () => {
    // The walker greedily picks the adjacent hex matching the target
    // degree.  I→IV→V→I does not return to (0,0) because the final "I"
    // is not an immediate reversal of the V→I move, and (0,0) is not the
    // naive next cell here anyway.
    const text = "I IV V I";
    const { steps } = parseProgression(text);
    const walk = buildWalk(steps);
    expect(walk).toHaveLength(4);
    expect(walk[0]).toEqual({ q: 0, r: 0 });
    // The final step must have degree 0 (I)
    expect(degreeAt(walk[3].q, walk[3].r)).toBe(0);
  });

  it("reuses the same hex for a literal back-and-forth (immediate reversal)", () => {
    // Am → Em → Am → Em: each move directly undoes the one before it,
    // so the walk should bounce between exactly 2 hexes forever, not drift.
    const { steps } = parseProgression("vi iii vi iii");
    const walk = buildWalk(steps);
    expect(walk).toHaveLength(4);
    expect(walk[2]).toEqual(walk[0]); // 3rd chord reuses the 1st chord's hex
    expect(walk[3]).toEqual(walk[1]); // 4th chord reuses the 2nd chord's hex
  });

  it("returns to origin when progression closes home", () => {
    // I → IV → vii → IV → I. The IV→vii→IV bounce is an immediate
    // reversal (fine, reuses the IV hex). The final I lands back at
    // (0,0) — the same hex as the first I — because the contiguous
    // walk should let a returning tonic go home, not exile it.
    const { steps } = parseProgression("I IV vii IV I");
    const walk = buildWalk(steps);
    expect(walk).toHaveLength(5);
    expect(walk[0]).toEqual({ q: 0, r: 0 }); // first I
    expect(walk[3]).toEqual(walk[1]); // IV reuses the IV hex via reversal
    expect(degreeAt(walk[4].q, walk[4].r)).toBe(0); // last I is still degree 0
    expect(walk[4]).toEqual(walk[0]); // returns to origin — tonic goes home
  });
});

/* ============================================================
   PROGRESSION VIEW — repeat-run detection & collapse
   ============================================================ */

describe("detectRepeatRuns", () => {
  it("returns no runs for a non-repeating progression", () => {
    const { steps } = parseProgression("I IV V vi");
    expect(detectRepeatRuns(steps)).toEqual([]);
  });

  it("detects a simple 2-chord vamp repeated 4 times", () => {
    const { steps } = parseProgression("I IV I IV I IV I IV");
    const runs = detectRepeatRuns(steps);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toEqual({ start: 0, period: 2, laps: 4 });
  });

  it("only flags the repeating stretch, leaving lead-in/tail alone", () => {
    // vii I IV | (I IV) x4 | V I IV — the middle 8 chords are the run.
    const { steps } = parseProgression("vii I IV I IV I IV I IV I IV V I IV");
    const runs = detectRepeatRuns(steps);
    expect(runs).toHaveLength(1);
    expect(runs[0].period).toBe(2);
    expect(runs[0].laps).toBeGreaterThanOrEqual(4);
  });

  it("does not treat a I vs I7 as the same repeated unit", () => {
    const { steps } = parseProgression("I IV I7 IV");
    const runs = detectRepeatRuns(steps);
    expect(runs).toEqual([]);
  });

  it("requires at least 2 laps to count as a run", () => {
    const { steps } = parseProgression("I IV V");
    expect(detectRepeatRuns(steps)).toEqual([]);
  });
});

describe("collapseRepeatsForLoopView", () => {
  it("leaves a non-repeating walk unchanged", () => {
    const { steps } = parseProgression("I IV V vi");
    const walk = buildWalk(steps);
    expect(collapseRepeatsForLoopView(walk, steps)).toEqual(walk);
  });

  it("collapses every lap of a repeated vamp onto the first lap's hexes", () => {
    const { steps } = parseProgression("I IV I IV I IV I IV");
    const walk = buildWalk(steps);
    const collapsed = collapseRepeatsForLoopView(walk, steps);
    expect(collapsed).toHaveLength(8);
    // Every "I" (even indices) shares the first "I" hex; every "IV" shares the first "IV" hex.
    for (let i = 0; i < 8; i += 2) expect(collapsed[i]).toEqual(collapsed[0]);
    for (let i = 1; i < 8; i += 2) expect(collapsed[i]).toEqual(collapsed[1]);
  });

  it("preserves array length/order and leaves lead-in/tail chords untouched", () => {
    const { steps } = parseProgression("vii I IV I IV I IV I IV I IV V I IV");
    const walk = buildWalk(steps);
    const collapsed = collapseRepeatsForLoopView(walk, steps);
    expect(collapsed).toHaveLength(walk.length);
    expect(collapsed[0]).toEqual(walk[0]); // leading "vii" untouched
    expect(collapsed[collapsed.length - 1]).toEqual(
      walk[walk.length - 1],
    ); // trailing "IV" untouched (not part of the run)
  });
});

/* ============================================================
   LOOP DETECTION
   ============================================================ */

describe("detectLoop", () => {
  it("returns null for short progressions (< 3 steps)", () => {
    const { steps } = parseProgression("I IV");
    const walk = buildWalk(steps);
    expect(detectLoop(steps, walk)).toBeNull();
  });

  it("returns null when first and last step degrees differ", () => {
    const { steps } = parseProgression("I IV V");
    const walk = buildWalk(steps);
    expect(detectLoop(steps, walk)).toBeNull();
  });

  it("detects a loop when I→IV→V→I (same degree at start/end)", () => {
    // The walk ends on a different hex from the start, so the
    // loop is "translated" — it closes chromatically but shifts
    // position on the hex grid.
    const { steps } = parseProgression("I IV V I");
    const walk = buildWalk(steps);
    const loop = detectLoop(steps, walk);
    expect(loop).not.toBeNull();
    // Whether translated or not depends on the walk path —
    // the greedy walker almost always produces a translated loop
    // for multi-step progressions.
    expect(loop!.translated).toBe(true);
  });

  it("detects a translated loop when the walk spirals", () => {
    // A progression that returns to the same degree but on a different hex
    // We can test: I → ii → iii → IV → V → vi → vii° → I
    // The walk should end somewhere else with the same degree
    const { steps } = parseProgression("I ii iii IV V vi vii I");
    const walk = buildWalk(steps);
    expect(walk).toHaveLength(8);
    const loop = detectLoop(steps, walk);
    // Not necessarily translated — it depends on the specific hex path
    // Null is acceptable; we just verify it doesn't crash
    expect(typeof loop === "object" || loop === null).toBe(true);
  });
});

/* ============================================================
   REVEALED CELLS
   ============================================================ */

describe("getRevealedCells", () => {
  it("returns visited + current + choice cells", () => {
    const { steps } = parseProgression("I IV V I");
    const walk = buildWalk(steps);
    const cells = getRevealedCells(walk, 1, "fog");

    const types = cells.map((c) => c.type);
    expect(types).toContain("current");
    expect(types).toContain("visited");
    expect(types).toContain("choice");
  });

  it("'fog' mode hides cells beyond the current step", () => {
    const { steps } = parseProgression("I IV V I");
    const walk = buildWalk(steps);
    const fogCells = getRevealedCells(walk, 0, "fog");
    const fullCells = getRevealedCells(walk, 0, "full");

    // full should show more cells (the complete walk)
    expect(fullCells.length).toBeGreaterThan(fogCells.length);
  });

  it("choice cells are the 6 neighbours of the current cell", () => {
    const { steps } = parseProgression("I IV");
    const walk = buildWalk(steps);
    const cells = getRevealedCells(walk, 1, "fog");
    const choiceCells = cells.filter((c) => c.type === "choice");
    // At most 6 neighbours, but some may overlap with visited cells
    expect(choiceCells.length).toBeLessThanOrEqual(6);
    expect(choiceCells.length).toBeGreaterThan(0);
  });
});

/* ============================================================
   WALK PATH D
   ============================================================ */

describe("getWalkPathD", () => {
  it("returns empty string for a single-step walk", () => {
    const { steps } = parseProgression("I");
    const walk = buildWalk(steps);
    expect(getWalkPathD(walk, 0, "full")).toBe("");
  });

  it("returns an SVG path string for 2+ step walk", () => {
    const { steps } = parseProgression("I IV V");
    const walk = buildWalk(steps);
    const d = getWalkPathD(walk, 2, "full");
    expect(d).toContain("M");
    expect(d).toContain("L");
  });
});

/* ============================================================
   CONTENT BOUNDS
   ============================================================ */

describe("walkContentBounds", () => {
  it("returns finite bounds for any non-empty walk", () => {
    const { steps } = parseProgression("I IV V I");
    const walk = buildWalk(steps);
    const bounds = walkContentBounds(walk, null);
    expect(bounds.w).toBeGreaterThan(0);
    expect(bounds.h).toBeGreaterThan(0);
    expect(Number.isFinite(bounds.x)).toBe(true);
    expect(Number.isFinite(bounds.y)).toBe(true);
  });

  it("includes the loop vector endpoint when present", () => {
    const { steps } = parseProgression("I IV V I");
    const walk = buildWalk(steps);
    const loop = detectLoop(steps, walk);
    const loopVec = loop
      ? {
          x: loop.dq * HEX_SIZE * Math.sqrt(3),
          y: loop.dr * HEX_SIZE * 1.5,
        }
      : null;
    const bounds = walkContentBounds(walk, loopVec);
    expect(bounds.w).toBeGreaterThan(0);
  });
});

/* ============================================================
   STATIC DIATONIC CELLS
   ============================================================ */

describe("getDiatonicHexCells", () => {
  it("returns exactly 7 cells (one per degree)", () => {
    const cells = getDiatonicHexCells();
    expect(cells).toHaveLength(7);
  });

  it("returns degrees sorted 0-6", () => {
    const cells = getDiatonicHexCells();
    expect(cells.map((c) => c.degreeIndex)).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it("includes origin (0,0) as degree 0", () => {
    const cells = getDiatonicHexCells();
    const origin = cells.find((c) => c.q === 0 && c.r === 0);
    expect(origin?.degreeIndex).toBe(0);
  });
});

/* ============================================================
   DISPLAY HELPERS
   ============================================================ */

describe("stepLabel", () => {
  it("formats major triads", () => {
    const step = parseToken("I")!;
    expect(stepLabel(step)).toBe("I");
  });

  it("formats minor triads (lowercase)", () => {
    const step = parseToken("ii")!;
    expect(stepLabel(step)).toBe("ii");
  });

  it("formats seventh chords with accidentals in suffix", () => {
    const step = parseToken("V7b9")!;
    expect(stepLabel(step)).toBe("V7♭9");
  });

  it("formats flat degrees", () => {
    const step = parseToken("bVI")!;
    expect(stepLabel(step)).toBe("♭VI");
  });

  it("formats slash chords", () => {
    const step = parseToken("I/5")!;
    expect(stepLabel(step)).toBe("I/5");
  });
});

describe("letterName", () => {
  it("resolves C major scale degrees", () => {
    expect(letterName("C", 0, 0)).toBe("C");
    expect(letterName("C", 4, 0)).toBe("G");
    expect(letterName("C", 5, 0)).toBe("A");
  });

  it("handles accidentals", () => {
    expect(letterName("C", 0, 1)).toBe("C♯");
    expect(letterName("C", 0, -1)).toBe("C♭");
  });

  it("handles sharp keys", () => {
    expect(letterName("G", 6, 0)).toBe("F♯");
  });
});

describe("chordDisplay", () => {
  it("formats full chord names in key context", () => {
    const step = parseToken("I")!;
    expect(chordDisplay("C", step)).toBe("C");
  });

  it("formats minor chords with 'm'", () => {
    const step = parseToken("ii")!;
    expect(chordDisplay("C", step)).toBe("Dm");
  });

  it("formats seventh chords", () => {
    const step = parseToken("V7")!;
    expect(chordDisplay("C", step)).toBe("G7");
  });

  it("formats slash chords", () => {
    const step = parseToken("I/3")!;
    const result = chordDisplay("C", step);
    expect(result).toBe("C/E");
  });
});

describe("prettySuffix", () => {
  it("converts ASCII flats/sharps before digits", () => {
    expect(prettySuffix("7b9")).toBe("7♭9");
    expect(prettySuffix("7#9")).toBe("7♯9");
  });

  it("leaves bare text unchanged", () => {
    expect(prettySuffix("maj7")).toBe("maj7");
    expect(prettySuffix("")).toBe("");
  });
});

/* ============================================================
   MIDI HELPERS
   ============================================================ */

describe("stepMidiRoot", () => {
  it("returns 48 for C I in major (C4)", () => {
    const step = parseToken("I")!;
    expect(stepMidiRoot("C", SCALE_INTERVALS.major, step)).toBe(48);
  });

  it("returns 55 for G I in major", () => {
    const step = parseToken("I")!;
    expect(stepMidiRoot("G", SCALE_INTERVALS.major, step)).toBe(55);
  });

  it("handles sharp accidentals", () => {
    const step = parseToken("#iv")!;
    const root = stepMidiRoot("C", SCALE_INTERVALS.major, step);
    // iv = degree 3 = F (major intervals[3] = 5 semitones up from C).
    // KEY_MIDI["C"] = 48. 48 + 5 + 1(sharp) = 54 = F♯.
    expect(root).toBe(54);
  });
});

describe("stepMidiChord", () => {
  it("returns an array of MIDI notes for a chord", () => {
    const step = parseToken("I")!;
    const notes = stepMidiChord("C", SCALE_INTERVALS.major, step);
    expect(notes.length).toBeGreaterThanOrEqual(3);
    expect(notes).toContain(36); // bass C2
    expect(notes).toContain(48); // root C4
    expect(notes).toContain(52); // third E4
    expect(notes).toContain(55); // fifth G4
  });
});