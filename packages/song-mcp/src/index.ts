#!/usr/bin/env node
/**
 * TrackDraft Song MCP Server
 *
 * Provides six tools for an MCP client to analyze the user's song library,
 * apply structural edits, and create genre templates — by plain language.
 * The model NEVER writes BlueprintSong JSON directly: it emits validated
 * operations; this server applies them.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolRequest,
} from "@modelcontextprotocol/sdk/types.js";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { z } from "zod";
import type { BlueprintSong } from "@music-theory/song-blueprint";
import { songDigest, songDetail } from "./digest.js";
import { songOpSchema, applyOps } from "./ops.js";
import { assertSafeId, createSongLibrary } from "./library.js";

// ---------------------------------------------------------------------------
// Library storage
// ---------------------------------------------------------------------------

const LIBRARY_DIR = process.env.TRACKDRAFT_LIBRARY_DIR ?? path.join(os.homedir(), "TrackDraft", "library");
const library = createSongLibrary(LIBRARY_DIR);
const TEMPLATES_DIR = library.templatesDir;
const { readSong, writeSong, backupSong, listBackups, listAllSongs } = library;

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

// ---------------------------------------------------------------------------
// Template shape — derived from existing genre-catalog files
// ---------------------------------------------------------------------------

const mapSlotSchema = z.object({
  role: z.string(),
  label: z.string(),
  purpose: z.string(),
  bars: z.number().optional(),
  velocity: z.string().optional(),
  beatsPerChord: z.number().optional(),
  timeSignatureNumerator: z.number().optional(),
  timeSignatureDenPower: z.number().optional(),
  progression: z.array(z.string()).optional(),
  groove: z.string().optional(),
  swing: z.number().min(0).max(100).optional(),
  optional: z.boolean().optional(),
  harmonyRhythm: z.enum(["beats", "euclid", "follow drums"]).optional(),
  harmonyCellCount: z.number().int().min(1).optional(),
  harmonyRotation: z.number().int().min(0).optional(),
  syncopationOffset: z.number().optional(),
});

const songMapDefaultsSchema = z.object({
  bpm: z.number().optional(),
  key: z.string().optional(),
  scale: z.string().optional(),
  concept: z.string().optional(),
  genre: z.string().optional(),
});

const songMapVariantSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  slots: z.array(mapSlotSchema),
});

const templateSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  defaults: songMapDefaultsSchema.optional(),
  slots: z.array(mapSlotSchema),
  variants: z.array(songMapVariantSchema).optional(),
});

// ---------------------------------------------------------------------------
// Template Zod output for structured content
// ---------------------------------------------------------------------------

const templateOutputSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  defaults: songMapDefaultsSchema.optional(),
  slots: z.array(mapSlotSchema),
  variants: z.array(songMapVariantSchema).optional(),
});

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

const server = new Server(
  { name: "trackdraft-song-mcp", version: "0.1.0" },
  { capabilities: { tools: {} } },
);

// ---------------------------------------------------------------------------
// Tool schemas (Zod)
// ---------------------------------------------------------------------------

const queryLibrarySchema = z.object({
  filter: z.object({
    key: z.string().optional(),
    label: z.string().optional(),
    artistContains: z.string().optional(),
    missingChords: z.boolean().optional(),
  }).optional(),
  limit: z.number().int().min(1).max(200).default(50),
});

const getSongSchema = z.object({
  songId: z.string(),
});

const applyOpsSchema = z.object({
  ops: z.array(songOpSchema),
  dryRun: z.boolean().default(false),
});

const revertSongSchema = z.object({
  songId: z.string(),
  backupTimestamp: z.string().optional(),
});

const createTemplateSchema = z.object({
  name: z.string().min(1),
  template: templateSchema,
});

const libraryStatsSchema = z.object({});

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "song_query_library",
      description:
        "Get a token-lean summary of every song in your library (id, title, key, BPM, time signature, section count, per-section chord counts and roman numerals, whether each section has lyrics). This is the cheap overview tool — prefer it before song_get to narrow down which songs to examine closely. Returns up to `limit` results (default 50).",
      inputSchema: {
        type: "object",
        properties: {
          filter: {
            type: "object",
            properties: {
              key: { type: "string", description: "Filter songs by key (e.g. 'C', 'Am', 'F#')" },
              label: { type: "string", description: "Filter sections whose name contains this string" },
              artistContains: { type: "string", description: "Filter songs whose artist name contains this string" },
              missingChords: { type: "boolean", description: "Show only songs that have at least one section with zero chords" },
            },
          },
          limit: { type: "number", description: "Maximum songs to return (1-200, default 50)", default: 50 },
        },
      },
    },
    {
      name: "song_get",
      description:
        "Get full structural detail for a single song: every section's role, bars, velocity, time signature, key, chord progression (roman numeral + root + quality + beats), lyric line count, and first lyric line. No lyricsTimeline data. Returns an error with the 5 closest-matching song ids if the requested id is not found.",
      inputSchema: {
        type: "object",
        properties: {
          songId: { type: "string", description: "The song's id from song_query_library" },
        },
        required: ["songId"],
      },
    },
    {
      name: "song_apply_ops",
      description:
        "Apply structural edits to songs as a batch of validated operations. All ops in the array are validated first, then applied in order — if any fail validation, none are applied (all-or-nothing). dryRun=true returns the change summary without writing to disk. Backups are created before overwriting on write. Supported ops: renameSection, setSectionKey, duplicateSection, reorderSections, setChordProgression.",
      inputSchema: {
        type: "object",
        properties: {
          ops: {
            type: "array",
            description: "Array of SongOp objects. Each must have a `type` field and the corresponding parameters.",
          },
          dryRun: { type: "boolean", description: "If true, return the change summary without writing (default false)", default: false },
        },
        required: ["ops"],
      },
    },
    {
      name: "song_revert",
      description:
        "Restore a song from its most recent backup (or a specific backup by timestamp). Lists available backups if the song has any.",
      inputSchema: {
        type: "object",
        properties: {
          songId: { type: "string" },
          backupTimestamp: { type: "string", description: "Specific backup timestamp; omit to use the latest" },
        },
        required: ["songId"],
      },
    },
    {
      name: "song_create_template",
      description:
        "Create a new genre template file in the templates directory. The template must match the catalog shape: id, name, description, optional defaults (bpm, key, scale, concept, genre), and an array of slots (each with role, label, purpose, and optional bars/velocity/beatsPerChord/timeSignatureNumerator/timeSignatureDenPower/progression/groove/swing/optional/harmonyRhythm/harmonyCellCount/harmonyRotation/syncopationOffset fields). `genre` is an engine family slug (rock, pop, bossa, ballad, trap, house, neo-soul, math-rock) — set it only when the genre IS that family.",
      inputSchema: {
        type: "object",
        properties: {
          name: { type: "string", description: "Template display name (used as the filename stem)" },
          template: {
            type: "object",
            description: "Full template object matching the genre-catalog JSON shape",
          },
        },
        required: ["name", "template"],
      },
    },
    {
      name: "song_library_stats",
      description:
        "Aggregate statistics across all songs: total count, songs missing chords, key distribution, BPM min/median/max, and top 10 most common roman-numeral progressions with counts.",
      inputSchema: { type: "object", properties: {} },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request: CallToolRequest) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case "song_query_library": {
        const parsed = queryLibrarySchema.parse(args ?? {});
        let digests = listAllSongs().map(songDigest);

        if (parsed.filter) {
          const f = parsed.filter;
          if (f.key) {
            const key = f.key.toUpperCase();
            digests = digests.filter((d) => d.key.toUpperCase() === key);
          }
          if (f.label) {
            const label = f.label.toLowerCase();
            digests = digests.filter((d) => d.sections.some((s) => s.name.toLowerCase().includes(label) || s.label.toLowerCase().includes(label)));
          }
          if (f.artistContains) {
            const artist = f.artistContains.toLowerCase();
            digests = digests.filter((d) => d.artist?.toLowerCase().includes(artist));
          }
          if (f.missingChords) {
            digests = digests.filter((d) => d.sections.some((s) => s.chordCount === 0));
          }
        }

        const limited = digests.slice(0, parsed.limit);
        return {
          content: [
            { type: "text", text: `${limited.length} of ${digests.length} songs` },
          ],
          structuredContent: { songs: limited, total: digests.length, returned: limited.length },
        };
      }

      case "song_get": {
        const parsed = getSongSchema.parse(args ?? {});
        const song = readSong(parsed.songId);
        if (!song) {
          // Find 5 closest-matching ids
          const allSongs = listAllSongs();
          const matches = allSongs
            .map((s) => ({
              id: s.id,
              similarity: s.id.includes(parsed.songId) ? 2 : s.title.toLowerCase().includes(parsed.songId.toLowerCase()) ? 1 : 0,
            }))
            .filter((m) => m.similarity > 0)
            .sort((a, b) => b.similarity - a.similarity)
            .slice(0, 5)
            .map((m) => m.id);
          const allIds = allSongs.slice(0, 5).map((s) => s.id);
          const suggestions = matches.length > 0 ? matches : allIds;
          return {
            content: [{ type: "text", text: `Song "${parsed.songId}" not found. Did you mean one of: ${suggestions.join(", ")}?` }],
            isError: true,
          };
        }
        const detail = songDetail(song);
        return {
          content: [{ type: "text", text: `${detail.title} — ${detail.sectionCount} sections, ${detail.key} ${detail.scale} @ ${detail.bpm}bpm` }],
          structuredContent: detail,
        };
      }

      case "song_apply_ops": {
        const parsed = applyOpsSchema.parse(args ?? {});
        if (parsed.ops.length === 0) {
          return { content: [{ type: "text", text: "No operations provided." }] };
        }
        const songId = parsed.ops[0]!.songId;
        const song = readSong(songId);
        if (!song) {
          return { content: [{ type: "text", text: `Song "${songId}" not found.` }], isError: true };
        }
        const result = applyOps(song, parsed.ops as Parameters<typeof applyOps>[1]);
        if (result.errors.length > 0) {
          const msg = result.errors.map((e) => `[op ${e.opIndex}] ${e.message}`).join("\n");
          return { content: [{ type: "text", text: `Validation failed:\n${msg}` }], isError: true };
        }
        if (parsed.dryRun) {
          const summary = result.changes.map((c) => c.description).join("\n");
          return {
            content: [{ type: "text", text: `DRY RUN — no changes written.\n${summary}` }],
            structuredContent: { dryRun: true, changes: result.changes },
          };
        }
        // Backup before write
        const backupPath = backupSong(songId);
        writeSong(result.song);
        const summary = result.changes.map((c) => c.description).join("\n");
        return {
          content: [{ type: "text", text: `Applied ${result.changes.length} op(s):\n${summary}\nBackup: ${backupPath}` }],
          structuredContent: { changes: result.changes, backupPath },
        };
      }

      case "song_revert": {
        const parsed = revertSongSchema.parse(args ?? {});
        const backups = listBackups(parsed.songId);
        if (backups.length === 0) {
          return { content: [{ type: "text", text: `No backups found for song "${parsed.songId}".` }], isError: true };
        }

        let backupFile: string;
        if (parsed.backupTimestamp) {
          const match = backups.find((b) => b.startsWith(parsed.backupTimestamp!));
          if (!match) {
            return {
              content: [{ type: "text", text: `Backup "${parsed.backupTimestamp}" not found. Available: ${backups.map((b) => b.replace(".json", "")).join(", ")}` }],
              isError: true,
            };
          }
          backupFile = match;
        } else {
          backupFile = backups[0]!;
        }

        const backupPath = path.join(library.backupsDir, assertSafeId(parsed.songId), path.basename(backupFile));
        const song = JSON.parse(fs.readFileSync(backupPath, "utf-8")) as BlueprintSong;
        writeSong(song);
        return {
          content: [{ type: "text", text: `Restored "${parsed.songId}" from backup: ${backupFile.replace(".json", "")}` }],
        };
      }

      case "song_create_template": {
        const parsed = createTemplateSchema.parse(args ?? {});
        ensureDir(TEMPLATES_DIR);
        const slug = parsed.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase() || "template";
        const filename = `${slug}.template.json`;
        const filepath = path.join(TEMPLATES_DIR, filename);
        if (fs.existsSync(filepath)) {
          try {
            const existing = JSON.parse(fs.readFileSync(filepath, "utf-8"));
            return {
              content: [{ type: "text", text: `Template "${filename}" already exists.\nExisting: ${JSON.stringify(existing, null, 2)}\nNew: ${JSON.stringify(parsed.template, null, 2)}` }],
              isError: true,
            };
          } catch {
            // File exists but is unreadable — overwrite it
          }
        }
        fs.writeFileSync(filepath, JSON.stringify(parsed.template, null, 2), "utf-8");
        return {
          content: [{ type: "text", text: `Created template "${filename}"` }],
          structuredContent: { path: filepath, name: parsed.name },
        };
      }

      case "song_library_stats": {
        const allSongs = listAllSongs();
        const digests = allSongs.map(songDigest);

        const total = digests.length;
        const missingChords = digests.filter((d) => d.sections.some((s) => s.chordCount === 0)).length;

        // Key distribution
        const keyCounts: Record<string, number> = {};
        for (const d of digests) {
          const k = d.key;
          keyCounts[k] = (keyCounts[k] ?? 0) + 1;
        }

        // BPM stats
        const bpms = digests.map((d) => d.bpm).sort((a, b) => a - b);
        const bpmMin = bpms[0] ?? 0;
        const bpmMax = bpms[bpms.length - 1] ?? 0;
        const bpmMedian = bpms.length > 0 ? bpms[Math.floor(bpms.length / 2)]! : 0;

        // Top 10 roman-numeral progressions (per-section, normalized)
        const progressionCounts: Record<string, number> = {};
        for (const d of digests) {
          for (const s of d.sections) {
            if (s.romanNumerals.length > 0) {
              const key = s.romanNumerals.join(",");
              progressionCounts[key] = (progressionCounts[key] ?? 0) + 1;
            }
          }
        }
        const top10 = Object.entries(progressionCounts)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 10)
          .map(([rn, count]) => ({ progression: rn.split(","), count }));

        return {
          content: [{ type: "text", text: `${total} songs, ${missingChords} missing chords, BPM ${bpmMin}-${bpmMax} (median ${bpmMedian})` }],
          structuredContent: {
            totalSongs: total,
            songsMissingChords: missingChords,
            keyDistribution: keyCounts,
            bpm: { min: bpmMin, median: bpmMedian, max: bpmMax },
            topProgressions: top10,
          },
        };
      }

      default:
        return { content: [{ type: "text", text: `Unknown tool: ${name}` }], isError: true };
    }
  } catch (err) {
    const message = err instanceof z.ZodError
      ? `Invalid input: ${err.errors.map((e) => `${e.path.join(".")}: ${e.message}`).join("; ")}`
      : err instanceof Error ? err.message : String(err);
    return { content: [{ type: "text", text: message }], isError: true };
  }
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Log to stderr so it doesn't interfere with stdio transport
  console.error(`TrackDraft Song MCP server running. Library: ${LIBRARY_DIR}`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});