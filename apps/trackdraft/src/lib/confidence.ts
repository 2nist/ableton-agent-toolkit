import type { BlueprintSong } from "../types/blueprint";

export type ConfidenceLevel = "complete" | "strong" | "partial" | "draft" | "empty";

export interface ConfidenceResult {
  level: ConfidenceLevel;
  score: number; // 0–1
  label: string;
  color: string; // tailwind color class for the dot
}

const LEVELS: { level: ConfidenceLevel; min: number; label: string; color: string }[] = [
  { level: "complete", min: 0.9, label: "Complete", color: "bg-ok" },
  { level: "strong", min: 0.6, label: "Strong", color: "bg-warn" },
  { level: "partial", min: 0.3, label: "Partial", color: "bg-orange-400" },
  { level: "draft", min: 0.05, label: "Draft", color: "bg-danger" },
  { level: "empty", min: 0, label: "Empty", color: "bg-neutral-500" },
];

/**
 * Computes a confidence score for a song based on how much content it has.
 * This is fully automatic — the user never sets it manually.
 *
 * Weight breakdown (total 1.0):
 *  - Has arrangement entries:     0.25
 *  - Sections have chords:        0.25
 *  - Sections have lyrics:        0.25
 *  - Has concept/notes/ideas:     0.25
 */
export function computeConfidence(song: BlueprintSong): ConfidenceResult {
  let score = 0;

  // Arrangement: any entries?
  if (song.arrangement.length > 0) {
    score += 0.25;
  }

  // Sections with chords
  if (song.sections.length > 0) {
    const sectionsWithChords = song.sections.filter((s) => s.chords.length > 0).length;
    score += (sectionsWithChords / song.sections.length) * 0.25;
  }

  // Sections with lyrics
  if (song.sections.length > 0) {
    const sectionsWithLyrics = song.sections.filter(
      (s) => (s.lyrics && s.lyrics.trim().length > 0) || (s.lyricsTimeline && s.lyricsTimeline.length > 0),
    ).length;
    score += (sectionsWithLyrics / song.sections.length) * 0.25;
  }

  // Has concept, notes, or additional ideas
  if (song.concept || song.notes || (song.additionalIdeas && song.additionalIdeas.length > 0)) {
    score += 0.25;
  }

  // Find the matching level
  const level = LEVELS.find((l) => score >= l.min) ?? LEVELS[LEVELS.length - 1];

  return {
    level: level.level,
    score: Math.round(score * 100) / 100,
    label: level.label,
    color: level.color,
  };
}

/** Returns all confidence levels for filter chip rendering. */
export function getConfidenceLevels(): { level: ConfidenceLevel; label: string; color: string }[] {
  return LEVELS.map(({ level, label, color }) => ({ level, label, color }));
}