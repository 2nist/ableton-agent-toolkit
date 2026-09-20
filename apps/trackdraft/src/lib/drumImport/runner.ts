import {
  euclidOnsetSteps,
  gridToBlocks,
  toSectionPatch,
  type DrumGrid,
  type ImportedSection,
  type SectionDrumPatch,
} from "@drum/library";
import type { BlueprintSection, BlueprintSong } from "../../types/blueprint";
import type { DrumAnalysisFile } from "./analysisFile";

/**
 * The importer runner — the app-side half of the drum importer (the
 * analysis→grid half is upstream). Turns a `DrumAnalysisFile` into section
 * patches through the SAME converter the package ships (`gridToBlocks` →
 * `toSectionPatch`, with the REAL `euclidOnsetSteps` passed as `onsets` so
 * the Euclidean fitter never runs on its structural copy), then merges
 * them onto song sections.
 *
 * Two consumers share this module:
 *   - the "Import analysis…" entry in the Drums tab (one section → the
 *     drums draft store, so the timeline previews it and Apply/Revert
 *     behave exactly like any other drum edit);
 *   - `scripts/import-drum-analysis.ts` (the whole-catalog path: every
 *     matched section merged into a new .blueprint.json).
 *
 * Matching is by `sectionId` first, then case-insensitive `sectionName`.
 * A section whose analysis was split into occurrences gets the FIRST
 * span — per-occurrence drum variation isn't representable in the
 * section template yet (reported via `matches`/warnings so it's visible).
 */

export interface SectionImportResult {
  sectionId: string;
  sectionName: string;
  /** Which analysis entry produced it (index into `file.sections`). */
  entryIndex: number;
  /** How many analysis entries matched this section — >1 means the file
   *  split the section into occurrences and the first one won. */
  matches: number;
  patch: SectionDrumPatch;
  /** The converter's full report (bar kinds, transitions, stats). */
  report: ImportedSection;
}

export interface SongImportPlan {
  results: SectionImportResult[];
  warnings: string[];
}

const norm = (s: string): string => s.trim().toLowerCase();

/** The analysis entries that belong to a section: id first, then name. */
export function findAnalysisEntries(file: DrumAnalysisFile, section: BlueprintSection): number[] {
  const byId = file.sections
    .map((e, i) => ({ e, i }))
    .filter(({ e }) => e.sectionId !== undefined && e.sectionId === section.id)
    .map(({ i }) => i);
  if (byId.length > 0) return byId;
  return file.sections
    .map((e, i) => ({ e, i }))
    .filter(({ e }) => e.sectionName !== undefined && norm(e.sectionName) === norm(section.name))
    .map(({ i }) => i);
}

/** Run the converter for ONE song section — null when the file has no span
 *  matching it. Pure: the caller decides where the patch goes (draft
 *  store in the UI, a merged song copy in the batch script). */
export function planSectionImport(file: DrumAnalysisFile, section: BlueprintSection): SectionImportResult | null {
  const entries = findAnalysisEntries(file, section);
  if (entries.length === 0) return null;
  const entryIndex = entries[0];
  const entry = file.sections[entryIndex];

  const grid: DrumGrid = {
    beatsPerBar: file.beatsPerBar,
    stepsPerBar: file.stepsPerBar,
    bars: file.bars,
  };
  const [imported] = gridToBlocks(grid, [{
    id: section.id,
    role: entry.role ?? section.role ?? undefined,
    startBar: entry.startBar,
    bars: entry.bars,
  }], {
    lanes: file.lanes,
    fillEncoding: file.fillEncoding,
    onsets: euclidOnsetSteps,
  });

  return {
    sectionId: section.id,
    sectionName: section.name,
    entryIndex,
    matches: entries.length,
    patch: toSectionPatch(imported, { basePattern: file.basePattern }),
    report: imported,
  };
}

/** Every song section the file covers, in song order, plus warnings for
 *  spans that match nothing or sections the file split into occurrences. */
export function planSongImport(file: DrumAnalysisFile, song: BlueprintSong): SongImportPlan {
  const results: SectionImportResult[] = [];
  const warnings: string[] = [];

  if (file.songId !== undefined && file.songId !== song.id) {
    warnings.push(`analysis is for song "${file.songId}" but this is "${song.id}" — pairing by section ids/names is unsafe`);
  }

  for (const section of song.sections) {
    const result = planSectionImport(file, section);
    if (!result) continue;
    results.push(result);
    if (result.matches > 1) {
      const first = file.sections[result.entryIndex];
      warnings.push(`"${section.name}": ${result.matches} analysis spans match — using the first (bar ${first.startBar}, ${first.bars} bars); per-occurrence drums aren't representable yet`);
    }
  }

  const matched = new Set(results.map((r) => r.entryIndex));
  file.sections.forEach((entry, i) => {
    if (matched.has(i)) return;
    warnings.push(`analysis span "${entry.sectionId ?? entry.sectionName}" (bar ${entry.startBar}, ${entry.bars} bars) matches no song section — skipped`);
  });

  return { results, warnings };
}

/**
 * Merge a patch onto a section. The import REPLACES the section's drum
 * authoring: every competing drum field is cleared, because a leftover
 * `drumMeterOutline` / voice pattern / detour / transition would sit
 * under or over the imported blocks and quietly change what plays — the
 * preview must be exactly the imported performance. Non-drum fields
 * (chords, lyrics, melody, meter...) are untouched, and `drumPattern`
 * becomes "none" (the muted base + blocks is the converter's pure path).
 */
export function applySectionPatch(section: BlueprintSection, patch: SectionDrumPatch): BlueprintSection {
  return {
    ...section,
    drumPattern: patch.drumPattern,
    velocity: patch.velocity,
    drumBlocks: patch.drumBlocks,
    drumVariantIndex: undefined,
    drumMeterOutline: undefined,
    drumVoicePatterns: undefined,
    drumVariationOutline: undefined,
    drumVariationBars: undefined,
    drumVariationStartBeat: undefined,
    drumTransitionModel: undefined,
    drumTransitionBars: undefined,
  };
}

export interface SongImportMerge extends SongImportPlan {
  song: BlueprintSong;
}

/** Whole-song merge for the batch path: plan against the song, patch every
 *  matched section, leave everything else byte-identical. */
export function mergeAnalysisIntoSong(song: BlueprintSong, file: DrumAnalysisFile): SongImportMerge {
  const plan = planSongImport(file, song);
  const byId = new Map(plan.results.map((r) => [r.sectionId, r.patch]));
  return {
    ...plan,
    song: {
      ...song,
      sections: song.sections.map((s) => {
        const patch = byId.get(s.id);
        return patch ? applySectionPatch(s, patch) : s;
      }),
    },
  };
}
