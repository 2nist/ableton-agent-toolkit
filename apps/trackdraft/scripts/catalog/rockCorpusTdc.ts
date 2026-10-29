import { pitchClass } from "@music-theory/core";
import type { NoteName } from "@music-theory/core";
import type { RawCatalogSong, RawChordEvent, RawSection } from "./types.js";

/**
 * Rock Corpus TDC (Trevor de Clercq) → RawCatalogSong. The third catalog
 * corpus parser, beside beatlesJcrd and mcgillJcrd — same shared merge.
 *
 * Corpus facts (verified across all 200 *.jcrd files, 2026-09):
 *  - The BEST-provisioned source so far: metadata carries title, artist,
 *    key (bare note) AND tempo; chords carry real time+duration in
 *    seconds; sections carry time+duration+label. Only the mode is
 *    absent (inferred below).
 *  - `tempo` is stored in BARS per minute (verified against recordings in
 *    the I Want To Hold Your Hand work: corpus 33 → 132 BPM); the parser
 *    converts with ×4 to get quarter-note BPM.
 *  - Chord strings are ROMAN NUMERALS over the metadata key, roman
 *    parsed to absolute roots here. Notation decoded from the full
 *    corpus-wide vocabulary (20k+ tokens):
 *      "" maj/min triad by numeral case
 *      "7"/"d7"/"9"/"d9"/"11"/"13"/"#9"/"b9"/"x7" → seventh (min7 for
 *        lowercase numerals)
 *      "6"/"64" inversion figures → triad (bass figures dropped)
 *      "42"/"65"/"43" → seventh chords in inversion
 *      "s4"/"7s4" → sus4 · "h7"/"h42"/"h43" → m7b5 (half-diminished)
 *      "o" → dim · "a"/"a65" → aug · "+11" → aug · "b5" → dim
 *      "V/IV", "V42/IV" applied chords → root at the dominant of the
 *        target degree (figures on the base numeral still apply)
 *      "." continues the previous chord (its cell extends it)
 *      "*n" repeats the previous chord cell n more times
 *      "R" = rest cell (no chord) · "|" barline, "[4/4]" meter tags
 *      "[E]"/"[G]" etc. = inline KEY CHANGES — following numerals are
 *        relative to the new key, faithfully followed
 *  - Section labels are de Clercq abbreviations ("Vr*3" = Verse ×3,
 *    "Ch2" = chorus occurrence 2): expanded to words so the shared
 *    role-guesser sees real section names. Junk entries ("|", meter
 *    tags) are merged into the previous section's span; "Zz" (the
 *    corpus's "no clear function" marker) becomes "Unlabeled".
 */

const KEY_NAMES = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];

const SECTION_EXPANSION: Record<string, string> = {
  in: "Intro",
  vr: "Verse",
  ch: "Chorus",
  br: "Bridge",
  ou: "Outro",
  so: "Solo",
  ln: "Link",
  rf: "Refrain",
  pc: "PreChorus",
  tg: "Tag",
  zz: "Unlabeled",
};

const DEGREE_SEMITONES: Record<string, number> = {
  I: 0,
  II: 2,
  III: 4,
  IV: 5,
  V: 7,
  VI: 9,
  VII: 11,
};

const ROMAN_RE = /^([b#]?)(VII|vii|VI|vi|V|v|IV|iv|III|iii|II|ii|I|i)(.*)$/;

interface TranslateStats {
  simplified: number;
  applied: number;
  unknownFigures: Set<string>;
}

function mapFigure(rest: string, base: "maj" | "min", stats: TranslateStats): string {
  if (rest.includes("s4")) {
    stats.simplified++;
    return "sus4";
  }
  if (rest.includes("h")) {
    stats.simplified++;
    return "m7b5";
  }
  if (rest === "o" || /^o\d/.test(rest)) {
    stats.simplified++;
    return "dim";
  }
  if (rest === "a" || /^a\d/.test(rest)) {
    stats.simplified++;
    return "aug";
  }
  if (rest.includes("+")) {
    stats.simplified++;
    return "aug";
  }
  if (rest.includes("b5")) {
    stats.simplified++;
    return "dim";
  }
  if (/d?7|9|11|13|42|65|43/.test(rest)) {
    if (rest !== "7") stats.simplified++;
    return base === "min" ? "min7" : "7";
  }
  if (rest === "") return base;
  if (/^(6|64)$/.test(rest)) {
    stats.simplified++;
    return base;
  }
  stats.simplified++;
  stats.unknownFigures.add(rest);
  return base;
}

/** One numeral token → absolute root + quality. Returns null when nothing
 *  parseable (caller counts + samples). */
function translateRoman(
  token: string,
  keyPc: number,
  stats: TranslateStats,
): { root: string; quality: string } | null {
  const slash = token.indexOf("/");
  const basePart = slash >= 0 ? token.slice(0, slash) : token;
  const appliedPart = slash >= 0 ? token.slice(slash + 1).trim() : "";

  const m = basePart.match(ROMAN_RE);
  if (!m) return null;
  const [, acc, num, rest] = m;

  let pc = keyPc + DEGREE_SEMITONES[num.toUpperCase()];
  if (acc === "b") pc -= 1;
  else if (acc === "#") pc += 1;

  if (appliedPart) {
    const am = appliedPart.match(ROMAN_RE);
    if (!am) {
      stats.unknownFigures.add(`/${appliedPart}`);
    } else {
      let targetPc = keyPc + DEGREE_SEMITONES[am[2].toUpperCase()];
      if (am[1] === "b") targetPc -= 1;
      else if (am[1] === "#") targetPc += 1;
      pc = targetPc + 7; // dominant of the target degree
      stats.applied++;
    }
  }

  const base: "maj" | "min" = num === num.toLowerCase() ? "min" : "maj";
  const quality = appliedPart && rest === "" ? "maj" : mapFigure(rest.toLowerCase(), base, stats);
  return { root: KEY_NAMES[((pc % 12) + 12) % 12], quality };
}

interface RockChord {
  time?: number;
  duration?: number;
  chord?: string;
}
interface RockSection {
  time?: number;
  duration?: number;
  label?: string;
}

export function parseRockCorpusTdc(raw: unknown): RawCatalogSong {
  const data = raw as {
    metadata?: { title?: string; artist?: string; key?: string; tempo?: number };
    chords?: RockChord[];
    sections?: RockSection[];
  };

  const warnings: string[] = [];
  const stats: TranslateStats = { simplified: 0, applied: 0, unknownFigures: new Set() };
  let keyChanges = 0;
  let unknownTokens = 0;
  const unknownSamples = new Set<string>();

  const keyNote = data.metadata?.key?.trim();
  const keyPc = keyNote ? pitchClass(keyNote as NoteName) : 0;
  if (!keyNote) warnings.push("No key in source data — defaulted to C");
  let curKeyPc = keyPc;

  // ——— chords: token stream → absolute timed events ————————————————
  const events: RawChordEvent[] = [];
  let lastEvent: RawChordEvent | null = null;

  for (const c of data.chords ?? []) {
    const token = String(c.chord ?? "").trim();
    const cellStart = c.time ?? 0;
    const cellEnd = cellStart + (c.duration ?? 0);
    const extendPrev = (end: number) => {
      if (lastEvent && lastEvent.endSec < end) lastEvent.endSec = end;
    };

    if (token === "" || token === "|") continue;
    if (/^\[.*\]$/.test(token)) {
      const inner = token.slice(1, -1).trim();
      if (/^[A-G][#b]?$/.test(inner)) {
        curKeyPc = pitchClass(inner as NoteName);
        keyChanges++;
      }
      extendPrev(cellEnd);
      continue;
    }
    if (token === ".") {
      extendPrev(cellEnd);
      continue;
    }
    if (token === "R") {
      continue;
    }
    const star = token.match(/^\*(\d+)$/);
    if (star) {
      // "*n" cells are repeat markers for the previous chord (n = the
      // repeat count they denote). The cells themselves tile the section
      // spans exactly (verified against section boundaries and known
      // songs: I Saw Her Standing There's Id7 + *4 fills its 4.5 s intro
      // precisely), so the timing-correct reading is the same as ".":
      // the chord continues through the marker cell. The earlier
      // n×cell-duration reading inflated bar counts ~5× on vamp songs
      // (Who Do You Love reached 992 bars for a 147 s track).
      extendPrev(cellEnd);
      continue;
    }

    const translated = translateRoman(token, curKeyPc, stats);
    if (!translated) {
      unknownTokens++;
      if (unknownSamples.size < 4) unknownSamples.add(token);
      continue;
    }
    const event: RawChordEvent = {
      startSec: cellStart,
      endSec: Math.max(cellEnd, cellStart + 0.05),
      root: translated.root,
      quality: translated.quality,
    };
    events.push(event);
    lastEvent = event;
  }

  // Source cell times are rounded to 2-3 decimals, so adjacent cells can
  // overlap or gap by a few milliseconds. Left alone, such drift lets a
  // chord leak across a section boundary (the merge bins by exact time),
  // double-claiming the last chord of one section into the next and
  // inflating bar counts on the vamp songs. Unify boundaries that are
  // within 50 ms (real cell gaps/crossings are >= 0.5 s).
  for (let i = 0; i + 1 < events.length; i++) {
    const gap = events[i + 1].startSec - events[i].endSec;
    if (gap > -0.05 && gap < 0.05) events[i].endSec = events[i + 1].startSec;
  }

  // ——— sections: expand labels, merge junk into the previous span ——
  interface Span {
    name: string;
    startSec: number;
    endSec: number;
  }
  const spans: Span[] = [];
  for (const s of data.sections ?? []) {
    const start = s.time ?? 0;
    const end = start + (s.duration ?? 0);
    const rawLabel = (s.label ?? "").trim();
    const isJunk = rawLabel === "|" || /^\[.*\]$/.test(rawLabel);
    if (isJunk) {
      const prev = spans[spans.length - 1];
      if (prev && prev.endSec < end) prev.endSec = end;
      continue;
    }
    const base = rawLabel.replace(/\*\d+$/, "").replace(/\d+$/, "").trim();
    const name = SECTION_EXPANSION[base.toLowerCase()] ?? base ?? "Section";
    spans.push({ name: name || "Section", startSec: start, endSec: Math.max(end, start + 0.5) });
  }
  // Same boundary smoothing as the events above, for section spans.
  for (let i = 0; i + 1 < spans.length; i++) {
    const gap = spans[i + 1].startSec - spans[i].endSec;
    if (gap > -0.05 && gap < 0.05) spans[i].endSec = spans[i + 1].startSec;
  }

  const sections: RawSection[] = spans.map((sp) => ({
    name: sp.name,
    startSec: sp.startSec,
    endSec: sp.endSec,
    chords: [],
  }));
  // Assign each chord to the section containing its start (the merge
  // re-bins by absolute time regardless; assignment is for tidiness).
  for (const e of events) {
    let target = sections.find((s) => e.startSec >= s.startSec && e.startSec < s.endSec);
    if (!target) target = sections.length > 0 ? sections[sections.length - 1] : undefined;
    if (target) target.chords.push(e);
  }

  // ——— mode from the tonic triad vote (source has no mode) ————————
  const MAJORISH = new Set(["maj", "maj7", "7"]);
  const MINORISH = new Set(["min", "min7", "m7b5", "dim"]);
  let majWeight = 0;
  let minWeight = 0;
  for (const e of events) {
    if (!e.root || pitchClass(e.root as NoteName) !== keyPc) continue;
    const w = Math.max(0.25, e.endSec - e.startSec);
    if (MAJORISH.has(e.quality ?? "")) majWeight += w;
    else if (MINORISH.has(e.quality ?? "")) minWeight += w;
  }
  const mode: RawCatalogSong["mode"] = minWeight > majWeight * 1.5 ? "aeolian" : "ionian";
  if (mode === "ionian" && majWeight <= minWeight * 1.5) {
    warnings.push("Mode inferred with a weak tonic-triad vote — verify the major/minor reading");
  }

  if (keyChanges > 0) warnings.push(`${keyChanges} inline key change(s) in the source were followed`);
  if (stats.applied > 0) warnings.push(`${stats.applied} applied chords (V/x) resolved to absolute roots`);
  if (stats.simplified > 0) {
    warnings.push(
      `Figure notation simplified on ${stats.simplified} chords (inversions, extensions, h/o/+/b5/x symbols)`,
    );
  }
  if (unknownTokens > 0) {
    const samples = [...unknownSamples].map((s) => `"${s}"`).join(", ");
    warnings.push(`${unknownTokens} unrecognized chord tokens skipped (e.g. ${samples})`);
  }

  return {
    title: data.metadata?.title ?? "Untitled",
    artist: data.metadata?.artist,
    key: keyNote ?? undefined,
    mode,
    bpm: data.metadata?.tempo ? Math.round(data.metadata.tempo * 4) : undefined,
    sections,
    sourceFormat: "rock-corpus-tdc",
    warnings,
  };
}
