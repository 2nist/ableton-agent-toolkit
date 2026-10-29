import { BI_TONAL_MATRIX, setBiTonalMatrix, type BiTonalMatrix } from "@platform/progression-engine";
import {
  STYLE_RECIPES,
  TRANSITION_CATALOG,
  setStyleRecipes,
  setTransitionCatalog,
  type StyleProfile,
  type TransitionModel,
} from "@drum/library";
import type { SongTables } from "../types/blueprint";
import { getHost, type TrackDraftHost } from "./host";

/**
 * The engine's editable tables, as FILES.
 *
 * Three tables shape a song — the colour matrix, the genre map and the drum
 * gesture catalog. They ship inside their packages (so the engine can never be
 * without one), but a writer who extends one should not have to rebuild, so an
 * edited table is a file next to the songs:
 *
 *   <library>/tables/trackdraft.colour.json
 *   <library>/tables/trackdraft.styles.json
 *   <library>/tables/trackdraft.transitions.json
 *
 * Read once at boot, BEFORE the first render, so nothing paints with the
 * shipped table and gets swapped underneath it. In a browser (no host) the same
 * data lives in localStorage, so the code above this layer never branches.
 *
 * Precedence is one line: package default → library file → this song. A song
 * may override individual entries (`song.tables`), and its override is merged
 * over the library table rather than replacing it — so a library edit still
 * reaches a song that overrides *something else*. The package copy is never
 * overwritten, which is what makes `reset` free and a corrupt file harmless.
 */

export type DataFileId = "colour" | "styles" | "transitions";

export interface DataFileSpec {
  id: DataFileId;
  label: string;
  /**
   * A `.json` file with the component in the NAME, not in the extension:
   * highlighting, diffing, validators and "open with" all keep working, while
   * `trackdraft.` still identifies it in a folder of JSON. Identity and version
   * live in the `format` field inside the file — an extension cannot say "v1".
   */
  filename: string;
  format: string;
  hint: string;
  /** The table as it stands right now (a loaded file included). */
  current(): unknown;
  apply(value: unknown): void;
  /** Tolerant shape check — enough to catch "that isn't a colour file". */
  valid(value: unknown): boolean;
  /** Merge an imported table into the current one: add and overwrite keys,
   *  keep everything the file doesn't mention. */
  merge(current: unknown, incoming: unknown): unknown;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const DATA_FILES: DataFileSpec[] = [
  {
    id: "colour",
    label: "Colour matrix",
    filename: "trackdraft.colour.json",
    format: "trackdraft.colour.v1",
    hint: "anchor family → flavour → { shift, quality, label }",
    current: () => BI_TONAL_MATRIX,
    apply: (value) => {
      setBiTonalMatrix(value as BiTonalMatrix);
    },
    valid: (value) =>
      isRecord(value) &&
      Object.values(value).every(
        (family) =>
          isRecord(family) &&
          Object.values(family).every(
            (recipe) =>
              isRecord(recipe) &&
              typeof recipe.shift === "number" &&
              typeof recipe.quality === "string" &&
              typeof recipe.label === "string",
          ),
      ),
    // Two levels: families, then flavours inside them. Importing one new
    // flavour must not delete the six that were already there.
    merge: (current, incoming) => {
      const base = { ...(current as Record<string, Record<string, unknown>>) };
      for (const [family, flavours] of Object.entries(incoming as Record<string, Record<string, unknown>>)) {
        base[family] = { ...(base[family] ?? {}), ...flavours };
      }
      return base;
    },
  },
  {
    id: "styles",
    label: "Genre map",
    filename: "trackdraft.styles.json",
    format: "trackdraft.styles.v1",
    hint: "genre → StyleProfile (energy, density, backbeat, feel, kit, harmony, tempo)",
    current: () => STYLE_RECIPES,
    apply: (value) => {
      setStyleRecipes(value as Record<string, StyleProfile>);
    },
    valid: (value) => isRecord(value) && Object.values(value).every((p) => isRecord(p) && typeof p.energy === "number"),
    merge: (current, incoming) => ({ ...(current as object), ...(incoming as object) }),
  },
  {
    id: "transitions",
    label: "Drum gestures",
    filename: "trackdraft.transitions.json",
    format: "trackdraft.transitions.v1",
    hint: "gesture model → named flavours the transition picker offers",
    current: () => TRANSITION_CATALOG,
    apply: (value) => {
      setTransitionCatalog(value as Record<TransitionModel, never[]>);
    },
    valid: (value) => isRecord(value) && Object.values(value).every((list) => Array.isArray(list)),
    // A flavour list is replaced per model — merging arrays element-wise would
    // interleave two different gestures into one nonsense list.
    merge: (current, incoming) => ({ ...(current as object), ...(incoming as object) }),
  },
];

/** The shipped tables, captured before any file can replace them. */
const SHIPPED: Record<DataFileId, unknown> = {
  colour: BI_TONAL_MATRIX,
  styles: STYLE_RECIPES,
  transitions: TRANSITION_CATALOG,
};

const overrideKey = (id: DataFileId) => `trackdraft-data-file:${id}`;

/** Where a table's current value came from, for the settings row. */
export type TableSource = "shipped" | "library" | "browser" | "song";

let sources: Record<DataFileId, TableSource> = {
  colour: "shipped",
  styles: "shipped",
  transitions: "shipped",
};

export function tableSource(id: DataFileId): TableSource {
  return sources[id];
}

/**
 * The LIBRARY layer — what the file (or browser storage) holds. Kept apart from
 * what is currently applied, because the applied table also carries the open
 * song's overrides and both have to be recomposable: apply a song, switch away,
 * and the library table must come back exactly.
 */
const BASE: Partial<Record<DataFileId, unknown>> = {};
let baseSource: Record<DataFileId, TableSource> = {
  colour: "shipped",
  styles: "shipped",
  transitions: "shipped",
};

/** The open song's entries, or nothing when it takes the library's tables. */
let songTables: SongTables = {};

/** Bumped on every recompute so views that read a table at render time know to
 *  re-read it (importing a flavour must add a chip, not need a reload). */
let version = 0;
const listeners = new Set<() => void>();

export function tablesVersion(): number {
  return version;
}

/** Subscribe to table changes; returns the unsubscribe. */
export function onTablesChanged(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The table in effect right now for one id (library + song, already merged). */
export function effectiveTable(id: DataFileId): unknown {
  const spec = DATA_FILES.find((s) => s.id === id);
  return spec?.current();
}

/** Recompute and apply every table from the two layers, then notify. */
function recompute(): void {
  for (const spec of DATA_FILES) {
    const base = BASE[spec.id] ?? SHIPPED[spec.id];
    const overlay = songTables[spec.id];
    spec.apply(overlay === undefined ? base : spec.merge(base, overlay));
    sources = { ...sources, [spec.id]: overlay !== undefined ? "song" : baseSource[spec.id] };
  }
  version += 1;
  for (const listener of [...listeners]) listener();
}

/**
 * Switch the song layer.
 *
 * Called whenever the open song changes — including to `null` (closing a song
 * must put the library's tables back, or one song's colour flavours would leak
 * into the next one opened).
 */
export function applySongTables(overrides?: SongTables | null): void {
  songTables = overrides ?? {};
  recompute();
}

/** Entries this song overrides, for the settings row. */
export function songTableOverrides(): SongTables {
  return songTables;
}

export interface LoadReport {
  loaded: DataFileId[];
  /** Files that existed but failed validation, with the reason. */
  skipped: { id: DataFileId; reason: string }[];
}

/**
 * Read every table from disk (or localStorage) and apply it.
 *
 * MUST be awaited before the first render: a table applied after paint means
 * the first view is drawn with the shipped values and then silently disagrees
 * with everything computed afterwards.
 */
export async function loadTables(hostOverride?: TrackDraftHost | null): Promise<LoadReport> {
  const report: LoadReport = { loaded: [], skipped: [] };
  const host = hostOverride === undefined ? getHost() : hostOverride;
  if (host?.tablesLoad) {
    let payload: Awaited<ReturnType<NonNullable<typeof host>["tablesLoad"]>>;
    try {
      payload = await host.tablesLoad();
    } catch {
      return report;
    }
    for (const spec of DATA_FILES) {
      const name = spec.filename;
      if (payload.errors?.[name]) {
        report.skipped.push({ id: spec.id, reason: payload.errors[name] });
        continue;
      }
      const data = payload.files?.[name];
      if (data === undefined) continue;
      if (!spec.valid(data)) {
        report.skipped.push({ id: spec.id, reason: "not a table of that kind — using the shipped one" });
        continue;
      }
      BASE[spec.id] = data;
      baseSource = { ...baseSource, [spec.id]: "library" };
      report.loaded.push(spec.id);
    }
    recompute();
    return report;
  }

  // Browser: no library folder, so the same data lives in localStorage.
  for (const spec of DATA_FILES) {
    try {
      const raw = localStorage.getItem(overrideKey(spec.id));
      if (!raw) continue;
      const parsed: unknown = JSON.parse(raw);
      if (!spec.valid(parsed)) continue;
      BASE[spec.id] = parsed;
      baseSource = { ...baseSource, [spec.id]: "browser" };
      report.loaded.push(spec.id);
    } catch {
      /* a bad override falls back to the shipped table */
    }
  }
  recompute();
  return report;
}

/** Write one table to the library folder (or localStorage in a browser). */
async function persist(spec: DataFileSpec, data: unknown, host: TrackDraftHost | null): Promise<void> {
  BASE[spec.id] = data;
  if (host?.tablesSave) {
    try {
      await host.tablesSave(spec.filename, data);
      baseSource = { ...baseSource, [spec.id]: "library" };
    } finally {
      // Even when the write failed the session has the table — apply it, then
      // let the caller report that it did not reach the library.
      recompute();
    }
    return;
  }
  try {
    localStorage.setItem(overrideKey(spec.id), JSON.stringify(data));
    baseSource = { ...baseSource, [spec.id]: "browser" };
  } catch {
    /* no storage in this environment — the session still has the table */
  }
  recompute();
}

/** Export the CURRENT table (a loaded file included) as a download. */
export function exportDataFile(spec: DataFileSpec): void {
  const payload = { format: spec.format, exportedAt: new Date().toISOString(), data: spec.current() };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = spec.filename;
  link.click();
  URL.revokeObjectURL(url);
}

export type ImportMode = "merge" | "replace";

export interface ImportResult {
  ok: boolean;
  message: string;
  mode?: ImportMode;
}

export interface MergedImport {
  ok: boolean;
  message: string;
  value?: unknown;
}

/**
 * Parse a file and fold it into `base` — the pure half of an import, shared by
 * the library scope (`base` = the library table) and the song scope (`base` =
 * what that song already overrides).
 */
export function mergeFromFile(spec: DataFileSpec, text: string, mode: ImportMode, base: unknown): MergedImport {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, message: "that file is not JSON" };
  }
  const data = isRecord(parsed) && "data" in parsed ? (parsed as { data: unknown }).data : parsed;
  if (!spec.valid(data)) {
    return { ok: false, message: `that file does not look like a ${spec.label.toLowerCase()} table` };
  }
  const value = mode === "replace" ? data : spec.merge(base, data);
  if (!spec.valid(value)) {
    return { ok: false, message: `merging that file produced an invalid ${spec.label.toLowerCase()} table` };
  }
  return { ok: true, message: mode === "merge" ? "merged" : "replaced", value };
}

/**
 * Import a file into the LIBRARY table.
 *
 * `merge` (the default) adds and overwrites keys and keeps everything the file
 * doesn't mention — which is what "load my new flavour" means. `replace` swaps
 * the table for exactly the file, for when the file IS the table.
 */
export async function importDataFile(
  spec: DataFileSpec,
  text: string,
  mode: ImportMode = "merge",
  hostOverride?: TrackDraftHost | null,
): Promise<ImportResult> {
  // Merge over the LIBRARY layer. Merging over the effective table would fold a
  // song's own entries into the shared file, silently promoting one song's
  // colour flavours to every song.
  const merged = mergeFromFile(spec, text, mode, BASE[spec.id] ?? SHIPPED[spec.id]);
  if (!merged.ok) return { ok: false, message: merged.message };
  const next = merged.value;
  try {
    await persist(spec, next, hostOverride === undefined ? getHost() : hostOverride);
  } catch {
    return { ok: true, message: "imported for this session, but could not be written to the library", mode };
  }
  return { ok: true, message: `${mode === "merge" ? "merged" : "replaced"} ${spec.label.toLowerCase()}`, mode };
}

/** Forget the file and go back to the table that ships. */
export async function resetDataFile(spec: DataFileSpec, hostOverride?: TrackDraftHost | null): Promise<void> {
  const host = hostOverride === undefined ? getHost() : hostOverride;
  if (host?.tablesDelete) {
    try {
      await host.tablesDelete(spec.filename);
    } catch {
      /* nothing to delete is the same as deleted */
    }
  } else {
    try {
      localStorage.removeItem(overrideKey(spec.id));
    } catch {
      /* ignore */
    }
  }
  delete BASE[spec.id];
  baseSource = { ...baseSource, [spec.id]: "shipped" };
  recompute();
}

/**
 * Fold one table change into a song's override set.
 *
 * Pure — the caller writes the result into `song.tables` and the store re-applies
 * it. Entries are stored exactly as given (merged with what the song already
 * overrode, never with the library table), so a song's file stays as small as
 * the change it makes, and a later library edit still reaches it.
 */
export function songTablesWith(
  current: SongTables | undefined,
  id: DataFileId,
  value: unknown | undefined,
): SongTables {
  const next: SongTables = { ...(current ?? {}) };
  if (value === undefined) delete next[id];
  else next[id] = value;
  return next;
}
