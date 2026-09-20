/**
 * Phonetics for lyrics — syllables, stress, rhyme keys, rhyme scheme and foot
 * shape, all computed from ARPAbet pronunciations (the CMU dictionary's
 * notation: vowels carry a stress digit, 0 none · 1 primary · 2 secondary).
 *
 * The pronunciation source is injected (`Pronouncer`), so the same code runs
 * on an offline dictionary or a network lookup. Words the source doesn't know
 * fall back to a vowel-group guess and are reported in `unknown`, so the UI
 * can show "?" instead of pretending.
 *
 * Output feeds `prosodyIssues` in melodyPhrases.ts (a line's `stress`).
 */
import type { Stress } from "./melodyPhrases";

/** word (lowercase, letters and apostrophes) → ARPAbet string, or null if unknown. */
export type Pronouncer = (word: string) => string | null;

export const fromRecord = (rec: Readonly<Record<string, string>>): Pronouncer => (w) => rec[w] ?? null;

export interface Phone { symbol: string; /** vowels only */ stress: Stress | null }

export function parsePhones(pron: string): Phone[] {
  return pron.trim().split(/\s+/).filter(Boolean).map((tok) => {
    const m = tok.match(/^([A-Z]+)([012])?$/);
    if (!m) return { symbol: tok, stress: null };
    return { symbol: m[1], stress: m[2] === undefined ? null : (Number(m[2]) as Stress) };
  });
}

export function normalizeWord(raw: string): string {
  return raw.toLowerCase().replace(/[^a-z']/g, "").replace(/^'+|'+$/g, "");
}

/** Vowel-group syllable guess for words with no pronunciation. */
export function guessSyllables(word: string): number {
  const w = word.toLowerCase().replace(/[^a-z]/g, "");
  if (!w) return 0;
  let groups = (w.match(/[aeiouy]+/g) ?? []).length;
  if (groups > 1 && /[^aeiou]e$/.test(w) && !/[^aeiou]le$/.test(w)) groups--;
  return Math.max(1, groups);
}

/** One-syllable words that lyrics almost always sing unstressed — articles,
 *  pronouns, auxiliaries, conjunctions and simple prepositions. Many carry
 *  dictionary stress 1 ("of" is AH1 V) but sit on weak beats in performance,
 *  so `analyzeLine` demotes them unless told not to. */
const FUNCTION_WORDS = new Set([
  // articles, pronouns, possessives
  "a", "an", "the", "it", "its", "my", "your", "his", "her", "our", "their",
  "me", "him", "them", "us", "we", "he", "she", "they", "be",
  // prepositions and conjunctions
  "of", "to", "in", "on", "at", "for", "with", "from", "by", "and", "but", "or", "nor", "as",
  "than", "that", "so", "if", "though", "till",
  // auxiliary and modal verbs
  "is", "was", "are", "were", "am", "do", "does", "did", "has", "have", "had",
  "can", "could", "would", "should", "may", "might", "will", "shall", "must",
]);

export interface WordInfo {
  word: string;
  phones: Phone[] | null;
  stress: Stress[];
  syllables: number;
  known: boolean;
}

export function analyzeWord(raw: string, pron: Pronouncer): WordInfo | null {
  const word = normalizeWord(raw);
  if (!word) return null;
  const p = pron(word);
  if (p) {
    const phones = parsePhones(p);
    const stress = phones.flatMap((ph) => (ph.stress === null ? [] : [ph.stress]));
    return { word, phones, stress, syllables: stress.length, known: true };
  }
  const syllables = guessSyllables(word);
  // trochaic guess: first syllable stressed
  return { word, phones: null, stress: Array.from({ length: syllables }, (_, i) => (i === 0 ? 1 : 0) as Stress), syllables, known: false };
}

export interface LineAnalysis {
  words: WordInfo[];
  stress: Stress[];
  syllables: number;
  /** Words that had no pronunciation (their stress is a guess). */
  unknown: string[];
  endWord: WordInfo | null;
}

export function analyzeLine(
  line: string, pron: Pronouncer, opts: { demoteFunctionWords?: boolean } = {},
): LineAnalysis {
  const demote = opts.demoteFunctionWords ?? true;
  const words = line.split(/[\s\u2014-]+/).map((w) => analyzeWord(w, pron)).filter((w): w is WordInfo => w !== null);
  const stress = words.flatMap((w) =>
    demote && w.syllables === 1 && FUNCTION_WORDS.has(w.word) ? [0 as Stress] : w.stress);
  return {
    words,
    stress,
    syllables: stress.length,
    unknown: words.filter((w) => !w.known).map((w) => w.word),
    endWord: words.length ? words[words.length - 1] : null,
  };
}

/** "x/x/" — x unstressed, / stressed (primary or secondary). */
export function stressMark(stress: readonly Stress[]): string {
  return stress.map((s) => (s === 0 ? "x" : "/")).join("");
}

// ---- rhyme ----------------------------------------------------------------

export interface RhymeKey {
  /** Stressed vowel through the end, stress digits dropped: "AY T". */
  key: string;
  vowel: string;
  /** Consonants after the last vowel. */
  tail: string;
  /** Unstressed syllable(s) after the stressed one (river/shiver). */
  feminine: boolean;
}

export type RhymeRelation = "identical" | "perfect" | "assonant" | "consonant" | "none";

/** Rhyme key from the LAST stressed vowel (else the last vowel) to the end. */
export function rhymeKey(phones: readonly Phone[]): RhymeKey | null {
  const vowelIdx = phones.flatMap((p, i) => (p.stress === null ? [] : [i]));
  if (vowelIdx.length === 0) return null;
  const stressed = vowelIdx.filter((i) => phones[i].stress === 1 || phones[i].stress === 2);
  const start = stressed.length ? stressed[stressed.length - 1] : vowelIdx[vowelIdx.length - 1];
  const rest = phones.slice(start);
  const lastVowel = vowelIdx[vowelIdx.length - 1];
  return {
    key: rest.map((p) => p.symbol).join(" "),
    vowel: phones[start].symbol,
    tail: phones.slice(lastVowel + 1).map((p) => p.symbol).join(" "),
    feminine: lastVowel > start,
  };
}

/** Sound relationship between two words; `none` when either has no pronunciation. */
export function rhymeRelation(a: WordInfo, b: WordInfo): RhymeRelation {
  if (a.word === b.word) return "identical";
  const ka = a.phones && rhymeKey(a.phones);
  const kb = b.phones && rhymeKey(b.phones);
  if (!ka || !kb) return "none";
  // homophones with different spellings (night/knight) also land here
  if (ka.key === kb.key) return "perfect";
  if (ka.feminine !== kb.feminine) return "none";
  if (ka.vowel === kb.vowel) return "assonant";
  if (ka.tail && ka.tail === kb.tail) return "consonant";
  return "none";
}

export interface SchemeEntry {
  line: number;
  /** "" for a blank line, "?" when the end word has no pronunciation. */
  letter: string;
  relation: RhymeRelation | "new" | "unknown" | "blank";
}

/**
 * Rhyme letters for a block of lines. A blank line starts a new stanza (letters
 * are shared across the whole block, rhymes are only sought within a stanza).
 * A perfect or identical match reuses its letter; failing that, a near rhyme
 * (assonant / consonant) reuses it too but says so in `relation`.
 */
export function rhymeScheme(lines: readonly string[], pron: Pronouncer): SchemeEntry[] {
  const out: SchemeEntry[] = [];
  let next = 0;
  let stanza: { letter: string; info: WordInfo }[] = [];
  lines.forEach((line, i) => {
    if (!line.trim()) { stanza = []; out.push({ line: i, letter: "", relation: "blank" }); return; }
    const end = analyzeLine(line, pron).endWord;
    if (!end || !end.known) { out.push({ line: i, letter: "?", relation: "unknown" }); return; }
    let best: { letter: string; relation: RhymeRelation } | null = null;
    for (const s of stanza) {
      const rel = rhymeRelation(s.info, end);
      if (rel === "identical" || rel === "perfect") { best = { letter: s.letter, relation: rel }; break; }
      if ((rel === "assonant" || rel === "consonant") && !best) best = { letter: s.letter, relation: rel };
    }
    if (best) { out.push({ line: i, ...best }); return; }
    const letter = String.fromCharCode(65 + (next++ % 26));
    stanza.push({ letter, info: end });
    out.push({ line: i, letter, relation: "new" });
  });
  return out;
}

/** "ABAB CDCD" — stanzas separated by a space. */
export function schemeString(entries: readonly SchemeEntry[]): string {
  return entries.map((e) => (e.relation === "blank" ? " " : e.letter)).join("").replace(/ +/g, " ").trim();
}

// ---- meter ----------------------------------------------------------------

export type Foot = "iamb" | "trochee" | "anapest" | "dactyl";
const FOOT_TEMPLATES: Record<Foot, readonly number[]> = {
  iamb: [0, 1], trochee: [1, 0], anapest: [0, 0, 1], dactyl: [1, 0, 0],
};

/**
 * Which repeating foot a line's stress skeleton is closest to, measured from
 * the first syllable. Lyrics are rarely strict, so this reports a fit (0..1)
 * and calls anything under 0.8 "mixed" instead of grading the writing.
 */
export function footFit(stress: readonly Stress[]): { foot: Foot | "mixed"; fit: number } {
  if (stress.length < 3) return { foot: "mixed", fit: 0 };
  const s = stress.map((v) => (v === 0 ? 0 : 1));
  let best: { foot: Foot; fit: number } | null = null;
  for (const [foot, t] of Object.entries(FOOT_TEMPLATES) as [Foot, readonly number[]][]) {
    const hits = s.filter((v, i) => v === t[i % t.length]).length;
    const fit = hits / s.length;
    if (!best || fit > best.fit) best = { foot, fit };
  }
  return best!.fit >= 0.8 ? best! : { foot: "mixed", fit: best!.fit };
}
