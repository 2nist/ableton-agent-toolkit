/**
 * The fixture builder writes MusicXML in the shape iReal Pro actually
 * exports: `preserveOrder`-sensitive interleaving of `<harmony>` and `<note>`
 * (the chord's length is the duration of the note that follows it), rehearsal
 * letters as `<direction><direction-type><rehearsal>`, and navigation as
 * `<sound dalsegno>` beside a `<words>` label. The progression is invented so
 * the test never depends on a real chart.
 */

const DIVISIONS = 4; // per quarter note

interface ChordSpec {
  /** What iReal puts in `<kind text="…">` — the chart's own symbol. */
  symbol: string;
  /** MusicXML's machine vocabulary for the same chord. */
  kind: string;
  beats: number;
  /** `<degree>` alterations as [value, alter, type]. */
  degrees?: [number, number, string][];
  bass?: string;
}

interface MeasureSpec {
  time?: [number, number];
  key?: { fifths: number; mode?: string };
  rehearsal?: string;
  chords: ChordSpec[];
  segno?: boolean;
  coda?: boolean;
  dalsegno?: boolean;
  repeatForward?: boolean;
  repeatBackward?: boolean;
  /** `<sound tempo>` written in this measure (MusicXML puts it in bar 1). */
  tempo?: number;
  /** 1st/2nd ending bracket edge on this bar. */
  ending?: { numbers: number[]; type: "start" | "stop" };
  /** Explicit duration for the trailing rest (defaults to the meter). */
  trailingBeats?: number;
}

function harmonyXml(chord: ChordSpec): string {
  const degrees = (chord.degrees ?? [])
    .map(
      ([value, alter, type]) =>
        `<degree><degree-value>${value}</degree-value><degree-alter>${alter}</degree-alter><degree-type>${type}</degree-type></degree>`,
    )
    .join("");
  const bass = chord.bass ? `<bass><bass-step>${chord.bass}</bass-step></bass>` : "";
  return `<harmony print-frame="no"><root><root-step>${chord.symbol.charAt(0)}</root-step>${
    chord.symbol.charAt(1) === "#" || chord.symbol.charAt(1) === "b"
      ? `<root-alter>${chord.symbol.charAt(1) === "#" ? 1 : -1}</root-alter>`
      : ""
  }</root><kind text="${chord.symbol.slice(1).replace(/^[#b]/, "")}">${chord.kind}</kind>${degrees}${bass}</harmony>`;
}

function measureXml(spec: MeasureSpec): string {
  const attributes =
    spec.time || spec.key
      ? `<attributes>${spec.time ? `<time><beats>${spec.time[0]}</beats><beat-type>${spec.time[1]}</beat-type></time>` : ""}${
          spec.key
            ? `<key><fifths>${spec.key.fifths}</fifths><mode>${spec.key.mode ?? "major"}</mode></key>`
            : ""
        }</attributes>`
      : `<attributes></attributes>`;

  const marks = [
    spec.segno ? `<direction><direction-type><segno/></direction-type><sound segno="segno"/></direction>` : "",
    spec.coda ? `<direction><direction-type><coda/></direction-type><sound coda="coda"/></direction>` : "",
    spec.dalsegno
      ? `<direction><direction-type><words>D.S. al Coda</words></direction-type><sound dalsegno="segno"/></direction>`
      : "",
    spec.rehearsal
      ? `<direction><direction-type><rehearsal>${spec.rehearsal}</rehearsal></direction-type></direction>`
      : "",
    spec.repeatForward ? `<barline location="left"><repeat direction="forward"/></barline>` : "",
    spec.ending
      ? `<barline location="right"><ending number="${spec.ending.numbers.join(",")}" type="${spec.ending.type}"/></barline>`
      : "",
    spec.tempo
      ? `<direction><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>${spec.tempo}</per-minute></metronome></direction-type><sound tempo="${spec.tempo}"/></direction>`
      : "",
    spec.repeatBackward ? `<barline location="right"><repeat direction="backward"/></barline>` : "",
  ].join("");

  const chords = spec.chords
    .map(
      (chord) =>
        `${harmonyXml(chord)}<note><rest/><duration>${chord.beats * DIVISIONS}</duration></note>`,
    )
    .join("");

  return `<measure number="0">${attributes}${marks}${chords}</measure>`;
}

function scoreXml(
  measures: MeasureSpec[],
  meta: { title?: string; composer?: string; tempo?: number } = {},
): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="3.1">
  <work><work-title>${meta.title ?? "Test Chart"}</work-title></work>
  <identification>${meta.composer ? `<creator type="composer">${meta.composer}</creator>` : ""}<rights>Made with iReal Pro</rights></identification>
  <part-list><score-part id="P1"><part-name print-object="no">Lead sheet</part-name></score-part></part-list>
  <part id="P1">
    ${measures
      .map((measure, index) => {
        // Divisions are declared once, in bar 1; the tempo lives there too.
        const withTempo = index === 0 && meta.tempo ? { ...measure, tempo: meta.tempo } : measure;
        const xml = measureXml(withTempo);
        return index === 0
          ? xml.replace("<attributes>", `<attributes><divisions>${DIVISIONS}</divisions>`)
          : xml;
      })
      .join("\n")}
  </part>
</score-partwise>`;
}

export { scoreXml, DIVISIONS };
export type { MeasureSpec, ChordSpec };
