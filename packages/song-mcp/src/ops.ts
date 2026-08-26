import { z } from "zod";
import type { NoteName, ChordQuality } from "@music-theory/core";
import type { BlueprintSong, BlueprintSection, Chord } from "@music-theory/song-blueprint";
import { getChordIntervals } from "@music-theory/core";

// ---------------------------------------------------------------------------
// Zod schemas for the five operations
// ---------------------------------------------------------------------------

const noteNameSchema = z.string() as z.ZodType<NoteName>;
const chordQualitySchema = z.enum([
  "maj", "min", "dim", "aug", "7", "maj7", "min7", "m7b5", "sus2", "sus4",
]) as z.ZodType<ChordQuality>;

export const renameSectionOp = z.object({
  type: z.literal("renameSection"),
  songId: z.string(),
  sectionId: z.string(),
  name: z.string().min(1),
});

export const setSectionKeyOp = z.object({
  type: z.literal("setSectionKey"),
  songId: z.string(),
  sectionId: z.string(),
  key: noteNameSchema,
  scale: z.string().optional(),
});

export const duplicateSectionOp = z.object({
  type: z.literal("duplicateSection"),
  songId: z.string(),
  sectionId: z.string(),
  insertAfterSectionId: z.string().optional(),
});

export const reorderSectionsOp = z.object({
  type: z.literal("reorderSections"),
  songId: z.string(),
  orderedSectionIds: z.array(z.string()),
});

export const setChordProgressionOp = z.object({
  type: z.literal("setChordProgression"),
  songId: z.string(),
  sectionId: z.string(),
  chords: z.array(z.object({
    root: noteNameSchema,
    quality: chordQualitySchema,
    romanNumeral: z.string().optional(),
    beats: z.number().positive().optional(),
  })),
});

export const songOpSchema = z.discriminatedUnion("type", [
  renameSectionOp,
  setSectionKeyOp,
  duplicateSectionOp,
  reorderSectionsOp,
  setChordProgressionOp,
]);

export type SongOp = z.infer<typeof songOpSchema>;

// ---------------------------------------------------------------------------
// Validation error — one per op that failed
// ---------------------------------------------------------------------------

export interface OpValidationError {
  opIndex: number;
  opType: string;
  message: string;
}

// ---------------------------------------------------------------------------
// Change summary entry — one per op that was applied
// ---------------------------------------------------------------------------

export interface OpChangeSummary {
  opType: string;
  sectionId: string;
  description: string;
}

// ---------------------------------------------------------------------------
// applyOps — pure, all-or-nothing
// ---------------------------------------------------------------------------

/**
 * Validate then apply all ops to a song, or apply none. Returns the mutated
 * song and a human-readable change summary. Never touches lyrics or
 * lyricsTimeline content.
 *
 * @param song The song to mutate (caller's responsibility to clone/persist)
 * @param ops The operations to apply
 * @returns { song, changes, errors } — if `errors` is non-empty, `song` is the
 *          original unmutated song and `changes` is empty.
 */
export function applyOps(
  song: BlueprintSong,
  ops: SongOp[],
): { song: BlueprintSong; changes: OpChangeSummary[]; errors: OpValidationError[] } {
  // Phase 1: validate all ops first
  const errors: OpValidationError[] = [];
  for (let i = 0; i < ops.length; i++) {
    const op = ops[i];
    if (op.songId !== song.id) {
      errors.push({ opIndex: i, opType: op.type, message: `songId "${op.songId}" does not match this song's id "${song.id}".` });
      continue;
    }
    const section = song.sections.find((s) => s.id === op.sectionId);
    if (!section) {
      errors.push({ opIndex: i, opType: op.type, message: `Section "${op.sectionId}" not found in this song.` });
      continue;
    }

    // Per-op validation
    if (op.type === "reorderSections") {
      // Must be a permutation of existing ids
      const existingIds = new Set(song.sections.map((s) => s.id));
      const opIds = new Set(op.orderedSectionIds);
      if (op.orderedSectionIds.length !== song.sections.length) {
        errors.push({ opIndex: i, opType: op.type, message: `orderedSectionIds has ${op.orderedSectionIds.length} ids but the song has ${song.sections.length} sections — must be a permutation.` });
      } else if (!op.orderedSectionIds.every((id) => existingIds.has(id))) {
        errors.push({ opIndex: i, opType: op.type, message: "orderedSectionIds contains ids not present in this song." });
      } else if (new Set(op.orderedSectionIds).size !== op.orderedSectionIds.length) {
        errors.push({ opIndex: i, opType: op.type, message: "orderedSectionIds contains duplicates." });
      }
    }

    if (op.type === "setChordProgression") {
      for (const chord of op.chords) {
        try {
          getChordIntervals(chord.quality as ChordQuality);
        } catch {
          errors.push({ opIndex: i, opType: op.type, message: `Invalid chord quality "${chord.quality}". Must be one of: maj, min, dim, aug, 7, maj7, min7, m7b5, sus2, sus4.` });
          break;
        }
      }
    }
  }

  if (errors.length > 0) {
    return { song, changes: [], errors };
  }

  // Phase 2: apply all ops
  const changes: OpChangeSummary[] = [];
  let mutated: BlueprintSong = { ...song };

  for (const op of ops) {
    switch (op.type) {
      case "renameSection": {
        mutated = {
          ...mutated,
          sections: mutated.sections.map((s) =>
            s.id === op.sectionId ? { ...s, name: op.name } : s,
          ),
        };
        changes.push({ opType: "renameSection", sectionId: op.sectionId, description: `Renamed section "${op.sectionId}" to "${op.name}".` });
        break;
      }

      case "setSectionKey": {
        mutated = {
          ...mutated,
          sections: mutated.sections.map((s) =>
            s.id === op.sectionId ? { ...s, key: op.key, scale: op.scale as BlueprintSection["scale"] } : s,
          ),
        };
        const scaleNote = op.scale ? ` ${op.scale}` : "";
        changes.push({ opType: "setSectionKey", sectionId: op.sectionId, description: `Set section "${op.sectionId}" key to ${op.key}${scaleNote}.` });
        break;
      }

      case "duplicateSection": {
        const src = mutated.sections.find((s) => s.id === op.sectionId)!;
        const newSection: BlueprintSection = {
          ...src,
          id: crypto.randomUUID(),
          name: `${src.name} (copy)`,
        };
        const idx = op.insertAfterSectionId
          ? mutated.sections.findIndex((s) => s.id === op.insertAfterSectionId)
          : mutated.sections.findIndex((s) => s.id === op.sectionId);
        const sections = [...mutated.sections];
        sections.splice(idx >= 0 ? idx + 1 : sections.length, 0, newSection);
        mutated = { ...mutated, sections };
        changes.push({ opType: "duplicateSection", sectionId: op.sectionId, description: `Duplicated section "${op.sectionId}" → "${newSection.id}".` });
        break;
      }

      case "reorderSections": {
        const orderMap = new Map(op.orderedSectionIds.map((id, i) => [id, i]));
        const sections = [...mutated.sections].sort((a, b) => (orderMap.get(a.id) ?? 0) - (orderMap.get(b.id) ?? 0));
        mutated = { ...mutated, sections };
        changes.push({ opType: "reorderSections", sectionId: "all", description: `Reordered ${sections.length} sections.` });
        break;
      }

      case "setChordProgression": {
        const newChords: Chord[] = op.chords.map((c, idx) => ({
          id: crypto.randomUUID(),
          romanNumeral: c.romanNumeral ?? `${idx + 1}`,
          root: c.root as NoteName,
          quality: c.quality as ChordQuality,
          beats: c.beats ?? 4,
        }));
        mutated = {
          ...mutated,
          sections: mutated.sections.map((s) =>
            s.id === op.sectionId ? { ...s, chords: newChords, beatsPerChord: newChords[0]?.beats ?? 4 } : s,
          ),
        };
        const rns = newChords.map((c) => `${c.romanNumeral} (${c.root}${c.quality})`).join(", ");
        changes.push({ opType: "setChordProgression", sectionId: op.sectionId, description: `Set section "${op.sectionId}" chords to: ${rns}.` });
        break;
      }
    }
  }

  return { song: mutated, changes, errors: [] };
}