import { describe, it, expect } from "vitest";
import { musicXmlToBlueprintSong } from "./parseMusicXml";
import { scoreXml, type MeasureSpec } from "./musicXmlFixture";

const Cmaj7: MeasureSpec["chords"][number] = { symbol: "Cmaj7", kind: "major-seventh", beats: 4 };
const Am7: MeasureSpec["chords"][number] = { symbol: "Am7", kind: "minor-seventh", beats: 4 };
const Dm7: MeasureSpec["chords"][number] = { symbol: "Dm7", kind: "minor-seventh", beats: 4 };
const G7: MeasureSpec["chords"][number] = { symbol: "G7", kind: "dominant", beats: 4 };

/** intro | A (two bars) | B (two bars) — enough shape to test grouping. */
function simpleChart(extra: Partial<MeasureSpec> = {}): string {
  return scoreXml([
    { time: [4, 4], key: { fifths: 0 }, rehearsal: "Intro", chords: [Cmaj7], ...extra },
    { rehearsal: "A", chords: [Am7] },
    { chords: [Dm7] },
    { rehearsal: "B", chords: [G7] },
    { chords: [Cmaj7] },
  ]);
}

describe("musicXmlToBlueprintSong — metadata", () => {
  it("reads title, composer, key and meter", () => {
    const song = musicXmlToBlueprintSong(
      scoreXml([{ time: [4, 4], key: { fifths: -3 }, rehearsal: "A", chords: [Cmaj7] }], {
        title: "Test Chart",
        composer: "Nobody",
        tempo: 132,
      }),
    );
    expect(song.title).toBe("Test Chart");
    expect(song.artist).toBe("Nobody");
    expect(song.key).toBe("Eb");
    expect(song.scale).toBe("ionian");
    expect(song.bpm).toBe(132);
    expect(song.timeSignatureNumerator).toBe(4);
    expect(song.timeSignatureDenominator).toBe(4);
  });

  it("reads a minor key as aeolian", () => {
    const song = musicXmlToBlueprintSong(
      scoreXml([{ time: [4, 4], key: { fifths: 3, mode: "minor" }, rehearsal: "A", chords: [Am7] }]),
    );
    expect(song.key).toBe("F#");
    expect(song.scale).toBe("aeolian");
  });

  it("defaults the tempo and says so, because iReal stores no tempo", () => {
    const song = musicXmlToBlueprintSong(simpleChart());
    expect(song.bpm).toBe(120);
    expect(song.provenance?.source).toBe("musicxml-import");
    expect(song.provenance?.warnings?.some((w) => /No tempo in the file/.test(w))).toBe(true);
    expect(song.provenance?.warnings?.some((w) => /no melody/.test(w))).toBe(true);
  });

  it("refuses anything that is not a score-partwise document", () => {
    expect(() => musicXmlToBlueprintSong("<not-a-score/>")).toThrow(/score-partwise/);
  });
});

describe("musicXmlToBlueprintSong — sections", () => {
  it("starts a section at every rehearsal letter and counts its bars", () => {
    const song = musicXmlToBlueprintSong(simpleChart());
    expect(song.sections.map((s) => s.name)).toEqual(["Intro", "A", "B"]);
    expect(song.sections.map((s) => s.bars)).toEqual([1, 2, 2]);
    // "Intro" is the only name the role table recognises here.
    expect(song.sections.map((s) => s.role)).toEqual(["intro", "custom", "custom"]);
    expect(song.sections[1].chords.map((c) => `${c.root}${c.quality}`)).toEqual(["Amin7", "Dmin7"]);
  });

  it("falls back to one chart section when the export has no rehearsal marks", () => {
    const song = musicXmlToBlueprintSong(scoreXml([{ time: [4, 4], chords: [Cmaj7, G7] }]));
    expect(song.sections).toHaveLength(1);
    expect(song.sections[0].name).toBe("Chart");
  });

  it("warns when a section changes meter, and keeps the first one", () => {
    const song = musicXmlToBlueprintSong(
      scoreXml([
        { time: [4, 4], rehearsal: "A", chords: [Cmaj7] },
        { time: [2, 4], chords: [{ symbol: "G7", kind: "dominant", beats: 2 }] },
      ]),
    );
    expect(song.sections[0].timeSignatureNumerator).toBe(4);
    expect(song.provenance?.warnings?.some((w) => /changes meter/.test(w))).toBe(true);
  });
});

describe("musicXmlToBlueprintSong — chords", () => {
  it("takes a chord's length from the note that follows it", () => {
    const song = musicXmlToBlueprintSong(
      scoreXml([
        {
          time: [4, 4],
          rehearsal: "A",
          chords: [
            { symbol: "Cmaj7", kind: "major-seventh", beats: 2 },
            { symbol: "G7", kind: "dominant", beats: 1 },
            { symbol: "Am7", kind: "minor-seventh", beats: 1 },
          ],
        },
      ]),
    );
    expect(song.sections[0].chords.map((c) => c.beats)).toEqual([2, 1, 1]);
    // Most common length wins as the section's harmonic rhythm.
    expect(song.sections[0].beatsPerChord).toBe(1);
  });

  it("prefers iReal's own symbol over the coarser MusicXML kind", () => {
    // `<kind text="7b9">dominant</kind>` — the kind alone would say just "7".
    const song = musicXmlToBlueprintSong(
      scoreXml([
        { time: [4, 4], rehearsal: "A", chords: [{ symbol: "G7b9", kind: "dominant", beats: 4 }] },
      ]),
    );
    expect(song.sections[0].chords[0].quality).toBe("7b9");
    expect(song.sections[0].chords[0].extendedSuffix).toBeUndefined();
    expect(song.sections[0].chords[0].annotation).toBe("G7b9");
  });

  it("folds <degree> alterations into a quality the chord library can play", () => {
    const song = musicXmlToBlueprintSong(
      scoreXml([
        {
          time: [4, 4],
          rehearsal: "A",
          chords: [{ symbol: "F", kind: "major", beats: 4, degrees: [[2, 0, "add"]] }],
        },
      ]),
    );
    // add9 is one of the five-note qualities added to the vocabulary, so this
    // is a real voicing rather than a label.
    expect(song.sections[0].chords[0].quality).toBe("add9");
  });

  it("honours a slash chord whose bass is a chord tone as an inversion", () => {
    const song = musicXmlToBlueprintSong(
      scoreXml([
        { time: [4, 4], rehearsal: "A", chords: [{ symbol: "Dm", kind: "minor", beats: 4, bass: "A" }] },
      ]),
    );
    const [chord] = song.sections[0].chords;
    expect(chord.root).toBe("D");
    expect(chord.quality).toBe("min");
    expect(chord.voicing).toEqual({ inversion: 2 }); // A is the fifth
    expect(chord.annotation).toBe("Dm/A");
  });

  it("keeps a non-chord bass as a label and explains why", () => {
    const song = musicXmlToBlueprintSong(
      scoreXml([
        { time: [4, 4], rehearsal: "A", chords: [{ symbol: "G7", kind: "dominant", beats: 4, bass: "A" }] },
      ]),
    );
    const [chord] = song.sections[0].chords;
    expect(chord.voicing).toBeUndefined();
    expect(chord.annotation).toBe("G7/A");
    expect(song.provenance?.warnings?.some((w) => /non-chord tone in the bass/.test(w))).toBe(true);
  });

  it("writes roman numerals against the chart's key", () => {
    const song = musicXmlToBlueprintSong(
      scoreXml([
        { time: [4, 4], key: { fifths: 0 }, rehearsal: "A", chords: [Cmaj7, Dm7, G7, Am7] },
      ]),
    );
    expect(song.sections[0].chords.map((c) => c.romanNumeral)).toEqual(["Imaj7", "ii7", "V7", "vi7"]);
  });
});

describe("musicXmlToBlueprintSong — played form", () => {
  it("keeps written order when there is no navigation", () => {
    const song = musicXmlToBlueprintSong(simpleChart());
    expect(song.arrangement).toHaveLength(3);
    expect(song.arrangement.every((entry) => entry.repeats === 1 && !entry.overrides)).toBe(true);
  });

  it("expands a repeated passage into repeats rather than duplicate sections", () => {
    const song = musicXmlToBlueprintSong(
      scoreXml([
        { time: [4, 4], rehearsal: "A", chords: [Cmaj7], repeatForward: true },
        { chords: [G7], repeatBackward: true },
        { rehearsal: "B", chords: [Am7] },
      ]),
    );
    const names = song.arrangement.map((entry) => song.sections.find((s) => s.id === entry.sectionId)?.name);
    // Adjacent identical full passes coalesce into one entry with repeats: 2 —
    // a barline repeat is a repeat, not a second copy of the section.
    expect(names).toEqual(["A", "B"]);
    expect(song.arrangement[0]).toMatchObject({ repeats: 2 });
    expect(song.arrangement[1].repeats).toBe(1);
    expect(song.sections.map((s) => s.name)).toEqual(["A", "B"]);
  });

  it("gives the 1st and 2nd endings their own bars", () => {
    // | A (repeat forward) | B as the 1st ending | C as the 2nd ending |
    const song = musicXmlToBlueprintSong(
      scoreXml([
        { time: [4, 4], rehearsal: "A", chords: [Cmaj7], repeatForward: true },
        { chords: [Dm7], ending: { numbers: [1], type: "start" }, repeatBackward: true },
        { chords: [G7], ending: { numbers: [2], type: "stop" } },
      ]),
    );
    const passes = song.arrangement.map((entry) => ({
      bars: entry.overrides?.bars,
      chords: entry.overrides?.chords?.map((c) => c.root),
    }));
    // Pass 1 = A + 1st ending, pass 2 = A + 2nd ending (the bracket after the
    // repeat bar belongs to the second pass, not played straight through).
    expect(passes).toEqual([
      { bars: 2, chords: ["C", "D"] },
      { bars: 2, chords: ["C", "G"] },
    ]);
    expect(song.arrangement[1].variation).toBe("A (2 of 3 bars)");
    expect(song.provenance?.warnings?.some((w) => /1st\/2nd endings expanded/.test(w))).toBe(true);
  });

  it("expands D.S. al Coda into the order the bars actually sound", () => {
    // intro | A (2 bars) | B (2 bars, D.S. at its last bar) | Coda (1 bar)
    const song = musicXmlToBlueprintSong(
      scoreXml([
        { time: [4, 4], rehearsal: "Intro", chords: [Cmaj7] },
        { rehearsal: "A", chords: [Am7], segno: true },
        { chords: [Dm7], coda: true },
        { rehearsal: "B", chords: [G7] },
        { chords: [Cmaj7], dalsegno: true },
        { coda: true, chords: [G7] },
      ]),
    );

    expect(song.sections.map((s) => s.name)).toEqual(["Intro", "A", "B", "Coda"]);
    const passes = song.arrangement.map((entry) => ({
      name: song.sections.find((s) => s.id === entry.sectionId)?.name,
      bars: entry.overrides?.bars,
    }));
    // intro, A, B, then back to the segno and out at the coda sign, then the coda.
    expect(passes).toEqual([
      { name: "Intro", bars: undefined },
      { name: "A", bars: undefined },
      { name: "B", bars: undefined },
      { name: "A", bars: 1 },
      { name: "Coda", bars: undefined },
    ]);
    const repeat = song.arrangement[3];
    expect(repeat.variation).toBe("A (bars 1–1)");
    expect(repeat.overrides?.chords).toHaveLength(1);
    expect(song.provenance?.warnings?.some((w) => /D\.S\.\/D\.C\. at bar/.test(w))).toBe(true);
  });

  it("leaves the form alone when a D.S. has no segno to return to", () => {
    const song = musicXmlToBlueprintSong(
      scoreXml([
        { time: [4, 4], rehearsal: "A", chords: [Cmaj7] },
        { chords: [G7], dalsegno: true },
        { chords: [Am7] },
      ]),
    );
    expect(song.arrangement).toHaveLength(1);
    expect(song.arrangement[0].repeats).toBe(1);
    expect(song.provenance?.warnings?.some((w) => /no matching segno/.test(w))).toBe(true);
  });
});
