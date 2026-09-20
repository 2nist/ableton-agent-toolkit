/**
 * Section lyric brief — deterministic prompts and lyric-theory hints derived
 * from what TrackDraft already knows about a section: its role, bars, chord
 * cycle, meter, feel, swing, and (when present) the recorded melody's phrases.
 *
 * No generation: every output is a template filled from real fields and picked
 * with a seeded hash (same section + same reroll → same prompts), the same
 * determinism trick as the drum library's `occurrenceSeed`.
 *
 * Input mirrors a song-map `MapSlot` / `BlueprintSection` structurally, so it
 * works on a template before it is applied and on a live section after.
 */
import type { Phrase } from "./melodyPhrases";

export type SectionRole =
  | "intro" | "verse" | "pre_chorus" | "chorus" | "bridge" | "solo" | "breakdown" | "outro" | "custom";

/** Proposed `MapSlot.lyric` — lets a genre map say how vocals work in it. */
export interface SlotLyricHints {
  /** "none" = instrumental by design. */
  vocal?: "lead" | "none" | "spoken" | "chant";
  density?: "sparse" | "medium" | "dense";
  /** The narrative job, kept apart from the production-facing `purpose`. */
  job?: string;
}

export interface BriefInput {
  /** Seed — section id (or slot label) so re-opening gives the same prompts. */
  id: string;
  role: SectionRole;
  bars: number;
  /** Quarter-note beats per bar: 4 for 4/4, 3.5 for 7/8 (see `beatsPerBarFor`). */
  beatsPerBar: number;
  beatsPerChord?: number;
  /** Roman-numeral chord cycle, as in `MapSlot.progression`. */
  progression?: string[];
  /** The slot's `purpose`; a leading "FEEL:" sentence is lifted out of it. */
  purpose?: string;
  swing?: number;
  optional?: boolean;
  lyric?: SlotLyricHints;
  /** From `segmentPhrases` over the section's melody, when there is one. */
  phrases?: Phrase[];
  /** Rhyme scheme of the previous lyric section, e.g. "ABAB". */
  priorScheme?: string;
  /** Bump to get a different set of prompts. */
  reroll?: number;
}

export type CadenceKind = "static" | "home" | "open" | "lift";
export interface Cadence { kind: CadenceKind; last: string }

export interface PhraseStructure {
  cycleBars: number;
  cycles: number;
  /** True when the cycle divides the section evenly. */
  aligned: boolean;
  source: "harmony" | "assumed";
}

export interface BriefPrompt {
  kind: "job" | "structure" | "cadence" | "feel" | "density" | "melody" | "rhyme" | "constraint";
  text: string;
}

export interface LyricBrief {
  vocal: boolean;
  feel?: string;
  structure: PhraseStructure | null;
  cadence: Cadence | null;
  prompts: BriefPrompt[];
}

// ---- small helpers --------------------------------------------------------

/** FNV-1a — same hash the drum library uses for seeded picks. */
function hashSeed(seed: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function pick<T>(pool: readonly T[], input: BriefInput, salt: string): T {
  return pool[hashSeed(`${input.id}:${salt}:${input.reroll ?? 0}`) % pool.length];
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

/** 4/4 → 4, 7/8 → 3.5. `denPower` as in BlueprintSection (2 = /4, 3 = /8). */
export function beatsPerBarFor(numerator: number, denPower: number): number {
  return (numerator * 4) / 2 ** denPower;
}

/** "FEEL: Hypnotic, submerged in a warm haze. TRICK: …" → "Hypnotic, submerged in a warm haze" */
export function feelOf(purpose: string | undefined): string | undefined {
  const m = purpose?.match(/FEEL:\s*([^.]+)\./i);
  return m ? m[1].trim() : undefined;
}

const NUMERAL = /^(b|#)?(VII|VI|IV|V|III|II|I|vii|vi|iv|v|iii|ii|i)(.*)$/;

/** How the last chord of a looping cell sits against the tonic. */
export function cadenceOf(progression: readonly string[] | undefined): Cadence | null {
  if (!progression || progression.length === 0) return null;
  const last = progression[progression.length - 1];
  if (progression.length === 1) return { kind: "static", last };
  const m = last.match(NUMERAL);
  if (!m) return { kind: "lift", last };
  const [, accidental, degree] = m;
  const d = degree.toUpperCase();
  if (d === "I" && !accidental) return { kind: "home", last };
  if (d === "V" && !accidental) return { kind: "open", last };
  return { kind: "lift", last };
}

export function phraseStructure(input: BriefInput): PhraseStructure | null {
  if (input.bars <= 0 || input.beatsPerBar <= 0) return null;
  const chords = input.progression?.length ?? 0;
  if (chords > 0 && input.beatsPerChord && input.beatsPerChord > 0) {
    const cycleBars = round2((chords * input.beatsPerChord) / input.beatsPerBar);
    const cycles = round2(input.bars / cycleBars);
    return { cycleBars, cycles, aligned: Number.isInteger(cycles), source: "harmony" };
  }
  const cycles = round2(input.bars / 4);
  return { cycleBars: 4, cycles, aligned: Number.isInteger(cycles), source: "assumed" };
}

/** Roles that usually carry no lead vocal, until a map says otherwise. */
function isVocal(input: BriefInput): boolean {
  if (input.lyric?.vocal) return input.lyric.vocal !== "none";
  if (input.role === "solo") return false;
  if (input.role === "breakdown" && input.optional) return false;
  return true;
}

const ROLE_JOB: Record<SectionRole, string> = {
  intro: "Set the world before the story: a place, an image, a texture — no explanations yet.",
  verse: "Earn the chorus: specific people, places and objects, plus one small tension left open.",
  pre_chorus: "Raise the question the chorus answers, and let the lines tighten as they go.",
  chorus: "State the central idea in words a listener can repeat after one hearing.",
  bridge: "Change something: the point of view, the tense, or the truth being admitted.",
  solo: "Usually no lyric. If a voice enters, keep it to a fragment.",
  breakdown: "Strip back: a single repeated line or image can carry the section.",
  outro: "Let the idea settle: echo an earlier line, changed by everything since.",
  custom: "Decide this section's one job in a sentence, then write only what serves it.",
};

const CONSTRAINTS_ANY = [
  "Write it with no adjectives, then add back only the ones you miss.",
  "End every line on a one-syllable word.",
  "Name one physical object in the room where this happens.",
  "Use no word longer than two syllables.",
  "Write the line the narrator is afraid to say, then say it indirectly.",
  "Change the tense between the first line and the last.",
] as const;

const CONSTRAINTS_BY_ROLE: Partial<Record<SectionRole, readonly string[]>> = {
  verse: ["Give every line a noun you could photograph.", "Let the second half of the section contradict the first."],
  chorus: ["Say it in fewer words than the longest verse line.", "Put the title where the melody is longest."],
  bridge: ["Write it from the other person's point of view.", "Say the thing the chorus can't."],
  outro: ["Repeat the first line of the song with one word changed."],
};

const SCHEMES_4 = ["ABAB (forward motion)", "AABB (closed, sing-song)", "ABCB (loose; the unrhymed lines leave space)"] as const;

// ---- the brief ------------------------------------------------------------

export function buildBrief(input: BriefInput): LyricBrief {
  const vocal = isVocal(input);
  const feel = feelOf(input.purpose);
  const structure = phraseStructure(input);
  const cadence = cadenceOf(input.progression);

  if (!vocal) {
    return {
      vocal, feel, structure, cadence,
      prompts: [{
        kind: "job",
        text: "Instrumental by design. If a voice does enter, treat it as an instrument: one repeated syllable or fragment usually beats a verse.",
      }],
    };
  }

  const prompts: BriefPrompt[] = [{ kind: "job", text: input.lyric?.job ?? ROLE_JOB[input.role] }];

  if (structure) {
    if (structure.source === "assumed") {
      prompts.push({ kind: "structure", text: `No chord cycle is set, so I'm assuming 4-bar phrases: ${input.bars} bars gives about ${structure.cycles} lines or line-pairs.` });
    } else if (!structure.aligned) {
      prompts.push({ kind: "structure", text: `The ${structure.cycleBars}-bar chord cycle doesn't divide ${input.bars} bars evenly, so phrases will straddle the barlines. Treat the melody, not the bar, as your unit for a line.` });
    } else if (structure.cycles >= 2) {
      prompts.push({ kind: "structure", text: `${input.bars} bars is ${structure.cycles} passes of a ${structure.cycleBars}-bar chord cycle. Each pass is a natural phrase: aim for ${structure.cycles} lines, or ${structure.cycles * 2} shorter ones.` });
    }
  }

  if (cadence) {
    const text: Record<CadenceKind, string> = {
      static: "One chord all the way through, so the momentum has to come from the words. Vary the phrase length, or change a single word across repeats.",
      home: "Each pass ends on the tonic, so a phrase can land a complete thought. A good place for closed statements and full rhymes.",
      open: "Each pass ends on the dominant, unresolved and pulling back to the top. End lines on a question or half-finished thought and let the next line answer.",
      lift: `Each pass ends away from home (${cadence.last}): a lift, not a landing. Lines that open outward, like an invitation or a "what if", sit well; save the closed statement for a tonic arrival.`,
    };
    prompts.push({ kind: "cadence", text: text[cadence.kind] });
  }

  if (feel) {
    prompts.push({ kind: "feel", text: `The production is aiming for "${feel}". Which concrete details (light, temperature, sound) belong to that feeling? Write those instead of naming it.` });
  }

  const density = input.lyric?.density;
  if (density === "sparse") {
    prompts.push({ kind: "density", text: "Sparse section: use fewer words than you think you need. One image per phrase, and let the arrangement carry the rest." });
  } else if (density === "dense") {
    prompts.push({ kind: "density", text: "Dense delivery: internal rhyme and stress-timed lines will hold it together. Keep the consonants crisp so the words survive the groove." });
  } else if ((input.swing ?? 0) >= 50) {
    prompts.push({ kind: "density", text: "Swung feel: three-syllable runs will tend to sit naturally in it, and straight-eighth lines can read as stiff unless you want that." });
  }

  const phrases = input.phrases ?? [];
  if (phrases.length > 0) {
    const counts = phrases.map((p) => p.notes.length);
    prompts.push({ kind: "melody", text: `The melody has ${phrases.length} phrase${phrases.length === 1 ? "" : "s"} of ${counts.join(", ")} notes. That's your syllable budget per line: fewer syllables than notes means a held or melismatic note, more means squeezing words in.` });
    const held = phrases.find((p) => p.finalHoldBeats >= 1.5);
    const peak = pick(phrases, input, "peak");
    if (held) {
      prompts.push({ kind: "melody", text: `Phrase ${held.index + 1} ends on a held note (${round2(held.finalHoldBeats)} beats). A long-vowel word suits it, and it is your natural rhyme site.` });
    } else {
      prompts.push({ kind: "melody", text: `The highest note of phrase ${peak.index + 1} is note ${peak.peakIndex + 1}. The word you most want heard could sit there.` });
    }
  }

  const sites = phrases.length || (structure?.aligned ? structure.cycles : 0);
  if (input.priorScheme && sites >= 2) {
    prompts.push({ kind: "rhyme", text: `The previous section rhymed ${input.priorScheme}. Try a different scheme here for contrast: ${sites} phrase-ends give you ${sites} rhyme sites to place.` });
  } else if (sites >= 4) {
    prompts.push({ kind: "rhyme", text: `${sites} phrase-ends give you ${sites} rhyme sites. One scheme to try: ${pick(SCHEMES_4, input, "scheme")}.` });
  }

  const pool = [...(CONSTRAINTS_BY_ROLE[input.role] ?? []), ...CONSTRAINTS_ANY];
  prompts.push({ kind: "constraint", text: pick(pool, input, "constraint") });

  return { vocal, feel, structure, cadence, prompts };
}
