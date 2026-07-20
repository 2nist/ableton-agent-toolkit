import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useSongStore } from "../../store/songStore";
import { parseImportedSong } from "../../lib/exportImport";

interface CatalogEntry {
  file: string;
  title: string;
  sections: number;
}

/**
 * Dev-only review tool for the real Beatles catalog (`scripts/output/
 * catalog/`, gitignored build output from the JCRD+lyrics ingestion
 * pipeline) — lists all ~179 songs and imports any of them with one
 * click, reusing the exact same validation/store path the existing
 * "Import JSON…" file picker already uses (`parseImportedSong` +
 * `importSong`), just fed by `fetch` against the dev-server-only
 * `/__catalog` endpoint (see `vite.config.ts`) instead of a `File`.
 * Renders nothing in a production build — there is no `/__catalog`
 * endpoint to fetch from there.
 */
export default function CatalogBrowser() {
  const [entries, setEntries] = useState<CatalogEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [loadingFile, setLoadingFile] = useState<string | null>(null);
  const importSong = useSongStore((s) => s.importSong);
  const navigate = useNavigate();

  useEffect(() => {
    fetch("/__catalog/index")
      .then((res) => res.json())
      .then((data: CatalogEntry[]) => setEntries(data))
      .catch(() => setEntries([]));
  }, []);

  async function handlePick(entry: CatalogEntry) {
    setLoadingFile(entry.file);
    setError(null);
    try {
      const res = await fetch(`/__catalog/file?name=${encodeURIComponent(entry.file)}`);
      if (!res.ok) throw new Error(`Failed to load ${entry.file}`);
      const raw = await res.json();
      const song = parseImportedSong(raw);
      importSong(song);
      navigate(`/song/${song.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to import catalog song.");
    } finally {
      setLoadingFile(null);
    }
  }

  if (entries === null) return null;
  if (entries.length === 0) return null; // no catalog directory found -- nothing to browse

  const filtered = entries.filter((e) => e.title.toLowerCase().includes(filter.toLowerCase()));

  return (
    <details className="border border-edge rounded">
      <summary className="cursor-pointer p-3 text-sm font-medium text-inkMuted hover:text-ink">
        Browse real catalog ({entries.length} songs)
      </summary>
      <div className="border-t border-edge p-3 space-y-2">
        <input
          className="w-full bg-panel border border-edge rounded px-3 py-2 text-sm"
          placeholder="Filter by title…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        {error && <p className="text-xs text-red-400">{error}</p>}
        <ul className="divide-y divide-edge max-h-80 overflow-y-auto">
          {filtered.map((entry) => (
            <li key={entry.file} className="flex items-center justify-between py-2">
              <div>
                <div className="text-sm">{entry.title}</div>
                <div className="text-xs text-inkMuted">{entry.sections} sections</div>
              </div>
              <button
                className="text-xs border border-edge rounded px-2 py-1 text-inkMuted hover:text-ink hover:bg-panelAlt disabled:opacity-50"
                disabled={loadingFile === entry.file}
                onClick={() => handlePick(entry)}
              >
                {loadingFile === entry.file ? "Loading…" : "Open"}
              </button>
            </li>
          ))}
          {filtered.length === 0 && <li className="py-2 text-xs text-inkMuted">No matches.</li>}
        </ul>
      </div>
    </details>
  );
}
