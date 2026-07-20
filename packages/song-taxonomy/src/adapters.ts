import { normalizeRole } from "./roles.js";
import type { SectionToken } from "./types.js";

export interface McgillSection {
  start_ms: number;
  duration_ms: number;
  sectionType?: string;
}
export interface McgillSong {
  title: string;
  artist: string;
  sections: McgillSection[];
}

/** McGill Billboard/SALAMI `sectionType` is already an English word — feed straight to normalizeRole. */
export function fromMcgill(song: McgillSong): SectionToken[] {
  const tokens: SectionToken[] = [];
  for (const section of song.sections) {
    const role = normalizeRole(section.sectionType ?? "");
    if (!role) continue;
    tokens.push({
      role,
      rawLabel: section.sectionType ?? "",
      startMs: section.start_ms,
      durationMs: section.duration_ms,
    });
  }
  return tokens;
}

export interface RockCorpusSection {
  time: number; // seconds
  duration: number; // seconds
  label: string;
}
export interface RockCorpusSong {
  metadata: { title: string; artist: string };
  sections: RockCorpusSection[];
}

/**
 * Rock Corpus (Trevor de Clercq's harmonic-analysis format) labels
 * sections with short abbreviations, not words — `Vr`/`Vr2`, `In`, `Ch3`,
 * `Br*2` — plus non-section markers: `|` (a bar-line marker) and bracketed
 * meter changes (`[12/8]`). Enumerated across the whole corpus (238 files)
 * to build this table; only high-confidence abbreviations are mapped —
 * ambiguous ones (`Zz`, `A`, `Tg`, bare letters) are left unmapped and fall
 * through to `normalizeRole`'s "other" default rather than guessed at,
 * since a wrong load-bearing guess corrupts the skeleton but an "other"
 * just means this song contributes less signal.
 */
const ROCK_CORPUS_ABBREVIATIONS: Record<string, string> = {
  vr: "verse",
  in: "intro",
  ch: "chorus",
  br: "bridge",
  so: "solo",
  ou: "outro",
  rf: "refrain",
  pc: "pre-chorus",
  ln: "link",
  bk: "break",
};

function expandRockCorpusLabel(rawLabel: string): string | null {
  if (/^\[.*\]$/.test(rawLabel)) return null; // meter annotation, not a section
  const stripped = rawLabel.replace(/\*?\d+$/, "").trim();
  if (stripped === "|" || stripped.length === 0) return null; // bar-line marker
  return ROCK_CORPUS_ABBREVIATIONS[stripped.toLowerCase()] ?? stripped;
}

export function fromRockCorpus(song: RockCorpusSong): SectionToken[] {
  const tokens: SectionToken[] = [];
  for (const section of song.sections) {
    const expanded = expandRockCorpusLabel(section.label);
    if (expanded === null) continue;
    const role = normalizeRole(expanded);
    if (!role) continue;
    tokens.push({
      role,
      rawLabel: section.label,
      startMs: Math.round(section.time * 1000),
      durationMs: Math.round(section.duration * 1000),
    });
  }
  return tokens;
}

export interface BlueprintLikeSection {
  role?: string;
  name?: string;
  /** Section lyric text, when present — used only to derive `lyricLineCount`
   *  for the intro repair; no timing is available for these sections, so
   *  the repair falls back to the positional rule if this is absent. */
  lyrics?: string;
}
export interface BlueprintLikeSong {
  sections: BlueprintLikeSection[];
}

/**
 * Shared adapter for the TrackDraft Beatles catalog (`*.trackdraft.json`,
 * already in BlueprintSong shape) and any native BlueprintSong: prefers
 * `role` when it's a real role, falling back to `name` when `role` is the
 * placeholder `"custom"` every catalog file currently carries (see
 * `toBlueprintSong.ts`'s `normalizeRole` fix — this adapter works whether
 * or not that fix has been applied and the catalog regenerated).
 */
export function fromBlueprintSong(song: BlueprintLikeSong): SectionToken[] {
  const tokens: SectionToken[] = [];
  for (const section of song.sections) {
    const label = section.role && section.role !== "custom" ? section.role : (section.name ?? "");
    const role = normalizeRole(label);
    if (!role) continue;
    const lyricLineCount = section.lyrics
      ? section.lyrics.split("\n").filter((line) => line.trim().length > 0).length
      : undefined;
    tokens.push({ role, rawLabel: label, lyricLineCount });
  }
  return tokens;
}
