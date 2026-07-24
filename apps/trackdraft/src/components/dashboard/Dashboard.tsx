import { useState, useMemo, useEffect, useCallback } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useSongStore } from "../../store/songStore";
import { useDirectoryStore, type DirectoryEntry } from "../../store/directoryStore";
import { computeConfidence } from "../../lib/confidence";
import { parseFile } from "../../lib/parsers";

import Sidebar from "./Sidebar";
import ActionBar from "./ActionBar";
import FilterBar, { type Filters, defaultFilters } from "./FilterBar";
import SongTable, { type SortKey, type SortDir } from "./SongTable";
import TemplatePicker from "./TemplatePicker";
import DirSetupModal from "./DirSetupModal";

const TYPE_BADGES: Record<string, { label: string; color: string }> = {
  blueprint: { label: "Blueprint", color: "bg-accent/20 text-accent" },
  audio: { label: "Audio", color: "bg-amber-400/20 text-amber-400" },
  midi: { label: "MIDI", color: "bg-emerald-400/20 text-emerald-400" },
  lyrics: { label: "Lyrics", color: "bg-blue-400/20 text-blue-400" },
  ableton: { label: "Ableton", color: "bg-purple-400/20 text-purple-400" },
  directory: { label: "Folder", color: "bg-inkMuted/20 text-inkMuted" },
  unknown: { label: "File", color: "bg-inkMuted/10 text-inkMuted" },
};

type ActiveView = "songs" | "templates";

export default function Dashboard() {
  const songs = useSongStore((s) => s.songs);
  const importSong = useSongStore((s) => s.importSong);
  const dirs = useDirectoryStore((s) => s.dirs);
  const listings = useDirectoryStore((s) => s.listings);
  const loadListing = useDirectoryStore((s) => s.loadListing);
  const dirLoading = useDirectoryStore((s) => s.loading);
  const dirError = useDirectoryStore((s) => s.error);
  const navigate = useNavigate();

  const [activeView, setActiveView] = useState<ActiveView>("songs");
  const [selectedDir, setSelectedDir] = useState<string | null>(null);
  const [showDirSetup, setShowDirSetup] = useState(false);
  const [filters, setFilters] = useState<Filters>(defaultFilters);
  const [sortKey, setSortKey] = useState<SortKey>("updatedAt");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [importingBulk, setImportingBulk] = useState(false);

  // Auto-load built-in dirs if none configured
  useEffect(() => {
    if (dirs.length === 0) {
      const store = useDirectoryStore.getState();
      store.addDirectory({
        path: "scripts/output/catalog",
        label: "Beatles Catalog",
        isDefault: true,
      });
      store.addDirectory({
        path: "scripts/output",
        label: "Lalo Chezia",
        isDefault: false,
      });
      // Add your own local directories via the DirSetupModal (gear icon in sidebar)
      // or by adding entries below following the same pattern as the Beatles/Lalo dirs.
      // Example:
      // store.addDirectory({ path: "/Users/you/corpus", label: "My Corpus", isDefault: false });
    }
  }, [dirs.length]);

  // When a directory is selected, load its listing
  useEffect(() => {
    if (selectedDir && !listings[selectedDir]) {
      loadListing(selectedDir);
    }
  }, [selectedDir, listings, loadListing]);

  // Parse and import any file from the directory browser
  const importDirFile = useCallback(
    async (dirPath: string, entry: DirectoryEntry) => {
      const result = await parseFile(dirPath, entry);
      if (!result.ok) throw new Error(result.error);
      importSong(result.song);
      navigate(`/song/${result.song.id}`);
    },
    [importSong, navigate],
  );

  function handleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  }

  // Determine which view to show in the main area
  const showDirListing = selectedDir !== null;
  const dirEntries: DirectoryEntry[] =
    selectedDir ? (listings[selectedDir] ?? []) : [];
  const isLoadingDir = selectedDir ? dirLoading === selectedDir : false;
  const dirLabel = selectedDir ? (dirs.find((d) => d.path === selectedDir)?.label ?? selectedDir) : "";

  // Apply filters (only relevant when showing localStorage songs, not dir listing)
  const filteredSongs = useMemo(() => {
    return songs.filter((song) => {
      if (filters.search) {
        const q = filters.search.toLowerCase();
        const matchTitle = song.title.toLowerCase().includes(q);
        const matchArtist = song.artist?.toLowerCase().includes(q);
        const matchConcept = song.concept?.toLowerCase().includes(q);
        if (!matchTitle && !matchArtist && !matchConcept) return false;
      }
      if (!filters.keys.has(song.key)) return false;
      if (!filters.scales.has(song.scale)) return false;
      const conf = computeConfidence(song);
      if (!filters.confidence.has(conf.level)) return false;
      if (song.bpm < filters.bpmMin || song.bpm > filters.bpmMax) return false;
      if (filters.hasSections && song.sections.length === 0) return false;
      return true;
    });
  }, [songs, filters]);

  // Filter dir entries by search only
  const filteredDirEntries = useMemo(() => {
    if (!filters.search) return dirEntries;
    const q = filters.search.toLowerCase();
    return dirEntries.filter((e) => e.title.toLowerCase().includes(q));
  }, [dirEntries, filters.search]);

  // Confidence stats for header
  const confidenceStats = useMemo(() => {
    const counts = { complete: 0, strong: 0, partial: 0, draft: 0, empty: 0 };
    for (const song of filteredSongs) {
      const conf = computeConfidence(song);
      counts[conf.level]++;
    }
    return counts;
  }, [filteredSongs]);

  // Bulk import all parseable files in the current directory listing
  async function handleBulkImport() {
    if (!selectedDir) return;
    setImportingBulk(true);
    const importable = filteredDirEntries.filter(
      (e) => e.type === "blueprint" || e.type === "jcrd" || e.type === "midi" || e.type === "audio" || e.type === "lyrics",
    );
    let imported = 0;
    let skipped = 0;
    for (const entry of importable) {
      try {
        const result = await parseFile(selectedDir, entry);
        if (result.ok) {
          importSong(result.song);
          imported++;
        } else {
          skipped++;
        }
      } catch {
        skipped++;
      }
    }
    setImportingBulk(false);
    alert(`Imported ${imported} song(s). ${skipped > 0 ? `Skipped ${skipped} file(s) with errors.` : ""}`);
  }

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Sidebar */}
      <Sidebar
        selectedDir={selectedDir}
        activeView={activeView}
        onSelectDir={(dir) => {
          setSelectedDir(dir);
          setActiveView("songs");
        }}
        onSelectView={setActiveView}
        onManageDirs={() => setShowDirSetup(true)}
      />

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-w-0 bg-canvas overflow-hidden">
        {activeView === "templates" ? (
          <TemplatePicker />
        ) : showDirListing ? (
          /* Directory listing view */
          <div className="flex flex-col flex-1 min-h-0">
            <div className="shrink-0">
              <header className="flex items-center justify-between px-4 py-2 border-b border-edge">
                <div className="flex items-center gap-2">
                  <button
                    className="text-inkMuted text-xs hover:text-ink"
                    onClick={() => setSelectedDir(null)}
                  >
                    ← Back
                  </button>
                  <h1 className="text-sm font-semibold">{dirLabel}</h1>
                </div>
                <div className="flex items-center gap-3 text-[10px] text-inkMuted">
                  <span>
                    {isLoadingDir ? "Loading…" : `${filteredDirEntries.length} files`}
                  </span>
                  <button
                    className="text-xs bg-panelAlt border border-edge text-inkMuted hover:text-ink px-2 py-0.5 rounded disabled:opacity-40"
                    onClick={handleBulkImport}
                    disabled={importingBulk || isLoadingDir}
                  >
                    {importingBulk ? "Importing…" : "Import All"}
                  </button>
                  <Link to="/ui-kit-sandbox" className="hover:text-ink">
                    UI Kit
                  </Link>
                </div>
              </header>

              {/* Simple search for dir listings */}
              <div className="px-3 py-2 border-b border-edge">
                <input
                  className="w-full bg-panel border border-edge rounded px-2 py-1 text-xs"
                  placeholder="Filter by title…"
                  value={filters.search}
                  onChange={(e) => setFilters({ ...filters, search: e.target.value })}
                />
              </div>
            </div>

            <div className="flex-1 overflow-y-auto">
              {dirError && (
                <div className="p-4 text-center">
                  <div className="text-sm text-red-400 mb-1">Failed to load directory</div>
                  <div className="text-xs text-inkMuted">{dirError}</div>
                </div>
              )}
              {!dirError && isLoadingDir && (
                <div className="p-4 text-center text-inkMuted text-sm">Loading directory…</div>
              )}
              {!dirError && !isLoadingDir && filteredDirEntries.length === 0 && (
                <div className="p-4 text-center text-inkMuted text-sm">
                  No files found.
                </div>
              )}
              {!dirError && !isLoadingDir && filteredDirEntries.length > 0 && (
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-panel border-b border-edge">
                    <tr>
                      <th className="text-left px-3 py-2 text-[10px] uppercase tracking-wider font-semibold text-inkMuted">
                        Name
                      </th>
                      <th className="text-left px-3 py-2 text-[10px] uppercase tracking-wider font-semibold text-inkMuted w-16">
                        Type
                      </th>
                      <th className="w-20 px-3 py-2" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-edge">
                    {filteredDirEntries.map((entry) => {
                      const typeBadge = TYPE_BADGES[entry.type ?? "unknown"] ?? TYPE_BADGES.unknown;
                      const hasParser = entry.type === "blueprint" || entry.type === "jcrd" || entry.type === "midi" || entry.type === "audio" || entry.type === "lyrics";
                      const isDir = entry.type === "directory";
                      return (
                        <tr
                          key={entry.file}
                          className={`${
                            hasParser || isDir ? "hover:bg-panelAlt/50 cursor-pointer" : "opacity-50"
                          }`}
                          onClick={() => {
                            if (hasParser) {
                              importDirFile(selectedDir!, entry);
                            } else if (isDir && selectedDir) {
                              // Navigate into subdirectory
                              const subPath = selectedDir.endsWith("/")
                                ? `${selectedDir}${entry.file}`
                                : `${selectedDir}/${entry.file}`;
                              setSelectedDir(subPath);
                            }
                          }}
                        >
                          <td className="px-3 py-1.5">
                            <span className="text-xs font-medium">
                              {isDir ? "📁 " : ""}{entry.title}
                            </span>
                            <span className="text-[10px] text-inkMuted ml-2">{entry.file}</span>
                          </td>
                          <td className="px-3 py-1.5">
                            <span className={`text-[9px] px-1.5 py-0.5 rounded ${typeBadge.color}`}>
                              {typeBadge.label}
                            </span>
                          </td>
                          <td className="px-3 py-1.5">
                            {hasParser ? (
                              <button
                                className="text-[10px] text-inkMuted hover:text-accent px-1"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  importDirFile(selectedDir!, entry);
                                }}
                              >
                                Import
                              </button>
                            ) : entry.type !== "directory" ? (
                              <span className="text-[9px] text-inkMuted/50">Planned</span>
                            ) : null}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        ) : (
          /* All Songs view (localStorage) */
          <>
            <div className="shrink-0">
              <header className="flex items-center justify-between px-4 py-2 border-b border-edge">
                <h1 className="text-sm font-semibold">TrackDraft</h1>
                <div className="flex items-center gap-3 text-[10px] text-inkMuted">
                  <span>{songs.length} songs</span>
                  <span className="flex items-center gap-1">
                    <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-400" />
                    {confidenceStats.complete}
                    <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-400" />
                    {confidenceStats.strong}
                    <span className="inline-block w-1.5 h-1.5 rounded-full bg-orange-400" />
                    {confidenceStats.partial}
                    <span className="inline-block w-1.5 h-1.5 rounded-full bg-red-400" />
                    {confidenceStats.draft}
                    <span className="inline-block w-1.5 h-1.5 rounded-full bg-neutral-500" />
                    {confidenceStats.empty}
                  </span>
                  <Link to="/ui-kit-sandbox" className="hover:text-ink">
                    UI Kit
                  </Link>
                </div>
              </header>

              <ActionBar />

              <FilterBar filters={filters} onChange={setFilters} />
            </div>

            <SongTable
              songs={filteredSongs}
              sortKey={sortKey}
              sortDir={sortDir}
              onSort={handleSort}
            />
          </>
        )}
      </div>

      {/* Directory Setup Modal */}
      <DirSetupModal open={showDirSetup} onClose={() => setShowDirSetup(false)} />
    </div>
  );
}