/** iReal Pro's chord-string dialect.
 *
 *  The format is undocumented; this is built from the observed behaviour of a
 *  real export (a 24-bar tune whose MusicXML is the ground truth) and the
 *  published token rules of the `ireal-reader` implementation. The writer and
 *  a matching reader live together so a round trip is a test rather than a
 *  hope — iReal Pro itself is still the final judge.
 *
 *  Known tokens:
 *    `*A`..`*Z` section marker · `T44` time signature · `|` barline
 *    `{` `}` repeat barlines · `Z` final barline · `[` `]` double bars
 *    `XyQ` empty space (rest of the bar) · `,` one beat on · ` ` two beats on
 *    `n` no chord · `Q` coda · `S` segno · `<text>` a comment (D.S. al Coda)
 */

/** One chord written into a bar. `beat` is 1-based. */
export interface IrealCell {
  symbol: string;
  beat: number;
}

export interface IrealBar {
  cells: IrealCell[];
  /** Meter written at this bar ("4/4"), null when unchanged. */
  meter: string | null;
}

export interface IrealSection {
  letter: string;
  bars: IrealBar[];
  /** Repeat bracket around the section, 1 = none. */
  repeats: number;
}

const SEPARATOR_FOR_GAP: Record<number, string> = { 1: ",", 2: " ", 3: ", " };

/** The plain (unscrambled) chord string for a song. */
export function encodeChordString(sections: readonly IrealSection[]): string {
  const out: string[] = [];
  for (const section of sections) {
    out.push(`*${section.letter}`);
    const repeat = section.repeats > 1;
    if (repeat) out.push("{");
    section.bars.forEach((bar, barIndex) => {
      if (barIndex > 0) out.push("|");
      if (bar.meter) out.push(`T${bar.meter.replace("/", "")}`);
      if (bar.cells.length === 0) {
        out.push("XyQ");
        return;
      }
      let previousBeat = 1;
      bar.cells.forEach((cell, index) => {
        if (index > 0) {
          // The separator spans from the previous chord's beat to this one:
          // one comma advances a beat, a space advances two, `, ` three.
          const gap = Math.max(1, Math.min(3, cell.beat - previousBeat));
          out.push(SEPARATOR_FOR_GAP[gap] ?? ",");
        }
        out.push(cell.symbol);
        previousBeat = cell.beat;
      });
      // How the bar closes, following iReal's own exports: a chord that owns
      // the bar is followed by empty space, anything later by a trailing comma.
      const last = bar.cells[bar.cells.length - 1];
      out.push(last.beat === 1 ? "XyQ" : ",");
    });
    if (repeat) out.push("}");
  }
  out.push("Z");
  return out.join("");
}

type Rule = { token: string | RegExp; kind: string };

const TOKEN_RULES: Rule[] = [
  { token: "XyQ", kind: "space" },
  { token: /^\*([A-Za-z])/, kind: "section" },
  { token: /^<[^>]*>/, kind: "comment" },
  { token: /^T(\d+)/, kind: "meter" },
  { token: "Kcl", kind: "repeat-bar" },
  { token: "Y", kind: "spacer" },
  { token: "n", kind: "no-chord" },
  { token: "{", kind: "repeat-start" },
  { token: "}", kind: "repeat-end" },
  { token: "LZ|", kind: "bar" },
  { token: "|", kind: "bar" },
  { token: "LZ", kind: "bar" },
  { token: "[", kind: "bar" },
  { token: "]", kind: "close" },
  { token: "Z", kind: "end" },
  { token: "Q", kind: "coda" },
  { token: "S", kind: "segno" },
  { token: ",", kind: "beat-1" },
  { token: " ", kind: "beat-2" },
  { token: /^[A-GW][+\-^\dhob#suadlt]*(\/[A-G][#b]?)?/, kind: "chord" },
];

/** Reader for the same dialect — the other half of the round-trip test. It
 *  keeps only what the writer produces (sections, bars, chords, meter) and
 *  tolerates the layout tokens a hand-made chart contains. */
export function decodeChordString(input: string): IrealSection[] {
  const sections: IrealSection[] = [];
  let current: IrealSection | null = null;
  let bar: IrealBar = { cells: [], meter: null };
  let pendingBeat = 1;

  const pushBar = () => {
    if (!current) return;
    if (bar.cells.length > 0 || bar.meter) current.bars.push(bar);
    bar = { cells: [], meter: null };
    pendingBeat = 1;
  };

  let rest = input;
  while (rest.length > 0) {
    const rule = TOKEN_RULES.find((entry) =>
      typeof entry.token === "string" ? rest.startsWith(entry.token) : entry.token.test(rest),
    );
    if (!rule) {
      rest = rest.slice(1);
      continue;
    }
    const literal =
      typeof rule.token === "string" ? rule.token : ((rest.match(rule.token) as RegExpMatchArray)[0] ?? "");
    rest = rest.slice(literal.length);

    switch (rule.kind) {
      case "section": {
        pushBar();
        current = { letter: literal.slice(1), bars: [], repeats: 1 };
        sections.push(current);
        break;
      }
      case "repeat-start":
        if (current) current.repeats = 2;
        break;
      case "bar":
      case "close":
        pushBar();
        break;
      case "meter":
        bar.meter = `${literal.slice(1, -1)}/${literal.slice(-1)}`;
        break;
      case "chord":
        bar.cells.push({ symbol: literal, beat: pendingBeat });
        break;
      case "beat-1":
        pendingBeat += 1;
        break;
      case "beat-2":
        pendingBeat += 2;
        break;
      case "no-chord":
        bar.cells.push({ symbol: "n", beat: pendingBeat });
        break;
      default:
        break;
    }
  }
  pushBar();
  return sections.filter((section) => section.bars.length > 0);
}
