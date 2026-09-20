/**
 * Melody → lyric slots. Pure functions over the Melody tab's notes
 * (`MelodyNote`: section-relative beats), so the Lyrics tab can bind words
 * to a hummed line instead of to bar counts.
 *
 *   segmentPhrases   rests split the line into phrases (= natural lyric lines)
 *   metricWeight     how strong a beat position is (downbeat > group starts >
 *                    beats > offbeats), meter-aware — 7/8 as 2+2+3 works
 *   syllableSlots    one slot per note, with weight / held / peak flags
 *   prosodyIssues    stressed syllables on weak slots, weak syllables held
 *                    on strong ones, and the syllable/note count delta
 *
 * Stress patterns come from a pronunciation source (Datamuse `md=r` or a
 * local CMU dictionary); this module only consumes them.
 */

export interface MelodyNoteLike { pitch: number; startTime: number; duration: number }

export interface Phrase {
  index: number;
  startBeat: number;
  endBeat: number;
  notes: MelodyNoteLike[];
  /** Length of the phrase's last note — a long one is a rhyme site. */
  finalHoldBeats: number;
  /** Index (within `notes`) of the highest pitch; first wins ties. */
  peakIndex: number;
}

/** Rests of at least `minRestBeats` split phrases (default: one beat). */
export function segmentPhrases(
  notes: readonly MelodyNoteLike[], opts: { minRestBeats?: number } = {},
): Phrase[] {
  const minRest = opts.minRestBeats ?? 1;
  const sorted = [...notes].sort((a, b) => a.startTime - b.startTime);
  const groups: MelodyNoteLike[][] = [];
  let end = -Infinity;
  for (const n of sorted) {
    if (groups.length === 0 || n.startTime - end >= minRest - 1e-9) groups.push([]);
    groups[groups.length - 1].push(n);
    end = Math.max(end, n.startTime + n.duration);
  }
  return groups.map((g, index) => {
    const last = g[g.length - 1];
    let peakIndex = 0;
    g.forEach((n, i) => { if (n.pitch > g[peakIndex].pitch) peakIndex = i; });
    return {
      index,
      startBeat: g[0].startTime,
      endBeat: Math.max(...g.map((n) => n.startTime + n.duration)),
      notes: g,
      finalHoldBeats: last.duration,
      peakIndex,
    };
  });
}

export interface MeterInfo {
  /** Quarter-note beats per bar (4 for 4/4, 3.5 for 7/8). */
  beatsPerBar: number;
  /** Where the meter's groups start inside the bar, in beats. Default: 0 and
   *  mid-bar for even meters, just 0 otherwise. */
  groupStarts?: number[];
}

/** Group starts for a 2s/3s outline: cells [2,2,3] at 0.5 beats → [0,1,2]. */
export function groupStartsFromOutline(cells: readonly number[], cellBeats: number): number[] {
  const out: number[] = [];
  let pos = 0;
  for (const c of cells) { out.push(pos); pos += c * cellBeats; }
  return out;
}

const near = (a: number, b: number): boolean => Math.abs(a - b) < 1e-3;

/** Position strength 0..1: bar start 1 · group start .7 · beat .5 · eighth .3 · else .15 */
export function metricWeight(beat: number, meter: MeterInfo): number {
  const bpb = meter.beatsPerBar;
  const pos = ((beat % bpb) + bpb) % bpb;
  if (near(pos, 0) || near(pos, bpb)) return 1;
  const groups = meter.groupStarts
    ?? (Number.isInteger(bpb) && bpb % 2 === 0 && bpb >= 4 ? [0, bpb / 2] : [0]);
  if (groups.some((g) => near(pos, g))) return 0.7;
  if (near(pos, Math.round(pos))) return 0.5;
  if (near(pos * 2, Math.round(pos * 2))) return 0.3;
  return 0.15;
}

export interface SyllableSlot {
  noteIndex: number;
  startBeat: number;
  durationBeats: number;
  weight: number;
  /** Where a stressed syllable belongs: strong position or a held note. */
  strong: boolean;
  isPeak: boolean;
  isFinal: boolean;
}

export function syllableSlots(phrase: Phrase, meter: MeterInfo): SyllableSlot[] {
  return phrase.notes.map((n, i) => {
    const weight = metricWeight(n.startTime, meter);
    return {
      noteIndex: i,
      startBeat: n.startTime,
      durationBeats: n.duration,
      weight,
      strong: weight >= 0.7 || n.duration >= 1,
      isPeak: i === phrase.peakIndex,
      isFinal: i === phrase.notes.length - 1,
    };
  });
}

/** 0 = unstressed, 1 = primary, 2 = secondary (CMU convention). */
export type Stress = 0 | 1 | 2;

export interface ProsodyIssue {
  /** Slot (= syllable) position, 0-based. */
  slot: number;
  kind: "stressed-on-weak" | "unstressed-held-on-strong";
}

export interface ProsodyReport {
  /** syllables − slots: >0 crowds words onto notes, <0 leaves notes to melisma. */
  countDelta: number;
  issues: ProsodyIssue[];
}

export function prosodyIssues(stress: readonly Stress[], slots: readonly SyllableSlot[]): ProsodyReport {
  const issues: ProsodyIssue[] = [];
  const m = Math.min(stress.length, slots.length);
  for (let i = 0; i < m; i++) {
    const s = slots[i];
    if (stress[i] === 1 && !s.strong && s.weight < 0.5) issues.push({ slot: i, kind: "stressed-on-weak" });
    if (stress[i] === 0 && s.strong && s.durationBeats >= 1) issues.push({ slot: i, kind: "unstressed-held-on-strong" });
  }
  return { countDelta: stress.length - slots.length, issues };
}






——
bash
cd /home/claude/app/src/lib/lyrics && cat > seed.ts <<'EOF'
/**
 * Seeded picking shared by the lyric tools. Same seed → same result, so a
 * section shows the same prompts every time it's opened, and "roll N" is just
 * an integer you can store instead of the prompt itself.
 */

/** FNV-1a — the hash the drum library uses for its seeded picks. */
export function hashSeed(seed: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Deterministic Fisher–Yates shuffle keyed by `seed`. */
export function shuffled<T>(pool: readonly T[], seed: string): T[] {
  const out = [...pool];
  const rnd = mulberry32(hashSeed(seed));
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * The n-th card of a seeded shuffle: consecutive rolls never repeat until the
 * whole pool has been dealt (then the same order starts over).
 */
export function deal<T>(pool: readonly T[], seed: string, n: number): T {
  const deck = shuffled(pool, seed);
  return deck[((n % deck.length) + deck.length) % deck.length];
}
EOF
cat > sparkBank.ts <<'EOF'
/**
 * Seed material for the Spark generator, split into the five dimensions of the
 * original prompt list (subject · perspective · rule · challenge, with the
 * musical anchor now coming from lyricBrief.ts's real harmony/melody data).
 *
 * Entries carry tags so random combinations can't contradict each other or
 * land in the wrong place:
 *   pronouns   which pronoun families a perspective speaks in
 *   forbids    which pronoun families a rule makes impossible
 *   roles      section roles a rule only makes sense for
 *   scope      "section" prompts fit one section; "song" prompts need the whole song
 *   fixesPov / overridesPerspective   the entry already chooses a point of view
 */
import type { SectionRole } from "./lyricBrief";

export type Pronoun = "I" | "you" | "third";

export interface SubjectEntry { text: string; fixesPov?: boolean }
export interface PerspectiveEntry { text: string; pronouns: Pronoun[] }
export interface RuleEntry {
  text: string;
  roles?: SectionRole[];
  scope: "section" | "song";
  forbids?: Pronoun[];
  overridesPerspective?: boolean;
}
export interface ChallengeEntry { text: string; scope: "section" | "song" }

export const SUBJECTS: readonly SubjectEntry[] = [
  { text: "breaking up suddenly after discovering a secret" },
  { text: "a complicated, non-traditional form of love" },
  { text: "the daily commute under an absolute dictatorship" },
  { text: "a carpenter living on an isolated 500-person island" },
  { text: "drinking alcohol at dawn and coffee at night" },
  { text: "a dog lost in a city trying to find its way home" },
  { text: "the last surviving human on Earth looking at extinct tech" },
  { text: "a sweet potato that bears an uncanny resemblance to a celebrity" },
  { text: "living with an AI or robot partner in the year 2050" },
  { text: "an astronaut adrift after snapping their tether" },
  { text: "forgiving a childhood bully years after the fact" },
  { text: "a society that traded money for direct barter" },
  { text: "running a 200-mile ultra-marathon to escape grief" },
  { text: "a young idealist entering high-stakes political corruption" },
  { text: "the feeling of living for 500 years while everyone else ages" },
  { text: "a psychedelic awakening during an ordinary household chore" },
  { text: "buying a one-way ticket to a country where you don't speak the language" },
  { text: "the tension between material wealth and a single irreplaceable memory" },
  { text: "an argument from the exact perspective of the person you fought with", fixesPov: true },
  { text: "the life and death of a medieval mystic" },
];

export const PERSPECTIVES: readonly PerspectiveEntry[] = [
  { text: "First-person ('I') with intense emotional vulnerability", pronouns: ["I"] },
  { text: "Second-person ('You') addressed directly to an enemy", pronouns: ["you"] },
  { text: "Second-person ('You') to an imaginary or future lover", pronouns: ["you"] },
  { text: "Third-person observer watching a stranger in a crowd", pronouns: ["third"] },
  { text: "An innocent non-human entity (without revealing its nature)", pronouns: [] },
  { text: "A parent addressing their child 20 years in the future", pronouns: ["I", "you"] },
  { text: "A citizen speaking under heavy surveillance", pronouns: [] },
  { text: "An exhausted artisan whose craft is their entire identity", pronouns: [] },
];

export const RULES: readonly RuleEntry[] = [
  // from the original list
  { text: "Never use the word 'love' or 'you'", scope: "section", forbids: ["you"] },
  { text: "Never use the letter 'm' anywhere in the lyrics", scope: "section" },
  { text: "Write using strictly single-syllable words", scope: "section" },
  { text: "Each line must start with consecutive letters of the alphabet (A-Z)", scope: "song" },
  { text: "Limit the entire vocabulary to only 12 unique words", scope: "section" },
  { text: "Construct the chorus hook as a single direct question", scope: "section", roles: ["chorus"] },
  { text: "Describe your favorite food or object without ever naming it", scope: "section" },
  { text: "Write without using any pronouns (no I, you, he, she, they)", scope: "section", forbids: ["I", "you", "third"] },
  { text: "Use the cut-up method: randomize words from a non-fiction book", scope: "section" },
  { text: "Frame every phrase as a Public Service Announcement", scope: "section" },
  // craft constraints
  { text: "Write it with no adjectives, then add back only the ones you miss.", scope: "section" },
  { text: "End every line on a one-syllable word.", scope: "section" },
  { text: "Name one physical object in the room where this happens.", scope: "section" },
  { text: "Write the line the narrator is afraid to say, then say it indirectly.", scope: "section" },
  { text: "Change the tense between the first line and the last.", scope: "section" },
  { text: "Give every line a noun you could photograph.", scope: "section", roles: ["verse", "pre_chorus"] },
  { text: "Let the second half of the section contradict the first.", scope: "section", roles: ["verse", "bridge"] },
  { text: "Say it in fewer words than the longest verse line.", scope: "section", roles: ["chorus"] },
  { text: "Put the title where the melody is longest.", scope: "section", roles: ["chorus"] },
  { text: "Write it from the other person's point of view.", scope: "section", roles: ["bridge"], overridesPerspective: true },
  { text: "Say the thing the chorus can't.", scope: "section", roles: ["bridge"] },
  { text: "Repeat the first line of the song with one word changed.", scope: "section", roles: ["outro"] },
];

export const CHALLENGES: readonly ChallengeEntry[] = [
  { text: "10-Minute Blitz: Write 2 verses and a chorus before the timer rings.", scope: "song" },
  { text: "Wake-Up Draft: Write this within 20 minutes of waking up.", scope: "section" },
  { text: "1-Hour Finish: Complete the full draft and record a vocal scratch within 60 minutes.", scope: "song" },
  { text: "Breath Ritual: Focus on 5-second breath cycles for 5 minutes before writing.", scope: "section" },
  { text: "The Performance Test: The prompt must make you laugh or cry out loud when performed.", scope: "section" },
];
EOF
cat > spark.ts <<'EOF'
/**
 * Spark — a creative nudge composed from the tagged bank in sparkBank.ts:
 * subject, point of view, a rule, and a process challenge. Complements the
 * brief (which is derived from the section's own data) with the "what to write
 * about / how to make it interesting" side.
 *
 * Deterministic: every pick is a seeded shuffle indexed by a roll counter, so
 * consecutive rolls never repeat until a pool is exhausted, and reopening a
 * section shows the same spark. Tags guarantee no contradictory combinations.
 *
 * The subject is song-level and sticky: it is keyed by the song, not the
 * section, so verse and chorus sparks stay about the same thing. If the song
 * already has lyrical content written down, that is used instead of a random
 * subject.
 */
import type { SectionRole } from "./lyricBrief";
import { deal } from "./seed";
import {
  CHALLENGES, PERSPECTIVES, RULES, SUBJECTS, type PerspectiveEntry, type RuleEntry,
} from "./sparkBank";

export interface SparkInput {
  songId: string;
  sectionId: string;
  role: SectionRole;
  /** Bumps rule / point of view / challenge. */
  roll?: number;
  /** Bumps the song-level subject. */
  subjectRoll?: number;
  /** The song's own lyrical subject, if it has one — used instead of a random one. */
  existingSubject?: string;
  /** "song" also allows whole-song rules and challenges. Default "section". */
  level?: "section" | "song";
}

export interface Spark {
  id: string;
  subject: { text: string; own: boolean };
  /** Absent when the subject or rule already fixes the point of view. */
  perspective?: string;
  rule: string;
  challenge: string;
}

function clash(rule: RuleEntry, p: PerspectiveEntry): boolean {
  return (rule.forbids ?? []).some((f) => p.pronouns.includes(f));
}

export function composeSpark(input: SparkInput): Spark {
  const level = input.level ?? "section";
  const roll = input.roll ?? 0;
  const subjectRoll = input.subjectRoll ?? 0;

  const own = input.existingSubject?.trim();
  const subjectEntry = own ? null : deal(SUBJECTS, `${input.songId}:subject`, subjectRoll);

  const rules = RULES.filter((r) => (level === "song" || r.scope === "section") && (!r.roles || r.roles.includes(input.role)));
  const rule = deal(rules, `${input.sectionId}:rule`, roll);

  let perspective: string | undefined;
  if (!subjectEntry?.fixesPov && !rule.overridesPerspective) {
    const compatible = PERSPECTIVES.filter((p) => !clash(rule, p));
    perspective = deal(compatible, `${input.sectionId}:pov`, roll).text;
  }

  const challenges = CHALLENGES.filter((c) => level === "song" || c.scope === "section");
  const challenge = deal(challenges, `${input.sectionId}:challenge`, roll).text;

  return {
    id: `${input.sectionId}:${subjectRoll}:${roll}`,
    subject: own ? { text: own, own: true } : { text: subjectEntry!.text, own: false },
    perspective,
    rule: rule.text,
    challenge,
  };
}
EOF
cat > spark.test.ts <<'EOF'
import { describe, expect, it } from "vitest";
import { composeSpark, type SparkInput } from "./spark";
import { deal, shuffled } from "./seed";
import { CHALLENGES, PERSPECTIVES, RULES, SUBJECTS } from "./sparkBank";
import type { SectionRole } from "./lyricBrief";

const base: SparkInput = { songId: "song-1", sectionId: "verse-1", role: "verse" };
const ROLES: SectionRole[] = ["intro", "verse", "pre_chorus", "chorus", "bridge", "solo", "breakdown", "outro", "custom"];

describe("seeded shuffle", () => {
  it("is a permutation and is stable for a seed", () => {
    const pool = Array.from({ length: 12 }, (_, i) => i);
    const a = shuffled(pool, "x");
    expect([...a].sort((p, q) => p - q)).toEqual(pool);
    expect(shuffled(pool, "x")).toEqual(a);
    expect(shuffled(pool, "y")).not.toEqual(a);
  });

  it("deals without repeats until the pool is exhausted, then cycles", () => {
    const pool = ["a", "b", "c", "d"];
    const dealt = [0, 1, 2, 3].map((n) => deal(pool, "s", n));
    expect(new Set(dealt).size).toBe(4);
    expect(deal(pool, "s", 4)).toBe(dealt[0]);
    expect(deal(pool, "s", -1)).toBe(dealt[3]);
  });
});

describe("composeSpark", () => {
  it("is deterministic per input", () => {
    expect(composeSpark(base)).toEqual(composeSpark(base));
    expect(composeSpark({ ...base, roll: 3 })).toEqual(composeSpark({ ...base, roll: 3 }));
  });

  it("never repeats a rule on consecutive rolls (within one deck)", () => {
    const eligible = RULES.filter((r) => r.scope === "section" && (!r.roles || r.roles.includes("verse"))).length;
    const rules = Array.from({ length: eligible }, (_, i) => composeSpark({ ...base, roll: i }).rule);
    expect(new Set(rules).size).toBe(eligible);
  });

  it("never pairs a rule with a perspective it makes impossible", () => {
    for (const role of ROLES) {
      for (let roll = 0; roll < 60; roll++) {
        const s = composeSpark({ ...base, role, roll });
        const rule = RULES.find((r) => r.text === s.rule)!;
        const persp = PERSPECTIVES.find((p) => p.text === s.perspective);
        if (persp) expect(persp.pronouns.some((p) => (rule.forbids ?? []).includes(p))).toBe(false);
      }
    }
  });

  it("drops the perspective when a rule or the subject already fixes it", () => {
    let sawOverride = false;
    for (let roll = 0; roll < 40; roll++) {
      const s = composeSpark({ ...base, role: "bridge", sectionId: "b", roll });
      if (s.rule === "Write it from the other person's point of view.") {
        sawOverride = true;
        expect(s.perspective).toBe(undefined);
      }
    }
    expect(sawOverride).toBe(true);
    const fixed = SUBJECTS.findIndex((x) => x.fixesPov);
    let sawFixed = false;
    for (let n = 0; n < SUBJECTS.length; n++) {
      const s = composeSpark({ ...base, subjectRoll: n });
      if (s.subject.text === SUBJECTS[fixed].text) { sawFixed = true; expect(s.perspective).toBe(undefined); }
    }
    expect(sawFixed).toBe(true);
  });

  it("keeps rules in their roles and song-sized challenges out of a section", () => {
    const chorusOnly = RULES.filter((r) => r.roles?.length === 1 && r.roles[0] === "chorus").map((r) => r.text);
    const songScope = [...RULES, ...CHALLENGES].filter((x) => x.scope === "song").map((x) => x.text);
    for (let roll = 0; roll < 60; roll++) {
      const v = composeSpark({ ...base, role: "verse", roll });
      expect(chorusOnly.includes(v.rule)).toBe(false);
      expect(songScope.includes(v.rule)).toBe(false);
      expect(songScope.includes(v.challenge)).toBe(false);
    }
    const seen = new Set(Array.from({ length: 30 }, (_, roll) => composeSpark({ ...base, role: "chorus", roll }).rule));
    expect(chorusOnly.every((t) => seen.has(t))).toBe(true);
  });

  it("allows whole-song rules and challenges at song level", () => {
    const seen = new Set<string>();
    for (let roll = 0; roll < 40; roll++) seen.add(composeSpark({ ...base, level: "song", roll }).challenge);
    expect(seen.has(CHALLENGES.find((c) => c.text.startsWith("10-Minute"))!.text)).toBe(true);
  });

  it("keeps the subject at song level: same across sections, changed only by subjectRoll", () => {
    const a = composeSpark({ ...base, sectionId: "verse-1", roll: 0 }).subject;
    const b = composeSpark({ ...base, sectionId: "chorus-1", role: "chorus", roll: 7 }).subject;
    expect(a).toEqual(b);
    expect(composeSpark({ ...base, subjectRoll: 1 }).subject.text === a.text).toBe(false);
    expect(composeSpark({ ...base, songId: "song-2" }).subject.text === a.text).toBe(false);
  });

  it("uses the song's own lyrical subject instead of a random one", () => {
    const s = composeSpark({ ...base, existingSubject: "  a lighthouse keeper's last winter " });
    expect(s.subject).toEqual({ text: "a lighthouse keeper's last winter", own: true });
  });
});
EOF
cd /home/claude/app && tsc -p . 2>&1 | head; tsx --test src/lib/lyrics/spark.test.ts 2>&1 | grep -E "^# (tests|pass|fail)|^\s*not ok"
Output
    not ok 1 - is a permutation and is stable for a seed
not ok 1 - seeded shuffle
# tests 10
# pass 9
# fail 1



——
bash
cd /home/claude/app/src/lib/lyrics && python3 - <<'EOF'
import re
p='lyricBrief.ts'
s=open(p).read()

s=s.replace('import type { Phrase } from "./melodyPhrases";','import type { Phrase } from "./melodyPhrases";\nimport { deal } from "./seed";')

# drop local hash/pick
start=s.index('/** FNV-1a — same hash the drum library uses for seeded picks. */')
end=s.index('const round2')
s=s[:start]+s[end:]

# input fields
s=s.replace('''  /** Rhyme scheme of the previous lyric section, e.g. "ABAB". */
  priorScheme?: string;''','''  /** Rhyme scheme of the previous lyric section, e.g. "ABAB". */
  priorScheme?: string;
  /** Section energy 1–10 (see `energyOfVelocity`) and the previous section's. */
  energy?: number;
  prevEnergy?: number;''')

s=s.replace('kind: "job" | "structure" | "cadence" | "feel" | "density" | "melody" | "rhyme" | "constraint";','kind: "job" | "structure" | "cadence" | "feel" | "density" | "energy" | "melody" | "rhyme";')

# energy helper after beatsPerBarFor
s=s.replace('''/** "FEEL: Hypnotic''','''const VELOCITY_ORDER = ["ppp", "pp", "p", "mp", "mf", "f", "ff", "fff"] as const;

/** Velocity preset → energy 1..10 (evenly spread across the eight presets). */
export function energyOfVelocity(preset: string): number | undefined {
  const i = (VELOCITY_ORDER as readonly string[]).indexOf(preset);
  return i < 0 ? undefined : Math.round(1 + (i * 9) / (VELOCITY_ORDER.length - 1));
}

/** "FEEL: Hypnotic''',1)

# remove constraint pools
a=s.index('const CONSTRAINTS_ANY')
b=s.index('const SCHEMES_4')
s=s[:a]+s[b:]

# energy prompt after density block (before phrases const)
s=s.replace('''  const phrases = input.phrases ?? [];
  if (phrases.length > 0) {''','''  const { energy, prevEnergy } = input;
  if (energy !== undefined) {
    if (prevEnergy !== undefined && energy - prevEnergy >= 2) {
      prompts.push({ kind: "energy", text: `Energy steps up here (${prevEnergy} to ${energy} out of 10). Let the lines tighten: fewer words per line, more concrete verbs.` });
    } else if (prevEnergy !== undefined && prevEnergy - energy >= 2) {
      prompts.push({ kind: "energy", text: `Energy steps down here (${prevEnergy} to ${energy} out of 10). Let the lines lengthen and breathe; a quieter moment can afford a longer thought.` });
    } else if (prevEnergy === undefined && energy >= 8) {
      prompts.push({ kind: "energy", text: `A peak-energy section (${energy}/10). Give it words a crowd could shout back: short, open vowels, one idea.` });
    } else if (prevEnergy === undefined && energy <= 3) {
      prompts.push({ kind: "energy", text: `A low-energy section (${energy}/10). Near-spoken delivery works, and you can afford detail.` });
    }
  }

  const phrases = input.phrases ?? [];
  if (phrases.length > 0) {''')

s=s.replace('const peak = pick(phrases, input, "peak");','const peak = deal(phrases, `${input.id}:peak`, input.reroll ?? 0);')
s=s.replace('${pick(SCHEMES_4, input, "scheme")}','${deal(SCHEMES_4, `${input.id}:scheme`, input.reroll ?? 0)}')

# remove final constraint push
s=s.replace('''  const pool = [...(CONSTRAINTS_BY_ROLE[input.role] ?? []), ...CONSTRAINTS_ANY];
  prompts.push({ kind: "constraint", text: pick(pool, input, "constraint") });

''','')
open(p,'w').write(s)

# --- tests
p='lyricBrief.test.ts'
s=open(p).read()
s=s.replace('import { beatsPerBarFor, buildBrief, cadenceOf, feelOf, phraseStructure, type BriefInput } from "./lyricBrief";','import { beatsPerBarFor, buildBrief, cadenceOf, energyOfVelocity, feelOf, phraseStructure, type BriefInput } from "./lyricBrief";')
s=s.replace('["job", "structure", "cadence", "feel", "rhyme", "constraint"]','["job", "structure", "cadence", "feel", "rhyme"]')
# reroll test → rhyme scheme variety
old=s[s.index('  it("is deterministic per id + reroll'):]
new='''  it("is deterministic per id + reroll, and rerolling walks through different scheme suggestions", () => {
    const again = buildBrief(psychVerse).prompts.map((p) => p.text);
    expect(buildBrief(psychVerse).prompts.map((p) => p.text)).toEqual(again);
    const schemes = [0, 1, 2].map((r) => buildBrief({ ...psychVerse, reroll: r }).prompts.find((p) => p.kind === "rhyme")!.text);
    // a shuffled deck: three consecutive rerolls show three different schemes
    expect(new Set(schemes).size).toBe(3);
  });

  it("no longer carries generic writing rules (those live in Spark)", () => {
    expect(buildBrief(psychVerse).prompts.some((p) => (p.kind as string) === "constraint")).toBe(false);
  });

  it("comments on energy changes and peaks, using real velocity presets", () => {
    expect(energyOfVelocity("ppp")).toBe(1);
    expect(energyOfVelocity("mf")).toBe(6);
    expect(energyOfVelocity("fff")).toBe(10);
    expect(energyOfVelocity("loud")).toBe(undefined);
    const up = buildBrief({ ...psychChorus, energy: 8, prevEnergy: 5 }).prompts.find((p) => p.kind === "energy")!;
    expect(up.text).toContain("steps up (5 to 8".replace("steps up (", "steps up here (").replace("(5 to 8", "(5 to 8"));
    expect(buildBrief({ ...psychChorus, energy: 4, prevEnergy: 8 }).prompts.find((p) => p.kind === "energy")!.text).toContain("steps down");
    expect(buildBrief({ ...psychChorus, energy: 9 }).prompts.find((p) => p.kind === "energy")!.text).toContain("peak-energy");
    expect(buildBrief({ ...psychChorus, energy: 6, prevEnergy: 5 }).prompts.some((p) => p.kind === "energy")).toBe(false);
  });
});
'''
s=s.replace(old,new)
open(p,'w').write(s)
EOF
cd /home/claude/app && tsc -p . && tsx --test src/lib/lyrics/*.test.ts 2>&1 | grep -E "^# (tests|pass|fail)|^\s*not ok"
Output
src/components/lyrics/LyricsBriefPanel.tsx(13,58): error TS2353: Object literal may only specify known properties, and 'constraint' does not exist in type 'Record<"job" | "structure" | "cadence" | "feel" | "density" | "energy" | "melody" | "rhyme", string>'.




——

