/**
 * The Study surface's row model.
 *
 * Three grains — song · section · chord event — flattened into rows that all
 * carry the coarser grains' facts (a chord row knows its section's role and
 * its song's genre). That denormalisation is what lets one grouping control
 * answer "what does role do to mean tension" without a join, and it is why
 * cross-filtering works across panels: a filter on `role` narrows every
 * grain, a filter on `roman` only narrows the chord grain.
 *
 * Nothing here is stored. Rows are derived from `BlueprintSong[]` on demand
 * (see `dataset.ts`), so a report can never disagree with the song.
 */

export type Grain = "song" | "section" | "chord";

export type StudyScope = "song" | "library" | "catalogue";

// ---- rows -----------------------------------------------------------------

export interface SongRow {
  grain: "song";
  songId: string;
  title: string;
  artist: string;
  genre: string;
  key: string;
  scale: string;
  meter: string;
  bpm: number;
  totalBars: number;
  sectionCount: number;
  form: string;
  formScore: number;
  melodyShare: number;
  lyricShare: number;
  borrowedShare: number;
  avgTension: number;
}

export interface SectionRow {
  grain: "section";
  songId: string;
  title: string;
  artist: string;
  genre: string;
  key: string;
  scale: string;
  meter: string;
  sectionId: string;
  section: string;
  role: string;
  velocity: string;
  bars: number;
  beatsPerChord: number;
  chordCount: number;
  distinctDegrees: number;
  borrowed: boolean;
  appliedCount: number;
  avgTension: number;
  hasMelody: boolean;
  hasLyrics: boolean;
  hasDrums: boolean;
  sectionIndex: number;
  startBar: number;
  cadences: string;
}

export interface ChordRow {
  grain: "chord";
  songId: string;
  title: string;
  artist: string;
  genre: string;
  key: string;
  scale: string;
  meter: string;
  sectionId: string;
  section: string;
  role: string;
  index: number;
  roman: string;
  nextRoman: string;
  degree: string;
  quality: string;
  fn: string;
  borrowed: boolean;
  applied: boolean;
  cadence: string;
  tension: number;
  durationBeats: number;
  startBeat: number;
}

export type StudyRow = SongRow | SectionRow | ChordRow;

export interface StudyDataset {
  scope: StudyScope;
  songs: SongRow[];
  sections: SectionRow[];
  chords: ChordRow[];
  /** Wall-clock build time — shown in the view's footer so a stale index is visible. */
  builtAt: number;
}

export function rowsOf(dataset: StudyDataset, grain: Grain): StudyRow[] {
  if (grain === "song") return dataset.songs;
  if (grain === "section") return dataset.sections;
  return dataset.chords;
}

// ---- filters & panels -----------------------------------------------------

export type FilterOp = "eq" | "neq" | "gt" | "lt" | "in" | "contains";

export interface StudyFilter {
  field: string;
  op: FilterOp;
  /** Scalar for eq/neq/gt/lt/contains, list for `in`. */
  value: string | number | readonly string[];
  /** Grain the field belongs to — shown on the chip; `common` fields apply to all. */
  grain: Grain | "common";
}

export type PanelKind = "breakdown" | "matrix" | "distribution" | "rows" | "leads";

export interface PanelSpec {
  id: string;
  kind: PanelKind;
  title: string;
  grain: Grain;
  /** breakdown · distribution */
  dimension?: string;
  /** matrix */
  row?: string;
  col?: string;
  /** breakdown · rows (matrix uses count) */
  measures: string[];
  limit?: number;
}
