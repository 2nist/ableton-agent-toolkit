import { useRef, useState, useSyncExternalStore } from "react";
import {
  DATA_FILES,
  exportDataFile,
  importDataFile,
  mergeFromFile,
  onTablesChanged,
  resetDataFile,
  songTablesWith,
  tableSource,
  tablesVersion,
  type DataFileSpec,
  type ImportMode,
} from "../../lib/dataFiles";
import { useSongStore } from "../../store/songStore";
import TapeLabel from "../common/TapeLabel";

const SOURCE_LABELS: Record<string, string> = {
  shipped: "shipped",
  library: "file",
  browser: "browser",
  song: "song",
};

const SOURCE_TITLES: Record<string, string> = {
  shipped: "the table that ships with the app",
  library: "loaded from <library>/tables/ — travels with your library",
  browser: "saved in this browser's storage",
  song: "this song overrides it — merged over the library table while the song is open",
};

/**
 * Settings → Data files.
 *
 * The engine's three editable tables live in `<library>/tables/*.json` and are
 * loaded at boot; this is the surface: export what is running, edit the file,
 * import it back, and reset to the shipped table.
 *
 * Import defaults to MERGE — "load my new flavour" must not delete the six that
 * were already there. `replace` is offered for when the file *is* the table.
 *
 * Scope decides where an import LANDS: `library` writes the shared table file,
 * `song` writes one song's `tables` override, which is merged over the library
 * table only while that song is open.
 *
 * Saved beats are a file too (`tables/beats.json`), but they belong next to the
 * drums, so they are exported and imported from the groove shelf.
 */
type Scope = "library" | "song";

export default function DataFilesSection() {
  const [message, setMessage] = useState<string | null>(null);
  const [mode, setMode] = useState<ImportMode>("merge");
  const [scope, setScope] = useState<Scope>("library");
  // Re-render when a table changes under us: an imported flavour must appear as
  // a chip immediately, and a badge must stop saying "shipped".
  useSyncExternalStore(onTablesChanged, tablesVersion);
  const sources = Object.fromEntries(DATA_FILES.map((spec) => [spec.id, tableSource(spec.id)]));
  const inputs = useRef<Record<string, HTMLInputElement | null>>({});

  const song = useSongStore((state) => state.songs.find((s) => s.id === state.currentSongId) ?? null);
  const updateCurrentSong = useSongStore((state) => state.updateCurrentSong);

  const writeSongTable = (id: DataFileSpec["id"], value: unknown | undefined) => {
    updateCurrentSong((current) => ({ ...current, tables: songTablesWith(current.tables, id, value) }));
  };

  const onFile = async (spec: DataFileSpec, file: File | undefined) => {
    if (!file) return;
    const text = await file.text();
    if (scope === "song") {
      if (!song) {
        setMessage("open a song before importing into one");
        return;
      }
      // Merge over what the SONG already overrides — not over the library table,
      // or one song's palette would be baked into every song's fallback.
      const merged = mergeFromFile(spec, text, mode, song.tables?.[spec.id] ?? {});
      if (!merged.ok) {
        setMessage(`${spec.label}: ${merged.message}`);
        return;
      }
      writeSongTable(spec.id, merged.value);
      setMessage(`${spec.label}: ${merged.message} for “${song.title}” only`);
      return;
    }
    const result = await importDataFile(spec, text, mode);
    setMessage(`${spec.label}: ${result.message}`);
  };

  return (
    <section className="border border-edge rounded-lg bg-panel overflow-hidden">
      <header className="flex items-center gap-2 px-3 py-2 border-b border-edge/70">
        <TapeLabel size="md" className="text-3xs font-mono uppercase tracking-widest text-inkMuted">Data files</TapeLabel>
        <span className="text-[9px] font-mono text-inkMuted/40 flex-1">
          the tables the engine reads — export, edit, import
        </span>
        <label className="text-[9px] font-mono text-inkMuted/60 flex items-center gap-1">
          into
          <select
            value={scope}
            onChange={(event) => setScope(event.target.value as Scope)}
            className="bg-panel border border-edge/70 rounded px-1 py-0.5 text-[9px] font-mono text-ink"
            title="library = the shared table every song reads; this song = an override merged over it while that song is open"
          >
            <option value="library">library</option>
            <option value="song">{song ? "this song" : "this song (none open)"}</option>
          </select>
        </label>
        <label className="text-[9px] font-mono text-inkMuted/60 flex items-center gap-1">
          import as
          <select
            value={mode}
            onChange={(event) => setMode(event.target.value as ImportMode)}
            className="bg-panel border border-edge/70 rounded px-1 py-0.5 text-[9px] font-mono text-ink"
            title="merge adds and overwrites the entries the file names; replace swaps the whole table"
          >
            <option value="merge">merge</option>
            <option value="replace">replace</option>
          </select>
        </label>
        {message && <span className="text-[9px] font-mono text-inkMuted max-w-[16rem] truncate" title={message}>{message}</span>}
      </header>
      <div className="p-3 space-y-1.5">
        {DATA_FILES.map((spec) => (
          <div key={spec.id} className="flex items-baseline gap-2 px-1.5 py-1 rounded hover:bg-panelAlt/40">
            <span className="text-xs text-ink w-32 shrink-0">{spec.label}</span>
            <span className="text-[10px] text-inkMuted/60 flex-1 truncate" title={spec.hint}>
              {spec.hint}
            </span>
            <span
              className={`text-[9px] font-mono uppercase tracking-wider ${sources[spec.id] === "shipped" ? "text-inkMuted/40" : "text-track/80"}`}
              title={SOURCE_TITLES[sources[spec.id]]}
            >
              {SOURCE_LABELS[sources[spec.id]]}
            </span>
            {song?.tables?.[spec.id] !== undefined && (
              <button
                type="button"
                className="border border-edge/70 rounded px-2 py-0.5 text-[10px] font-mono text-inkMuted hover:text-ink"
                onClick={() => {
                  writeSongTable(spec.id, undefined);
                  setMessage(`${spec.label}: “${song.title}” is back on the library table`);
                }}
                title={`“${song.title}” overrides this table — drop the override and use the library's`}
              >
                song ✕
              </button>
            )}
            <button
              type="button"
              className="border border-edge/70 rounded px-2 py-0.5 text-[10px] font-mono text-accent/80 hover:text-accent"
              onClick={() => exportDataFile(spec)}
              title={`Download ${spec.filename}`}
            >
              export
            </button>
            <button
              type="button"
              className="border border-edge/70 rounded px-2 py-0.5 text-[10px] font-mono text-accent/80 hover:text-accent"
              onClick={() => inputs.current[spec.id]?.click()}
              title={`Import a ${spec.label.toLowerCase()} file (${mode}) — applies immediately`}
            >
              import
            </button>
            <button
              type="button"
              className="border border-edge/70 rounded px-2 py-0.5 text-[10px] font-mono text-inkMuted hover:text-ink disabled:opacity-40"
              disabled={sources[spec.id] === "shipped"}
              onClick={() => {
                void resetDataFile(spec).then(() => setMessage(`${spec.label}: back to the shipped table`));
              }}
              title="Delete the table file and go back to the one that ships"
            >
              reset
            </button>
            <input
              ref={(node) => {
                inputs.current[spec.id] = node;
              }}
              type="file"
              accept=".json,application/json"
              className="hidden"
              onChange={(event) => {
                void onFile(spec, event.target.files?.[0]);
                event.target.value = "";
              }}
            />
          </div>
        ))}
      </div>
    </section>
  );
}
