import { describe, it, expect } from "vitest";
import {
  sectionSpans,
  spanForTick,
  spanIndexForTick,
  totalBars,
} from "./arrangement";
import type {
  BlueprintSong,
  BlueprintSection,
  ArrangementRepeat,
} from "../types/blueprint";

function makeSection(
  overrides: Partial<BlueprintSection> & { id: string },
): BlueprintSection {
  return {
    name: overrides.id,
    role: "verse",
    bars: 4,
    chords: [],
    beatsPerChord: 4,
    velocity: "mf",
    timeSignatureNumerator: 4,
    timeSignatureDenPower: 2,
    ...overrides,
  };
}

function makeSong(
  sections: BlueprintSection[],
  arrangement: ArrangementRepeat[],
): BlueprintSong {
  return {
    id: "song-1",
    title: "Test Song",
    key: "C",
    scale: "ionian",
    bpm: 120,
    timeSignatureNumerator: 4,
    timeSignatureDenominator: 4,
    sections,
    arrangement,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  };
}

describe("sectionSpans", () => {
  it("falls back to one pass per section, in list order, when arrangement is empty", () => {
    const sections = [makeSection({ id: "a" }), makeSection({ id: "b" })];
    const spans = sectionSpans(makeSong(sections, []));
    expect(spans.map((s) => s.sectionId)).toEqual(["a", "b"]);
    expect(spans[0].startBeat).toBe(0);
    // 4 bars * 4/4 = 16 beats per section.
    expect(spans[0].durationBeats).toBe(16);
    expect(spans[1].startBeat).toBe(16);
  });

  it("expands repeats > 1 into multiple spans with incrementing occurrenceIndex", () => {
    const sections = [makeSection({ id: "chorus", bars: 4 })];
    const spans = sectionSpans(
      makeSong(sections, [{ sectionId: "chorus", repeats: 3 }]),
    );
    expect(spans).toHaveLength(3);
    expect(spans.map((s) => s.occurrenceIndex)).toEqual([0, 1, 2]);
    expect(spans.map((s) => s.startBeat)).toEqual([0, 16, 32]);
  });

  it("applies a per-pass bars override without mutating the canonical section", () => {
    const sections = [makeSection({ id: "verse", bars: 4 })];
    const song = makeSong(sections, [
      { sectionId: "verse", repeats: 1, overrides: { bars: 8 } },
    ]);
    const spans = sectionSpans(song);
    expect(spans[0].bars).toBe(8);
    expect(spans[0].durationBeats).toBe(32);
    // The canonical section in song.sections is untouched.
    expect(song.sections[0].bars).toBe(4);
  });

  it("skips a stale arrangement entry referencing a deleted section", () => {
    const sections = [makeSection({ id: "a" })];
    const song = makeSong(sections, [
      { sectionId: "ghost", repeats: 1 },
      { sectionId: "a", repeats: 1 },
    ]);
    const spans = sectionSpans(song);
    expect(spans.map((s) => s.sectionId)).toEqual(["a"]);
  });

  it("computes contiguous startBar values matching accumulated bars", () => {
    const sections = [
      makeSection({ id: "a", bars: 4 }),
      makeSection({ id: "b", bars: 8 }),
    ];
    const spans = sectionSpans(makeSong(sections, []));
    expect(spans[0].startBar).toBe(0);
    expect(spans[1].startBar).toBe(4);
    expect(totalBars(spans)).toBe(12);
  });

  it("returns an empty array and totalBars 0 for a song with no sections", () => {
    const spans = sectionSpans(makeSong([], []));
    expect(spans).toEqual([]);
    expect(totalBars(spans)).toBe(0);
  });
});

describe("sectionSpans — meter map", () => {
  it("gives a mixed-meter section its real beat length", () => {
    // 4/4 4/4 4/4 then 7/8: 4+4+4+3.5 = 15.5 beats, not 4 × 4.
    const mixed = makeSection({
      id: "a",
      bars: 4,
      meterMap: [
        { bar: 0, numerator: 4, denominator: 4 },
        { bar: 3, numerator: 7, denominator: 8 },
      ],
    });
    const [span] = sectionSpans(makeSong([mixed], []));
    expect(span.durationBeats).toBe(15.5);
  });

  it("accumulates bars across spans instead of dividing beats by one meter", () => {
    // A 3/4 section followed by a 4/4 one: the second section starts at bar 4,
    // which beats-per-bar division would have put at bar 3.
    const threeFour = makeSection({
      id: "a",
      bars: 4,
      timeSignatureNumerator: 3,
    });
    const fourFour = makeSection({ id: "b", bars: 4 });
    const spans = sectionSpans(makeSong([threeFour, fourFour], []));
    expect(spans.map((s) => s.startBar)).toEqual([0, 4]);
    expect(spans.map((s) => s.startBeat)).toEqual([0, 12]);
  });

  it("keeps startBar and startBeat consistent for a repeated mixed-meter section", () => {
    const mixed = makeSection({
      id: "a",
      bars: 2,
      meterMap: [
        { bar: 0, numerator: 4, denominator: 4 },
        { bar: 1, numerator: 5, denominator: 4 },
      ],
    });
    const spans = sectionSpans(
      makeSong([mixed], [{ sectionId: "a", repeats: 2 }]),
    );
    expect(spans.map((s) => [s.startBar, s.startBeat])).toEqual([
      [0, 0],
      [2, 9],
    ]);
  });
});

describe("spanIndexForTick", () => {
  it("resolves by section identity rather than the tick's stale index", () => {
    const spans = sectionSpans(
      makeSong(
        [makeSection({ id: "a", bars: 2 }), makeSection({ id: "b", bars: 2 })],
        [],
      ),
    );
    const tick = {
      beat: 4,
      sectionIndex: 0,
      sectionId: "a",
      occurrenceIndex: 0,
    };
    expect(spanIndexForTick(spans, tick)).toBe(0);

    // `a` was deleted while the transport was still playing, so index 0 now
    // names `b`. Identity resolution must report "gone", never "b".
    const afterDelete = sectionSpans(
      makeSong([makeSection({ id: "b", bars: 2 })], []),
    );
    expect(spanIndexForTick(afterDelete, tick)).toBe(-1);
    expect(spanForTick(afterDelete, tick)).toBeNull();
  });

  it("keeps the same section when an earlier one grows under the playhead", () => {
    const before = sectionSpans(
      makeSong(
        [makeSection({ id: "a", bars: 1 }), makeSection({ id: "b", bars: 3 })],
        [],
      ),
    );
    const tick = {
      beat: 6,
      sectionIndex: 1,
      sectionId: "b",
      occurrenceIndex: 0,
    };
    expect(spanIndexForTick(before, tick)).toBe(1);

    // `a` grows from 1 to 3 bars: `b` now starts at beat 12, so its index is
    // unchanged but its POSITION moved — the span must follow the section.
    const after = sectionSpans(
      makeSong(
        [makeSection({ id: "a", bars: 3 }), makeSection({ id: "b", bars: 3 })],
        [],
      ),
    );
    expect(spanIndexForTick(after, tick)).toBe(1);
    expect(spanForTick(after, tick)?.startBeat).toBe(12);
  });

  it("picks the right repeat pass of a repeated section", () => {
    const spans = sectionSpans(
      makeSong(
        [makeSection({ id: "chorus", bars: 2 })],
        [{ sectionId: "chorus", repeats: 3 }],
      ),
    );
    expect(spans).toHaveLength(3);
    expect(
      spanIndexForTick(spans, {
        beat: 9,
        sectionId: "chorus",
        occurrenceIndex: 1,
      }),
    ).toBe(1);
    expect(
      spanIndexForTick(spans, {
        beat: 9,
        sectionId: "chorus",
        occurrenceIndex: 2,
      }),
    ).toBe(2);
  });

  it("falls back to the pass containing the beat when the named pass is gone", () => {
    const spans = sectionSpans(
      makeSong(
        [makeSection({ id: "chorus", bars: 2 })],
        [{ sectionId: "chorus", repeats: 3 }],
      ),
    );
    expect(
      spanIndexForTick(spans, {
        beat: 9,
        sectionId: "chorus",
        occurrenceIndex: 5,
      }),
    ).toBe(1);
  });

  it("still honours a hand-built tick that carries only an index", () => {
    const spans = sectionSpans(
      makeSong(
        [makeSection({ id: "a", bars: 2 }), makeSection({ id: "b", bars: 2 })],
        [],
      ),
    );
    expect(spanIndexForTick(spans, { beat: 9, sectionIndex: 1 })).toBe(1);
    expect(spanIndexForTick(spans, { beat: 9, sectionIndex: 7 })).toBe(-1);
    expect(spanIndexForTick(spans, { beat: 9, sectionIndex: -1 })).toBe(-1);
  });
});

describe("sectionSpans — per-pass overrides (§P4.1)", () => {
  const make = () =>
    makeSong(
      [makeSection({ id: "chorus", bars: 4 })],
      [{ sectionId: "chorus", repeats: 3 }],
    );

  it("leaves every pass sharing the section object when nothing overrides", () => {
    // Reference identity matters: memo comparisons and "absent stays byte
    // identical" both depend on it.
    const spans = sectionSpans(make());
    expect(spans).toHaveLength(3);
    for (const span of spans) expect(span.section).toBe(spans[0].section);
  });

  it("gives one pass its own clock and leaves the others alone", () => {
    const song = make();
    song.arrangement = [
      {
        sectionId: "chorus",
        repeats: 3,
        occurrenceOverrides: { "2": { timeDomain: { rate: 0.5 } } },
      },
    ];
    const spans = sectionSpans(song);
    expect(spans.map((span) => span.section.timeDomain)).toEqual([
      undefined,
      undefined,
      { rate: 0.5 },
    ]);
    // The untouched passes still share one object.
    expect(spans[0].section).toBe(spans[1].section);
    expect(spans[2].section).not.toBe(spans[0].section);
  });

  it("stacks a pass override on top of the entry's", () => {
    const song = make();
    song.arrangement = [
      {
        sectionId: "chorus",
        repeats: 2,
        overrides: { velocity: "ff" },
        occurrenceOverrides: { "1": { timeDomain: { rate: 2 } } },
      },
    ];
    const [first, second] = sectionSpans(song);
    expect(first.section.velocity).toBe("ff");
    expect(first.section.timeDomain).toBeUndefined();
    expect(second.section.velocity).toBe("ff");
    expect(second.section.timeDomain).toEqual({ rate: 2 });
  });

  it("lets a pass change its own length, and the song follows", () => {
    const song = make();
    song.arrangement = [
      {
        sectionId: "chorus",
        repeats: 2,
        occurrenceOverrides: { "1": { bars: 8 } },
      },
    ];
    const [first, second] = sectionSpans(song);
    expect(first.durationBeats).toBe(16);
    expect(second.durationBeats).toBe(32);
    // The second pass starts where the first ended, so the timeline grows.
    expect(second.startBeat).toBe(16);
    expect(totalBars(sectionSpans(song))).toBe(12);
  });

  it("never mutates the authored section", () => {
    const song = make();
    const authored = song.sections[0];
    song.arrangement = [
      {
        sectionId: "chorus",
        repeats: 1,
        occurrenceOverrides: { "0": { timeDomain: { rate: 2 } } },
      },
    ];
    sectionSpans(song);
    expect(authored.timeDomain).toBeUndefined();
  });
});
