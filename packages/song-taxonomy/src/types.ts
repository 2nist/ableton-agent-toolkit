/**
 * The narrative-form vocabulary is closed to exactly the roles that
 * survive skeleton reduction (see skeleton.ts) plus the framing roles
 * every song has some of. Unlike `SectionRole` in @music-theory/song-structure,
 * this list is not meant to grow — narrative *forms* (the id/signature
 * combinations below) are the open, evolving vocabulary; the small set of
 * role primitives they're built from is not.
 */
export type CanonicalRole =
  | "verse"
  | "chorus"
  | "pre_chorus"
  | "bridge"
  | "solo"
  | "intro"
  | "outro"
  | "link"
  | "other";

/** Roles that carry the narrative arc; everything else is framing and is
 *  dropped when reducing a song to its skeleton (see skeleton.ts). */
export const LOAD_BEARING: readonly CanonicalRole[] = ["verse", "chorus", "pre_chorus", "bridge", "solo"];

/** One token of a song's section sequence, before or after normalization. */
export interface SectionToken {
  /** Already-normalized when produced by an adapter; kept as the raw label too, for evidence/debugging. */
  role: CanonicalRole;
  rawLabel: string;
  /** Milliseconds, when the source has real timing (McGill/Rock Corpus). Undefined for hand-authored BlueprintSong sections. */
  startMs?: number;
  durationMs?: number;
  /** Sung lyric line count landing inside this section's time window, when lyric alignment ran. Drives the intro-repair heuristic. */
  lyricLineCount?: number;
}

export interface NarrativeFormProvenance {
  addedAt: string;
  addedBy: "corpus-mining" | "human-confirmed" | "seed";
  derivedFrom?: {
    corpus: string;
    support: number;
    threshold: number;
  };
  /** Updated by the classify script each run — how many songs currently match this form. */
  matchCount?: number;
}

export interface NarrativeForm {
  id: string;
  name: string;
  definition: string;
  /** The canonical skeleton this form represents. */
  signature: CanonicalRole[];
  /** Additional skeletons that should also match this form directly (score 1.0), e.g. minor variants seen during mining. */
  variants?: CanonicalRole[][];
  exemplars: { corpus: string; songId: string; title: string }[];
  provenance: NarrativeFormProvenance;
}

export interface FormMatch {
  /** Null when every candidate form scored below the threshold. */
  formId: string | null;
  score: number;
  skeleton: CanonicalRole[];
  /** Framing facts about the song that are NOT part of the skeleton (see skeleton.ts's doc comment on why). */
  tags: string[];
  evidence: string[];
  runnerUp?: { formId: string; score: number };
}
