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
