/**
 * MusicXML → BlueprintSong, aimed at the chart exports iReal Pro writes.
 *
 * Why MusicXML and not iReal's native `irealb://` string: the export carries
 * real barlines, the exact chord symbol in `<kind text="…">`, per-measure
 * meter changes, `<rehearsal>` section letters and the navigation marks
 * (`<segno>`, `<coda>`, `<sound dalsegno>`), and it survives a round trip
 * through any notation app. Its cost is bulk and the fact that iReal writes
 * rests instead of notes, so there is no melody — chords, sections and meter
 * are what this parser extracts, and it says so in `provenance`.
 *
 * Two structural facts decide the whole design:
 *
 * 1. **Chord length comes from the following note.** A `<harmony>` is a
 *    label at a position, not a duration; the rest or note after it advances
 *    the measure clock, so a chord runs until the next harmony (or the bar
 *    line). Everything is walked in document order — `preserveOrder` exists
 *    for exactly this, since a plain key/value parse would lose the
 *    interleaving of `<harmony>` and `<note>`.
 * 2. **The written chart is not the played form.** iReal puts "D.S. al Coda"
 *    in the score and expects the reader to do the jump. A song timeline
 *    cannot leave that to the reader, so `planMeasureOrder` expands the
 *    repeat/navigation marks into the order the measures actually sound, and
 *    a second pass over a section becomes an `ArrangementRepeat` with
 *    `overrides` rather than a duplicated section.
 *
 * Dependency: fast-xml-parser (same as parseAbleton.ts) — no native modules,
 * runs in the browser behind the Vite `/__local-file` endpoint.
 */

import { XMLParser } from "fast-xml-parser";
import { getChordIntervals, parseChordQuality } from "@music-theory/core";
import type { ChordQuality, NoteName, ScaleType } from "@music-theory/core";
import type { BlueprintSong, BlueprintSection, ArrangementRepeat, Chord, MeterChange, SectionRole } from "../../types/blueprint";
import { degreeRelativeTo } from "../harmony/tonic";

// ---------------------------------------------------------------------------
// Ordered XML access
//
// With `preserveOrder`, fast-xml-parser emits `{ tag: children[], ":@": attrs }`
// per element and `{ "#text": value }` for text, so document order survives.
// ---------------------------------------------------------------------------

type XmlNode = Record<string, unknown>;

function tagOf(node: XmlNode): string | null {
  const key = Object.keys(node).find((k) => k !== ":@");
  return key ?? null;
}

function childrenOf(node: XmlNode): XmlNode[] {
  const tag = tagOf(node);
  const value = tag ? node[tag] : undefined;
  return Array.isArray(value) ? (value as XmlNode[]) : [];
}

function attr(node: XmlNode, name: string): string | undefined {
  const attrs = node[":@"];
  if (!attrs || typeof attrs !== "object") return undefined;
  const value = (attrs as Record<string, unknown>)[`@_${name}`];
  return value === undefined ? undefined : String(value);
}

function findChild(node: XmlNode, tag: string): XmlNode | undefined {
  return childrenOf(node).find((child) => tagOf(child) === tag);
}

function hasChild(node: XmlNode, tag: string): boolean {
  return childrenOf(node).some((child) => tagOf(child) === tag);
}

/** The concatenated text directly inside `node` (`<duration>768</duration>`). */
function ownText(node: XmlNode): string {
  const parts: string[] = [];
  for (const child of childrenOf(node)) {
    if (tagOf(child) === "#text") parts.push(String(child["#text"] ?? ""));
  }
  return parts.join("").trim();
}

function childText(node: XmlNode, tag: string): string {
  const child = findChild(node, tag);
  return child ? ownText(child) : "";
}

function grandchildText(node: XmlNode, parent: string, child: string): string {
  const wrapper = findChild(node, parent);
  return wrapper ? childText(wrapper, child) : "";
}

function num(text: string, fallback = 0): number {
  const value = Number(text);
  return Number.isFinite(value) ? value : fallback;
}

// ---------------------------------------------------------------------------
// Domain shapes
// ---------------------------------------------------------------------------

interface TimeSignature {
  beats: number;
  beatType: number;
}

interface Degree {
  value: number;
  alter: number;
  type: string;
}

interface HarmonySpec {
  rootStep: string;
  rootAlter: number;
  /** iReal's own symbol (`<kind text="m7">`), when it wrote one. */
  symbol: string | undefined;
  kind: string;
  degrees: Degree[];
  bassStep: string | undefined;
  bassAlter: number;
}

interface PlacedHarmony {
  /** Offset from the measure start, in divisions. */
  start: number;
  /** Length in divisions; resolved once the next harmony (or bar line) is known. */
  duration: number;
  harmony: HarmonySpec;
}

interface Markers {
  segno?: boolean;
  coda?: boolean;
  dalsegno?: boolean;
  dacapo?: boolean;
  tocoda?: boolean;
  fine?: boolean;
  words?: string;
  tempo?: number;
}

interface Measure {
  index: number;
  /** Divisions per quarter note in force for this measure. */
  divisions: number;
  length: number;
  time: TimeSignature;
  keyFifths: number;
  keyMode: string;
  chords: PlacedHarmony[];
  rehearsal?: string;
  markers: Markers;
  repeatForward?: boolean;
  repeatBackward?: boolean;
  /** Which repeat passes this bar belongs to (1st/2nd ending). Empty = all. */
  endings: number[];
}

// ---------------------------------------------------------------------------
// Key spelling
// ---------------------------------------------------------------------------

/** Circle-of-fifths spellings, indexed by `fifths + 7`. Sharps on the sharp
 *  side, flats on the flat side — the export already told us which it means,
 *  so we never respell it as the enharmonic twin. */
const MAJOR_KEYS = ["Cb", "Gb", "Db", "Ab", "Eb", "Bb", "F", "C", "G", "D", "A", "E", "B", "F#", "C#"];
const MINOR_KEYS = ["Ab", "Eb", "Bb", "F", "C", "G", "D", "A", "E", "B", "F#", "C#", "G#", "D#", "A#"];

function keyFor(fifths: number, mode: string): { key: NoteName; scale: ScaleType } {
  const index = Math.max(0, Math.min(14, fifths + 7));
  const minor = /minor/i.test(mode);
  return minor
    ? { key: MINOR_KEYS[index] as NoteName, scale: "aeolian" }
    : { key: MAJOR_KEYS[index] as NoteName, scale: "ionian" };
}

const STEP_PC: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

function stepToPc(step: string, alter: number): number {
  const base = STEP_PC[step.toUpperCase()] ?? 0;
  return (((base + alter) % 12) + 12) % 12;
}

function stepToName(step: string, alter: number): NoteName {
  const accidental = alter > 0 ? "#".repeat(alter) : alter < 0 ? "b".repeat(-alter) : "";
  return `${step.toUpperCase()}${accidental}`;
}

// ---------------------------------------------------------------------------
// Harmony → Chord
// ---------------------------------------------------------------------------

/** MusicXML's `<kind>` vocabulary → the symbol our quality parser speaks.
 *  Only the ones iReal and mainstream exporters emit; anything else falls
 *  through as an `extendedSuffix`. */
const KIND_SUFFIX: Record<string, string> = {
  major: "",
  minor: "m",
  dominant: "7",
  "major-seventh": "maj7",
  "minor-seventh": "m7",
  diminished: "dim",
  augmented: "aug",
  "half-diminished": "m7b5",
  "diminished-seventh": "dim7",
  "major-minor": "mMaj7",
  "major-sixth": "6",
  "minor-sixth": "m6",
  "dominant-seventh": "7",
  "dominant-ninth": "9",
  "major-ninth": "maj9",
  "minor-ninth": "m9",
  "dominant-11th": "11",
  "major-11th": "maj11",
  "minor-11th": "m11",
  "dominant-13th": "13",
  "major-13th": "maj13",
  "minor-13th": "m13",
  "suspended-second": "sus2",
  "suspended-fourth": "sus4",
  "power": "5",
};

/** Degrees as MusicXML names them (`<degree-value>2</degree-value>`) against
 *  chord-symbol extensions (`add9`). */
const DEGREE_LETTER: Record<number, string> = { 2: "9", 4: "11", 6: "13", 7: "7" };

function accidentalText(alter: number): string {
  if (alter > 0) return "#".repeat(alter);
  if (alter < 0) return "b".repeat(-alter);
  return "";
}

/** Fold `<degree>` alterations into a symbol: `add9` on a triad, `7#9` on a
 *  seventh chord — which is exactly how a player writes them. */
function applyDegrees(suffix: string, degrees: Degree[]): string {
  let out = suffix;
  const hasSeventh = /7|9|11|13/.test(out);
  for (const degree of degrees) {
    const letter = DEGREE_LETTER[degree.value];
    if (!letter || degree.type === "subtract") continue;
    const accidental = accidentalText(degree.alter);
    if (degree.type === "add") {
      // "add9" colors a triad; on a seventh chord the plain "9" already
      // implies the b7, so "9" is both shorter and what the chart means.
      out += hasSeventh && degree.alter === 0 ? letter : `add${accidental}${letter}`;
    } else {
      out += `${accidental}${letter}`;
    }
  }
  return out;
}

interface ResolvedChord {
  chord: Chord;
  /** Bass the export asked for, when it is not the chord's own root. */
  slashBass?: string;
  /** True when the requested bass is not a chord tone (C/D). */
  foreignBass?: boolean;
}

function romanSuffix(quality: ChordQuality): string {
  switch (quality) {
    case "maj":
      return "";
    case "dim":
      return "°";
    case "m7b5":
      return "%";
    case "dim7":
      return "°7";
    case "min7":
      return "7";
    case "mMaj7":
      return "maj7";
    default: {
      // Minor-ness is already carried by the numeral's case, so `min9`
      // becomes "ii9", not "iim9".
      const symbol = quality.startsWith("min") ? quality.slice(3) : quality;
      return symbol;
    }
  }
}

const MINOR_CASED = new Set<ChordQuality>([
  "min",
  "min7",
  "min6",
  "min9",
  "min11",
  "min13",
  "m7b5",
  "dim",
  "dim7",
  "mMaj7",
]);

function romanNumeralsFor(rootPc: number, keyPc: number, scale: ScaleType, quality: ChordQuality): string {
  const { deg, acc } = degreeRelativeTo(rootPc, keyPc, scale);
  const base = ["I", "II", "III", "IV", "V", "VI", "VII"][deg] ?? "I";
  const prefix = acc === -1 ? "♭" : acc === 1 ? "♯" : "";
  return `${prefix}${MINOR_CASED.has(quality) ? base.toLowerCase() : base}${romanSuffix(quality)}`;
}

function resolveChord(
  harmony: HarmonySpec,
  keyName: NoteName,
  scale: ScaleType,
  beats: number,
): ResolvedChord {
  const rootPc = stepToPc(harmony.rootStep, harmony.rootAlter);
  const root = stepToName(harmony.rootStep, harmony.rootAlter);

  // iReal's `<kind text>` is the symbol the chart actually prints, so it wins
  // over the coarser machine vocabulary in `<kind>` itself.
  const baseSymbol =
    harmony.symbol && harmony.symbol.length > 0
      ? harmony.symbol
      : (KIND_SUFFIX[harmony.kind] ?? "");
  const symbol = applyDegrees(baseSymbol, harmony.degrees);

  const quality = parseChordQuality(symbol) ?? "maj";
  // A symbol the vocabulary cannot hold (7#9b13) keeps its base quality and
  // rides along as display text, exactly like the harmony view does.
  const extendedSuffix = parseChordQuality(symbol) === null && symbol !== "" ? symbol : undefined;

  const keyPc = stepToPc(keyName.replace(/[#b]+$/, "") || "C", 0) + accidentalOf(keyName);

  const chord: Chord = {
    id: crypto.randomUUID(),
    romanNumeral: romanNumeralsFor(rootPc, keyPc, scale, quality),
    root,
    quality,
    beats,
  };
  if (extendedSuffix) chord.extendedSuffix = extendedSuffix;

  // `<bass>` is how a slash chord is written. When the requested bass is a
  // chord tone we can honour it exactly — it *is* an inversion — otherwise it
  // stays a label, because the model has no "non-chord tone in the bass".
  if (harmony.bassStep) {
    const bassPc = stepToPc(harmony.bassStep, harmony.bassAlter);
    const bassName = stepToName(harmony.bassStep, harmony.bassAlter);
    if (bassPc !== rootPc) {
      const intervals = getChordIntervals(quality);
      const relative = (((bassPc - rootPc) % 12) + 12) % 12;
      const inversion = intervals.indexOf(relative);
      if (inversion > 0) {
        chord.voicing = { inversion };
      } else {
        return { chord, slashBass: bassName, foreignBass: true };
      }
      return { chord, slashBass: bassName };
    }
  }
  return { chord };
}

function accidentalOf(name: string): number {
  const match = name.match(/([#b]+)$/);
  if (!match) return 0;
  return match[1].startsWith("#") ? match[1].length : -match[1].length;
}

// ---------------------------------------------------------------------------
// Score reading
// ---------------------------------------------------------------------------

function readHarmony(node: XmlNode): HarmonySpec | null {
  const rootStep = grandchildText(node, "root", "root-step");
  if (!rootStep) return null;
  const kindNode = findChild(node, "kind");
  const degrees = childrenOf(node)
    .filter((child) => tagOf(child) === "degree")
    .map((child) => ({
      value: num(childText(child, "degree-value"), 0),
      alter: num(childText(child, "degree-alter"), 0),
      type: childText(child, "degree-type") || "add",
    }));
  return {
    rootStep,
    rootAlter: num(grandchildText(node, "root", "root-alter"), 0),
    symbol: kindNode ? attr(kindNode, "text") : undefined,
    kind: kindNode ? ownText(kindNode) : "major",
    degrees,
    bassStep: grandchildText(node, "bass", "bass-step") || undefined,
    bassAlter: num(grandchildText(node, "bass", "bass-alter"), 0),
  };
}

function readMarkers(node: XmlNode, markers: Markers): void {
  for (const directionType of childrenOf(node).filter((c) => tagOf(c) === "direction-type")) {
    if (hasChild(directionType, "segno")) markers.segno = true;
    if (hasChild(directionType, "coda")) markers.coda = true;
    const rehearsal = findChild(directionType, "rehearsal");
    if (rehearsal) markers.words = undefined;
    const words = findChild(directionType, "words");
    if (words) markers.words = ownText(words);
  }
  for (const sound of childrenOf(node).filter((c) => tagOf(c) === "sound")) {
    if (attr(sound, "segno")) markers.segno = true;
    if (attr(sound, "coda")) markers.coda = true;
    if (attr(sound, "dalsegno")) markers.dalsegno = true;
    if (attr(sound, "dacapo")) markers.dacapo = true;
    if (attr(sound, "tocoda")) markers.tocoda = true;
    if (attr(sound, "fine")) markers.fine = true;
    const tempo = attr(sound, "tempo");
    if (tempo) markers.tempo = num(tempo, 0);
  }
}

function readMeasures(part: XmlNode): {
  measures: Measure[];
  tempo: number | undefined;
  firstTime: TimeSignature;
  firstKey: { fifths: number; mode: string };
} {
  const measures: Measure[] = [];
  let divisions = 1;
  let time: TimeSignature = { beats: 4, beatType: 4 };
  let fifths = 0;
  let mode = "major";
  let tempo: number | undefined;
  let activeEndings: number[] = [];
  const firstKey = { fifths: 0, mode: "major" };
  let firstTime: TimeSignature = { beats: 4, beatType: 4 };
  let sawHeader = false;

  for (const child of childrenOf(part)) {
    if (tagOf(child) !== "measure") continue;
    const markers: Markers = {};
    const placed: { start: number; harmony: HarmonySpec }[] = [];
    let position = 0;
    let furthest = 0;
    let rehearsal: string | undefined;
    let repeatForward = false;
    let repeatBackward = false;
    const endings = new Set(activeEndings);

    for (const node of childrenOf(child)) {
      switch (tagOf(node)) {
        case "attributes": {
          const divisionText = childText(node, "divisions");
          if (divisionText) divisions = Math.max(1, num(divisionText, divisions));
          const timeNode = findChild(node, "time");
          if (timeNode) {
            time = {
              beats: num(childText(timeNode, "beats"), time.beats),
              beatType: num(childText(timeNode, "beat-type"), time.beatType),
            };
          }
          const keyNode = findChild(node, "key");
          if (keyNode) {
            fifths = num(childText(keyNode, "fifths"), fifths);
            mode = childText(keyNode, "mode") || mode;
          }
          if (!sawHeader && (timeNode || keyNode)) {
            firstTime = { ...time };
            firstKey.fifths = fifths;
            firstKey.mode = mode;
            sawHeader = true;
          }
          break;
        }
        case "note": {
          // A chord tone doesn't advance the clock; a grace note has none.
          if (hasChild(node, "chord") || hasChild(node, "grace")) break;
          const duration = num(childText(node, "duration"), 0);
          position += duration;
          furthest = Math.max(furthest, position);
          break;
        }
        case "forward": {
          position += num(childText(node, "duration"), 0);
          furthest = Math.max(furthest, position);
          break;
        }
        case "backup": {
          position -= num(childText(node, "duration"), 0);
          break;
        }
        case "harmony": {
          const harmony = readHarmony(node);
          // `<offset>` is relative to the current clock position.
          if (harmony) placed.push({ start: Math.max(0, position + num(childText(node, "offset"), 0)), harmony });
          break;
        }
        case "direction": {
          const rehearsalNode = childrenOf(node)
            .filter((c) => tagOf(c) === "direction-type")
            .flatMap((c) => childrenOf(c).filter((t) => tagOf(t) === "rehearsal"))
            .map((r) => ownText(r))
            .find((text) => text.length > 0);
          if (!rehearsal && rehearsalNode) rehearsal = rehearsalNode;
          readMarkers(node, markers);
          break;
        }
        case "sound": {
          readMarkers({ sound: [node] } as XmlNode, markers);
          break;
        }
        case "barline": {
          for (const repeat of childrenOf(node).filter((c) => tagOf(c) === "repeat")) {
            if (attr(repeat, "direction") === "forward") repeatForward = true;
            if (attr(repeat, "direction") === "backward") repeatBackward = true;
          }
          // 1st/2nd endings: `start` opens the bracket, `stop`/`discontinue`
          // closes it on this bar (both ends belong to the ending).
          for (const ending of childrenOf(node).filter((c) => tagOf(c) === "ending")) {
            const numbers = (attr(ending, "number") ?? "1")
              .split(/[,\s]+/)
              .map((part) => Number(part))
              .filter((n) => Number.isFinite(n) && n > 0);
            if (attr(ending, "type") === "start") {
              activeEndings = numbers;
              for (const n of numbers) endings.add(n);
            } else {
              for (const n of numbers) endings.add(n);
              activeEndings = [];
            }
          }
          break;
        }
        default:
          break;
      }
    }

    if (markers.tempo !== undefined && tempo === undefined) tempo = markers.tempo;
    const length = furthest > 0 ? furthest : divisions * time.beats;
    const chords: PlacedHarmony[] = placed.map((entry, i) => {
      const next = placed[i + 1]?.start ?? length;
      return { start: entry.start, duration: Math.max(0, next - entry.start), harmony: entry.harmony };
    });

    measures.push({
      index: measures.length,
      divisions,
      length,
      time: { ...time },
      keyFifths: fifths,
      keyMode: mode,
      chords,
      rehearsal,
      markers,
      repeatForward,
      repeatBackward,
      endings: [...endings].sort((a, b) => a - b),
    });
  }

  if (!sawHeader) {
    const first = measures[0];
    if (first) {
      firstTime = { ...first.time };
      firstKey.fifths = first.keyFifths;
      firstKey.mode = first.keyMode;
    }
  }
  return { measures, tempo, firstTime, firstKey };
}

// ---------------------------------------------------------------------------
// Played form
// ---------------------------------------------------------------------------

/**
 * Expand `<repeat>` spans, honouring 1st/2nd endings: the first pass plays the
 * bars that belong to ending 1 (or to no ending), the second pass plays the
 * ones that belong to ending 2, and a 2nd-ending run *after* the repeat bar is
 * appended to the second pass — which is how the bracket is actually read.
 */
function expandRepeats(
  measures: Measure[],
  order: number[],
): { order: number[]; repeats: boolean; endings: boolean } {
  const out: number[] = [];
  let repeats = false;
  let endings = false;
  let i = 0;
  while (i < order.length) {
    const start = i;
    const closes = measures[order[i]].repeatForward
      ? order.findIndex((index, j) => j >= start && measures[index].repeatBackward)
      : -1;
    if (closes < 0) {
      out.push(order[i]);
      i += 1;
      continue;
    }
    repeats = true;
    const span = order.slice(start, closes + 1);
    let tailEnd = closes + 1;
    while (tailEnd < order.length && measures[order[tailEnd]].endings.some((n) => n > 1)) tailEnd += 1;
    const tail = order.slice(closes + 1, tailEnd);
    const hasEndings = [...span, ...tail].some((index) => measures[index].endings.length > 0);
    if (hasEndings) {
      endings = true;
      out.push(...span.filter((index) => {
        const endingsHere = measures[index].endings;
        return endingsHere.length === 0 || endingsHere.includes(1);
      }));
      out.push(...span.filter((index) => {
        const endingsHere = measures[index].endings;
        return endingsHere.length === 0 || !endingsHere.includes(1);
      }));
      out.push(...tail);
    } else {
      out.push(...span, ...span);
    }
    i = tailEnd;
  }
  return { order: out, repeats, endings };
}

/**
 * The order the measures actually sound, from the repeat and navigation
 * marks. iReal writes "D.S. al Coda" as text and expects the *reader* to
 * jump, so a timeline has to do it for them.
 *
 * Convention followed (and it is the iReal/MusicXML one): the coda sign sits
 * **at the top of the bar you jump from**, so that bar is not played on the
 * repeat pass. When a mark is missing — a D.S. with no segno — the plan falls
 * back to written order rather than guessing.
 */
function planMeasureOrder(measures: Measure[]): { order: number[]; expanded: boolean; notes: string[] } {
  const notes: string[] = [];
  let order = measures.map((m) => m.index);

  // Barline repeats first: `<repeat forward/>` … `<repeat backward/>`, with
  // 1st/2nd endings choosing different bars per pass.
  const expanded = expandRepeats(measures, order);
  order = expanded.order;
  if (expanded.repeats) notes.push(expanded.endings ? "Barline repeats and 1st/2nd endings expanded" : "Barline repeats expanded");

  const segno = measures.findIndex((m) => m.markers.segno);
  const invocation = measures.findIndex((m) => m.markers.dalsegno || m.markers.dacapo);
  if (invocation < 0) return { order, expanded: notes.length > 0, notes };

  // Everything after the D.S. bar is reached *through* the jump, so the first
  // pass stops there — otherwise the bars after it would sound twice.
  order = order.filter((index) => index <= invocation);

  const dacapo = measures[invocation].markers.dacapo === true;
  const jumpTarget = dacapo ? 0 : segno;
  if (jumpTarget < 0) {
    notes.push("D.S./D.C. mark found but no matching segno — form left in written order");
    return { order, expanded: notes.length > 0, notes };
  }

  const codaSigns = measures.filter((m) => m.markers.coda).map((m) => m.index);
  const jumpPoint = codaSigns.find((i) => i < invocation);
  const codaStart = codaSigns.find((i) => i > invocation);

  const secondPassEnd = jumpPoint !== undefined ? jumpPoint : invocation;
  const secondPass = order.filter((index) => index >= jumpTarget && index < secondPassEnd);

  order = [...order, ...secondPass];
  if (jumpPoint !== undefined) notes.push(`D.S./D.C. at bar ${invocation + 1} → segno at bar ${jumpTarget + 1}, jumping at the coda sign on bar ${jumpPoint + 1}`);
  else notes.push(`D.S./D.C. at bar ${invocation + 1} → segno at bar ${jumpTarget + 1}`);

  if (codaStart !== undefined) {
    order = [...order, ...measures.slice(codaStart).map((m) => m.index)];
    notes.push(`Coda taken from bar ${codaStart + 1} to the end`);
  }
  return { order, expanded: true, notes };
}

const ROLE_BY_NAME: { pattern: RegExp; role: SectionRole }[] = [
  { pattern: /intro/i, role: "intro" },
  { pattern: /outro|coda|ending/i, role: "outro" },
  { pattern: /pre[- ]?chorus/i, role: "pre_chorus" },
  { pattern: /chorus/i, role: "chorus" },
  { pattern: /verse/i, role: "verse" },
  { pattern: /bridge/i, role: "bridge" },
  { pattern: /solo/i, role: "solo" },
  { pattern: /break/i, role: "breakdown" },
];

function roleFor(name: string): SectionRole {
  return ROLE_BY_NAME.find((entry) => entry.pattern.test(name))?.role ?? "custom";
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/** Chords shorter than a sixteenth are artifacts of the conversion, not music. */
const MIN_CHORD_BEATS = 0.25;

/**
 * Parse an iReal Pro (or any score-partwise) MusicXML chart into a
 * BlueprintSong: chords with real lengths, sections from the rehearsal
 * letters, and the played form in `arrangement`.
 */
export function musicXmlToBlueprintSong(xml: string, fallbackTitle = "Imported chart"): BlueprintSong {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    preserveOrder: true,
    trimValues: true,
    parseTagValue: false,
    parseAttributeValue: false,
  });
  const document = parser.parse(xml) as XmlNode[];
  const score = document.find((node) => tagOf(node) === "score-partwise");
  if (!score) throw new Error("Not a MusicXML score-partwise document");
  const part = childrenOf(score).find((node) => tagOf(node) === "part");
  if (!part) throw new Error("MusicXML score has no <part>");

  const { measures, tempo, firstTime, firstKey } = readMeasures(part);
  if (measures.length === 0) throw new Error("MusicXML part has no measures");

  const title = childText(findChild(score, "work") ?? score, "work-title") || childText(score, "movement-title") || fallbackTitle;
  const identification = findChild(score, "identification");
  const composerNode = identification
    ? childrenOf(identification)
        .filter((c) => tagOf(c) === "creator")
        .find((c) => attr(c, "type") === "composer")
    : undefined;
  const composer = composerNode ? ownText(composerNode) : "";

  const key = keyFor(firstKey.fifths, firstKey.mode);
  const warnings: string[] = [];

  // Section boundaries: a rehearsal letter, or a coda sign *after* the D.S.
  // (iReal writes the coda as its own passage but doesn't always name it).
  const invocation = measures.findIndex((m) => m.markers.dalsegno || m.markers.dacapo);
  const startsCoda = (measure: Measure) => measure.markers.coda === true && invocation >= 0 && measure.index > invocation;
  const sectionRuns: { name: string; role: SectionRole; measures: Measure[] }[] = [];
  for (const measure of measures) {
    if (sectionRuns.length === 0 || measure.rehearsal || startsCoda(measure)) {
      const name = measure.rehearsal ?? (startsCoda(measure) ? "Coda" : "Chart");
      sectionRuns.push({ name, role: roleFor(name), measures: [] });
    }
    sectionRuns[sectionRuns.length - 1].measures.push(measure);
  }

  const chordsFor = (list: Measure[]): Chord[] => {
    const out: Chord[] = [];
    for (const measure of list) {
      for (const placed of measure.chords) {
        const beats = placed.duration / measure.divisions;
        if (beats < MIN_CHORD_BEATS) continue;
        const resolved = resolveChord(placed.harmony, key.key, key.scale, Math.round(beats * 1000) / 1000);
        // The source symbol is the chord's verbatim label — including the
        // slash bass, which the model cannot otherwise hold.
        const written = `${resolved.chord.root}${placed.harmony.symbol ?? ""}`;
        const label = resolved.slashBass ? `${written}/${resolved.slashBass}` : written;
        if (label) resolved.chord.annotation = label;
        if (resolved.foreignBass) {
          warnings.push(
            `Bar ${measure.index + 1}: ${label} puts a non-chord tone in the bass — kept as a label (the model has no walking bass)`,
          );
        }
        out.push(resolved.chord);
      }
    }
    return out;
  };

  const sections: BlueprintSection[] = sectionRuns.map((run) => {
    const first = run.measures[0];
    const chords = chordsFor(run.measures);
    const counts = new Map<number, number>();
    for (const chord of chords) counts.set(chord.beats, (counts.get(chord.beats) ?? 0) + 1);
    const beatsPerChord =
      [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]?.[0] ?? 4;
    // Meter changes inside the section become a per-bar map, so the section
    // is its real length instead of `bars × the first meter`.
    const meterMap: MeterChange[] = [];
    run.measures.forEach((measure, bar) => {
      const previous = meterMap[meterMap.length - 1];
      const { beats, beatType } = measure.time;
      if (!previous || previous.numerator !== beats || previous.denominator !== beatType) {
        meterMap.push({ bar, numerator: beats, denominator: beatType });
      }
    });
    if (meterMap.length > 1) {
      warnings.push(
        `Section "${run.name}" changes meter ${meterMap.length} time(s) (${meterMap
          .map((change) => `${change.numerator}/${change.denominator}@bar${change.bar + 1}`)
          .join(" ")}) — carried as a per-bar meter map`,
      );
    }
    return {
      id: crypto.randomUUID(),
      name: run.name,
      role: run.role,
      bars: run.measures.length,
      chords,
      beatsPerChord,
      velocity: "mf",
      timeSignatureNumerator: first.time.beats,
      timeSignatureDenPower: Math.log2(first.time.beatType),
      ...(meterMap.length > 1 ? { meterMap } : {}),
    };
  });

  // Map written measures back to their section for the arrangement.
  const sectionOfMeasure = new Map<number, number>();
  sectionRuns.forEach((run, sectionIndex) => {
    for (const measure of run.measures) sectionOfMeasure.set(measure.index, sectionIndex);
  });

  const plan = planMeasureOrder(measures);
  for (const note of plan.notes) warnings.push(note);

  // Walk the played order, grouping consecutive measures of one section into
  // a pass. A pass that covers fewer measures than its section (the repeat
  // that stops at the coda sign) gets explicit overrides rather than a
  // duplicated section.
  const passes: { sectionIndex: number; measures: Measure[] }[] = [];
  for (const measureIndex of plan.order) {
    const sectionIndex = sectionOfMeasure.get(measureIndex);
    if (sectionIndex === undefined) continue;
    const measure = measures[measureIndex];
    const run = sectionRuns[sectionIndex];
    const last = passes[passes.length - 1];
    // A new pass starts when the section changes, when the section's own first
    // bar comes round again (the D.S. / repeat jump), or once the section is
    // already complete — bar *numbers* are no guide here, because a repeat
    // jumps backwards.
    const startsPass =
      !last ||
      last.sectionIndex !== sectionIndex ||
      run.measures[0].index === measureIndex ||
      last.measures.length >= run.measures.length;
    if (startsPass) passes.push({ sectionIndex, measures: [measure] });
    else last.measures.push(measure);
  }

  const arrangement: ArrangementRepeat[] = [];
  for (const pass of passes) {
    const section = sections[pass.sectionIndex];
    const sectionMeasures = sectionRuns[pass.sectionIndex].measures;
    // A pass is "exact" only when it covers the section's own bars in order.
    // A 1st/2nd ending can be the same length but different bars, so length
    // alone is not enough to decide.
    const exact =
      pass.measures.length === sectionMeasures.length &&
      pass.measures.every((m, i) => m.index === sectionMeasures[i]?.index);
    const differs = !exact;
    const previous = arrangement[arrangement.length - 1];
    if (exact && previous && previous.sectionId === section.id && previous.overrides === undefined) {
      previous.repeats += 1;
      continue;
    }
    // Label a pass by the bars it actually covers inside its own section —
    // "B (bars 10–11)", not "B (bars 1–2)". A pass that isn't a prefix (the
    // second ending) says how much of the section it is instead.
    const isPrefix = pass.measures.every((m, i) => m.index === sectionMeasures[i]?.index);
    const from = sectionRuns[pass.sectionIndex].measures.findIndex((m) => m.index === pass.measures[0].index) + 1;
    const to = from + pass.measures.length - 1;
    arrangement.push({
      sectionId: section.id,
      repeats: 1,
      ...(differs
        ? {
            variation: isPrefix
              ? `${section.name} (bars ${from}–${to})`
              : `${section.name} (${pass.measures.length} of ${sectionMeasures.length} bars)`,
            overrides: { bars: pass.measures.length, chords: chordsFor(pass.measures) },
          }
        : {}),
    });
  }

  const now = new Date().toISOString();
  const song: BlueprintSong = {
    id: crypto.randomUUID(),
    title,
    ...(composer ? { artist: composer } : {}),
    key: key.key,
    scale: key.scale,
    bpm: tempo ?? 120,
    timeSignatureNumerator: firstTime.beats,
    timeSignatureDenominator: firstTime.beatType,
    sections,
    arrangement,
    beatOffset: 0,
    createdAt: now,
    updatedAt: now,
  };

  if (tempo === undefined) warnings.push("No tempo in the file — iReal Pro practices at a global tempo, so 120 BPM is a default, not an extraction");
  warnings.push("iReal Pro exports write rests instead of notes, so this chart has chords, sections and meter — no melody");
  if (key.scale === "aeolian") warnings.push(`Key read as ${key.key} minor (mode from the file)`);

  song.provenance = { source: "musicxml-import", extractedAt: now, warnings };
  return song;
}
