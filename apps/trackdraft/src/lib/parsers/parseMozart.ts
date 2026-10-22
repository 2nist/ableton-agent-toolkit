/**
 * Mozart sonatas — the choCo JAMS→JCRD conversion.
 *
 * This corpus is the mirror image of BiMMuDa and CoCoPops: **harmony only**,
 * no melody, no drums, and no barlines. Each file is one sonata with its
 * `sections[]` holding one entry per chord span (730 of them in Sonata no. 10),
 * labelled in DCML Roman-numeral notation:
 *
 *   I          root-position diatonic triad
 *   V65        figured bass — the chord is V, the figure says which tone is in
 *              the bass (65 = first inversion seventh), which maps onto our
 *              `voicing.inversion`
 *   viio7      diminished
 *   ii%65      half-diminished
 *   It6        augmented sixth (Italian; Fr43 / Ger6 likewise)
 *   Fnan       Neapolitan in the local key of F
 *   FV(64)     the local key is F; the parenthesised figure is decoration
 *   AV/ii      V of ii — a tonicisation *without* a key prefix
 *   Fviio6/V   key F, then viio6 of V; slash chains read right to left
 *
 * Two things the format does **not** give us, and this parser therefore refuses
 * to invent: barlines, and section structure. Key prefixes are per-chord
 * interpretations (a cadential `CV(64)` lasts 0.05 s), not regions, so treating
 * them as sections would produce hundreds of one-chord "sections".
 */

import { noteName, pitchClass, SCALE_INTERVALS } from "@music-theory/core";
import type { ChordQuality, NoteName, ScaleType } from "@music-theory/core";
import type { BlueprintSong, BlueprintSection, Chord } from "@music-theory/song-blueprint";
import { degreeRelativeTo } from "../harmony/tonic";

/** The Roman numerals DCML uses, longest first so `III` wins over `II`. */
const ROMAN_VALUES: [string, number][] = [
  ["VII", 6], ["III", 2], ["VI", 5], ["IV", 3], ["II", 1], ["V", 4], ["I", 0],
];

const LETTER_PC: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/** Chord-onset resolution: DCML `start_ms` is not on a grid, so onsets are
 *  quantised to a sixteenth of a beat. Anything shorter than that is a
 *  grace-note artefact of the conversion, not a chord. */
const ONSET_QUANTUM = 0.25;

export interface ParsedMozartLabel {
  /** Absolute pitch class of the chord root. */
  rootPc: number;
  /** Degree in the sonata's own key, for the app's Roman-numeral model. */
  degree: number;
  accidental: number;
  quality: ChordQuality;
  /** Chord tone in the bass, as our voicing model counts it. */
  inversion: number;
  /** Local tonic the label was written against, when it differs. */
  localKeyPc: number | null;
  /** True for augmented sixths and Neapolitans — chromatic function chords. */
  chromatic: boolean;
}

/** Split `IV`/`vi`/`bVI`/`#viio` into a degree, an accidental and a case. */
function parseRoman(token: string): { degree: number; accidental: number; minor: boolean; diminished: boolean } | null {
  let rest = token;
  let accidental = 0;
  if (rest.startsWith("#") || rest.startsWith("♯")) {
    accidental = 1;
    rest = rest.slice(1);
  } else if (rest.startsWith("b") || rest.startsWith("♭")) {
    accidental = -1;
    rest = rest.slice(1);
  }

  for (const [text, degree] of ROMAN_VALUES) {
    if (rest.toLowerCase().startsWith(text.toLowerCase())) {
      const matched = rest.slice(0, text.length);
      const minor = matched === matched.toLowerCase();
      return { degree, accidental, minor, diminished: false };
    }
  }
  return null;
}

function qualityFor(
  minor: boolean,
  diminished: boolean,
  augmented: boolean,
  halfDiminished: boolean,
  figures: string,
  majorSeventh: boolean,
): ChordQuality {
  // Figures 65/43/2 are inversions of a *seventh* chord even though they do
  // not contain a 7 — V2 is V7 in third inversion, not a triad.
  const seventh = /7|65|43|42|^2$/.test(figures);
  if (halfDiminished) return "m7b5";
  if (diminished) return "dim";
  if (augmented) return "aug";
  if (majorSeventh) return "maj7";
  if (minor) return seventh ? "min7" : "min";
  return seventh ? "7" : "maj";
}

/**
 * Figured bass → which chord tone is in the bass. `6` and `64` are triad
 * inversions; `7/65/43/2` are the seventh-chord family.
 */
export function inversionFor(figures: string): number {
  // `%`/`o`/`+` are quality markers that can precede the figures (`ii%65`).
  const raw = figures.replace(/[%o+]/g, "");
  if (raw.startsWith("42") || raw === "2") return 3;
  if (raw.startsWith("43")) return 2;
  if (raw.startsWith("65")) return 1;
  if (raw.startsWith("64")) return 2;
  if (raw.startsWith("6")) return 1;
  return 0;
}

/**
 * Does the token start with a local-key prefix?
 *
 * Two forms: an explicit mode (`Dmin…`, `Fmaj…`), or a bare letter before a
 * Roman numeral / augmented sixth (`FV(64)`, `Fviio6/V`, `Fnan`). A flat or
 * sharp after that bare letter belongs to the **Roman numeral**, not the key:
 * `FbVI` in F major is F + ♭VI (a chromatic flat-sixth), and the alternative
 * reading — F-flat major — is not a key these sonatas visit. `F#viio7/vi`
 * confirms it: ♯viio of vi is a plain secondary leading-tone chord.
 */
function keyPrefix(label: string): { keyPc: number; mode: ScaleType | null; rest: string } | null {
  const withMode = /^([A-G])([#b])?(maj|min)/.exec(label);
  if (withMode) {
    const pc = LETTER_PC[withMode[1]];
    const accidental = withMode[2] === "#" ? 1 : withMode[2] === "b" ? -1 : 0;
    return {
      keyPc: (pc + accidental + 12) % 12,
      mode: withMode[3] === "min" ? "aeolian" : "ionian",
      rest: label.slice(withMode[0].length),
    };
  }
  const bare = /^([A-G])(?=It|Fr|Ger|nan|[#b]?[ivIV])/.exec(label);
  if (!bare) return null;
  return { keyPc: LETTER_PC[bare[1]], mode: null, rest: label.slice(bare[0].length) };
}

/**
 * Resolve one DCML label to an absolute root and the app's degree model.
 *
 * Tonicisation is resolved right-to-left, the way the notation reads:
 * `V/V/ii` is V of (V of ii). The label's own Roman numeral is then placed
 * against that local tonic, and the resulting root is finally re-expressed
 * against the sonata's key — which is what the hex wheel and every planner
 * expect, while `extendedSuffix` keeps the original for reference.
 */
export function parseMozartLabel(
  raw: string,
  sonataKeyPc: number,
  sonataScale: ScaleType,
): ParsedMozartLabel | null {
  let label = raw.trim();
  if (!label) return null;

  let localKeyPc: number | null = null;
  let localMode: ScaleType | null = null;
  const prefix = keyPrefix(label);
  if (prefix) {
    localKeyPc = prefix.keyPc;
    localMode = prefix.mode;
    label = prefix.rest;
  }

  // Augmented sixths are named, not spelled as degrees — and the name comes
  // after any key prefix (`CminGer6`), so this is read on the remainder.
  const augmentedSixth = /^(It|Fr|Ger)/.exec(label);

  // Right-to-left tonicisation chain: /V/ii means "of (V of ii)".
  const chain = label.split("/");
  let core = chain[0];
  const targets = chain.slice(1);

  let tonicPc = localKeyPc ?? sonataKeyPc;
  let tonicScale: ScaleType = localMode ?? sonataScale;
  // Walk from the innermost target outward.
  for (let i = targets.length - 1; i >= 0; i--) {
    const parsed = parseRoman(targets[i].replace(/[o+%]/g, ""));
    if (!parsed) continue;
    const intervals = SCALE_INTERVALS[tonicScale] ?? SCALE_INTERVALS.ionian;
    tonicPc = (tonicPc + intervals[parsed.degree] + parsed.accidental + 12) % 12;
    tonicScale = "ionian";
  }

  // Figures = the digits/symbols after the Roman numeral. Parenthesised
  // qualifiers are decoration describing the chord's spacing, NOT figures —
  // `CI(97)` is a plain C major triad in the key of C, so the parentheses are
  // dropped before the figures are read, or "97" would read as a seventh.
  const coreNoParens = core.replace(/\([^)]*\)/g, "");
  const figuresOnly = (/[\d#b+%]*$/.exec(coreNoParens)?.[0] ?? "");

  let degree: number;
  let accidental: number;
  let quality: ChordQuality;
  let chromatic = false;

  if (augmentedSixth) {
    // Built on the flattened sixth degree; the augmented quality carries the
    // raised fourth that names it.
    degree = 5;
    accidental = -1;
    quality = "aug";
    chromatic = true;
  } else if (/nan/.test(core)) {
    // Neapolitan: a major triad on the flattened second.
    degree = 1;
    accidental = -1;
    quality = "maj";
    chromatic = true;
  } else {
    const diminished = /o/.test(core);
    const halfDiminished = /%/.test(core);
    const augmented = /\+/.test(core);
    const majorSeventh = /M/.test(core);
    const parsed = parseRoman(core.replace(/[o+%M]/g, ""));
    if (!parsed) return null;
    degree = parsed.degree;
    accidental = parsed.accidental;
    quality = qualityFor(parsed.minor, diminished, augmented, halfDiminished, figuresOnly, majorSeventh);
    chromatic = accidental !== 0 || diminished || halfDiminished || augmented;
  }

  const intervals = SCALE_INTERVALS[tonicScale] ?? SCALE_INTERVALS.ionian;
  // A leading-tone chord is a semitone below its local tonic, whatever scale
  // the key is in. Minor keys need this explicitly (their diatonic 7th is a
  // whole tone down), and DCML writes the raised leading tone as `#viio`
  // only when the *diatonic* seventh would be natural, so the accidental is
  // redundant once the chord is understood as a leading tone: `F#viio7/vi`
  // in F is C#dim7 resolving to Dm, not D dim.
  const isLeadingTone = degree === 6 && accidental >= 0;
  const offset = isLeadingTone ? 11 : intervals[degree] + accidental;
  const rootPc = ((tonicPc + offset) % 12 + 12) % 12;
  const relative = romanForRoot(rootPc, sonataKeyPc, sonataScale, quality);

  return {
    rootPc,
    degree: relative.deg,
    accidental: relative.acc,
    quality,
    inversion: inversionFor(figuresOnly),
    localKeyPc: localKeyPc != null && localKeyPc !== sonataKeyPc ? localKeyPc : null,
    chromatic,
  };
}

/** `"Piano Sonata no. 10 in C major"` → C ionian. */
export function parseMozartKey(title: string): { keyName: NoteName; scale: ScaleType } | null {
  const match = /in\s+([A-G])(?:\s*(flat|sharp)|\s*([#b]))?\s*(major|minor|maj|min)/i.exec(title);
  if (!match) return null;
  const [, letter, word, symbol, modeText] = match;
  let pc = LETTER_PC[letter.toUpperCase()];
  if (word && /flat/i.test(word)) pc = (pc + 11) % 12;
  if (word && /sharp/i.test(word)) pc = (pc + 1) % 12;
  if (symbol === "b") pc = (pc + 11) % 12;
  if (symbol === "#") pc = (pc + 1) % 12;
  const minor = /min/i.test(modeText);
  // Spell the key the way the title did: B flat, not A sharp.
  const flat = (word && /flat/i.test(word)) || symbol === "b";
  const keyName: NoteName = flat
    ? "C Db D Eb E F Gb G Ab A Bb B".split(" ")[pc]
    : "C C# D D# E F F# G G# A A# B".split(" ")[pc];
  return { keyName, scale: minor ? "aeolian" : "ionian" };
}

/**
 * Place a root in the sonata's scale.
 *
 * `degreeRelativeTo` reads an ambiguous semitone as a flat, which is right for
 * ♭II/♭III/♭VI but produces nonsense for a leading tone: B in C minor comes
 * back as "♭I", a degree that does not exist. A diminished chord a semitone
 * under the tonic is the leading tone, so it is written vii here instead.
 */
function romanForRoot(
  rootPc: number,
  keyPc: number,
  scale: ScaleType,
  quality: ChordQuality,
): { deg: number; acc: number } {
  const relative = degreeRelativeTo(rootPc, keyPc, scale);
  const semitoneBelowTonic = (((rootPc - keyPc) % 12) + 12) % 12 === 11;
  const diminished = quality === "dim" || quality === "m7b5";
  if (semitoneBelowTonic && diminished) return { deg: 6, acc: 0 };
  if (relative.deg === 0 && relative.acc === -1) return { deg: 6, acc: 0 };
  return { deg: relative.deg, acc: relative.acc };
}

/** Roman numeral text for the app, from a degree and an accidental. */
function romanFor(degree: number, accidental: number, quality: ChordQuality): string {
  const base = ["I", "II", "III", "IV", "V", "VI", "VII"][degree] ?? "I";
  const minor = quality === "min" || quality === "min7" || quality === "dim" || quality === "m7b5";
  const prefix = accidental === -1 ? "♭" : accidental === 1 ? "♯" : "";
  const numeral = minor ? base.toLowerCase() : base;
  const suffix =
    quality === "dim" || quality === "m7b5"
      ? "°"
      : quality === "maj7"
        ? "maj7"
        : quality === "min7"
          ? "7"
          : quality === "7"
            ? "7"
            : "";
  return `${prefix}${numeral}${suffix}`;
}

/**
 * Parse one Mozart `.jcrd.json` into a BlueprintSong.
 *
 * Timeline: chord spans overlap in this conversion (`chord_1` starts at 1100 ms
 * and lasts 2000, `chord_2` starts at 1200), so a chord's length is taken from
 * the *next* onset. Onsets are quantised to a sixteenth and consecutive
 * identical chords are merged — that is the progression, not the raw onsets.
 */
export function parseMozartJcrd(raw: unknown): BlueprintSong {
  if (typeof raw !== "object" || raw === null) throw new Error("Not a valid Mozart JCRD file");
  const data = raw as Record<string, unknown>;
  const title = typeof data.title === "string" ? data.title : "Untitled";
  const bpm = typeof data.bpm === "number" && data.bpm > 0 ? data.bpm : 120;

  const parsedKey = parseMozartKey(title);
  const keyName: NoteName = parsedKey?.keyName ?? "C";
  const scale: ScaleType = parsedKey?.scale ?? "ionian";
  const keyPc = pitchClass(keyName);

  const timeSignature = typeof data.time_signature === "string" ? data.time_signature : "4/4";
  const [rawNum, rawDen] = timeSignature.split("/").map((part) => Number(part));
  const numerator = Number.isFinite(rawNum) && rawNum > 0 ? rawNum : 4;
  const denominator = Number.isFinite(rawDen) && rawDen > 0 ? rawDen : 4;
  const beatsPerBar = (numerator * 4) / denominator;

  interface Span { startMs: number; label: string }
  const spans: Span[] = [];
  for (const section of (data.sections as Array<Record<string, unknown>>) ?? []) {
    const labels = Array.isArray(section.chords) ? (section.chords as string[]) : [];
    const startMs = Number(section.start_ms);
    if (!Number.isFinite(startMs) || labels.length === 0) continue;
    spans.push({ startMs, label: labels[0] });
  }
  spans.sort((a, b) => a.startMs - b.startMs);

  const warnings: string[] = [];
  if (!parsedKey) {
    warnings.push(`could not read the key from "${title}" — assumed C ionian`);
  }

  const msPerBeat = 60000 / bpm;
  const firstMs = spans[0]?.startMs ?? 0;
  const chords: Chord[] = [];
  let unmapped = 0;
  /** Running position, so a merged chord can be extended by its neighbour's
   *  length without recomputing everything before it. */
  let cursor = 0;

  for (let i = 0; i < spans.length; i++) {
    const span = spans[i];
    const nextMs = i + 1 < spans.length ? spans[i + 1].startMs : span.startMs + msPerBeat;
    const startBeat = Math.round(((span.startMs - firstMs) / msPerBeat) / ONSET_QUANTUM) * ONSET_QUANTUM;
    const endBeat = Math.round(((nextMs - firstMs) / msPerBeat) / ONSET_QUANTUM) * ONSET_QUANTUM;
    const beats = Math.max(ONSET_QUANTUM, endBeat - startBeat);

    const parsed = parseMozartLabel(span.label, keyPc, scale);
    if (!parsed) {
      unmapped += 1;
      continue;
    }

    const romanNumeral = romanFor(parsed.degree, parsed.accidental, parsed.quality);
    const root = noteName(parsed.rootPc, keyName);
    const last = chords[chords.length - 1];
    // The same chord continuing: extend it rather than emitting a new entry.
    if (
      last &&
      last.root === root &&
      last.quality === parsed.quality &&
      last.romanNumeral === romanNumeral &&
      Math.abs(startBeat - cursor) < ONSET_QUANTUM
    ) {
      last.beats = Math.round((last.beats + beats) * 4) / 4;
      cursor += beats;
      continue;
    }

    chords.push({
      id: crypto.randomUUID(),
      romanNumeral,
      root,
      quality: parsed.quality,
      beats: Math.round(beats * 4) / 4,
      voicing: parsed.inversion > 0 ? { inversion: parsed.inversion } : undefined,
      extendedSuffix: span.label,
      isSubstitution: parsed.chromatic || undefined,
    });
    cursor = startBeat + beats;
  }

  if (unmapped > 0) warnings.push(`${unmapped} chord label(s) could not be read and were skipped`);

  const totalBeats = chords.reduce((sum, chord) => sum + chord.beats, 0);
  const bars = Math.max(1, Math.ceil(totalBeats / beatsPerBar));

  // One section: this format has no barlines and no section markers, and the
  // key prefixes are per-chord interpretations rather than regions.
  const section: BlueprintSection = {
    id: crypto.randomUUID(),
    name: "Full Sonata",
    role: "custom",
    bars,
    chords,
    beatsPerChord: 2,
    velocity: "mf",
    timeSignatureNumerator: numerator,
    timeSignatureDenPower: Math.log2(denominator),
  };

  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    title,
    artist: typeof data.artist === "string" ? data.artist : undefined,
    key: keyName,
    scale,
    bpm,
    timeSignatureNumerator: numerator,
    timeSignatureDenominator: denominator,
    sections: [section],
    arrangement: [{ sectionId: section.id, repeats: 1 }],
    concept: `Mozart sonata (choCo): ${chords.length} chords`,
    provenance: {
      source: "catalog-lookup",
      extractedAt: now,
      warnings: [
        ...warnings,
        `harmony from DCML Roman numerals; no barlines in the source, so the ${bars}-bar length is computed from the chord timing`,
      ],
    },
    createdAt: now,
    updatedAt: now,
  };
}
