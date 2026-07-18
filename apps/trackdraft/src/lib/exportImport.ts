import { NOTE_TO_PC } from "@music-theory/core";
import type { BlueprintSong } from "../types/blueprint";

/** Triggers a browser download of a song as a standalone JSON file --
 *  the hand-off artifact Phase 6's Ableton extension consumes, and
 *  matching the original TrackDraft's documented "export complete JSON"
 *  Finishing Tools feature. */
export function downloadSongJson(song: BlueprintSong) {
  const blob = new Blob([JSON.stringify(song, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${song.title.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.trackdraft.json`;
  a.click();
  URL.revokeObjectURL(url);
}

/** Minimal shape validation for imported JSON -- catches obviously wrong
 *  files (wrong app, corrupted) without being a full schema validator. */
export function parseImportedSong(raw: unknown): BlueprintSong {
  if (typeof raw !== "object" || raw === null) {
    throw new Error("Not a valid song file: expected a JSON object.");
  }
  const obj = raw as Record<string, unknown>;
  if (typeof obj.title !== "string" || !Array.isArray(obj.sections) || !Array.isArray(obj.arrangement)) {
    throw new Error("Not a valid song file: missing title/sections/arrangement.");
  }
  // Real validation, not just shape-checking: caught live when an earlier
  // version of the ingestion script wrote key="E major" instead of "E" --
  // pitchClass() only accepts bare note names and threw deep inside
  // rendering (HexWheel/ProgressionBuilder) instead of failing clearly
  // here at the actual untrusted-input boundary.
  if (typeof obj.key === "string" && !(obj.key in NOTE_TO_PC)) {
    throw new Error(`Not a valid song file: "${obj.key}" is not a recognized note name (expected e.g. "C", "F#", "Bb").`);
  }
  const now = new Date().toISOString();
  return {
    id: typeof obj.id === "string" ? obj.id : crypto.randomUUID(),
    title: obj.title,
    artist: typeof obj.artist === "string" ? obj.artist : undefined,
    key: typeof obj.key === "string" ? obj.key : "C",
    scale: typeof obj.scale === "string" ? (obj.scale as BlueprintSong["scale"]) : "ionian",
    bpm: typeof obj.bpm === "number" ? obj.bpm : 120,
    timeSignatureNumerator: typeof obj.timeSignatureNumerator === "number" ? obj.timeSignatureNumerator : 4,
    timeSignatureDenominator: typeof obj.timeSignatureDenominator === "number" ? obj.timeSignatureDenominator : 4,
    sections: obj.sections as BlueprintSong["sections"],
    arrangement: obj.arrangement as BlueprintSong["arrangement"],
    concept: typeof obj.concept === "string" ? obj.concept : undefined,
    notes: (obj.notes as BlueprintSong["notes"]) ?? undefined,
    additionalIdeas: Array.isArray(obj.additionalIdeas) ? (obj.additionalIdeas as string[]) : undefined,
    references: Array.isArray(obj.references) ? (obj.references as string[]) : undefined,
    suiteGroup: (obj.suiteGroup as BlueprintSong["suiteGroup"]) ?? undefined,
    alternates: Array.isArray(obj.alternates) ? (obj.alternates as BlueprintSong["alternates"]) : undefined,
    status: (obj.status as BlueprintSong["status"]) ?? undefined,
    createdAt: typeof obj.createdAt === "string" ? obj.createdAt : now,
    updatedAt: now,
  };
}

export async function readSongFile(file: File): Promise<BlueprintSong> {
  const text = await file.text();
  const raw = JSON.parse(text);
  return parseImportedSong(raw);
}
