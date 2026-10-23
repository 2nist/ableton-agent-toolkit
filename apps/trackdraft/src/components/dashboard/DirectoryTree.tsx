import { useEffect } from "react";
import { useDirectoryStore, type DirectoryConfig } from "../../store/directoryStore";
import TapeLabel from "../common/TapeLabel";

interface DirectoryTreeProps {
  selectedDir: string | null;
  onSelectDir: (path: string | null) => void;
  onManageDirs: () => void;
}

export default function DirectoryTree({ selectedDir, onSelectDir, onManageDirs }: DirectoryTreeProps) {
  const dirs = useDirectoryStore((s) => s.dirs);
  const listings = useDirectoryStore((s) => s.listings);
  const loading = useDirectoryStore((s) => s.loading);
  const loadListing = useDirectoryStore((s) => s.loadListing);

  // Auto-load listings for any dirs that don't have them yet
  useEffect(() => {
    for (const dir of dirs) {
      if (!listings[dir.path]) {
        loadListing(dir.path);
      }
    }
  }, [dirs, listings, loadListing]);

  const totalSongs = Object.values(listings).reduce((sum, entries) => sum + entries.length, 0);

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between px-1">
        <TapeLabel size="md" tilt="none" className="text-xs font-semibold text-inkMuted uppercase tracking-wider">
          Directories
        </TapeLabel>
        <button
          className="text-xs text-inkMuted hover:text-ink px-1"
          onClick={onManageDirs}
          title="Manage directories"
        >
          ⚙
        </button>
      </div>

      {/* All Songs pseudo-entry */}
      <button
        className={`w-full text-left text-sm px-2 py-1 rounded flex items-center justify-between ${
          selectedDir === null ? "bg-panelAlt text-ink" : "text-inkMuted hover:text-ink hover:bg-panelAlt/50"
        }`}
        onClick={() => onSelectDir(null)}
      >
        <span>All Songs</span>
        <span className="text-xs text-inkMuted">{totalSongs}</span>
      </button>

      {/* Individual directories */}
      {dirs.map((dir) => (
        <DirRow
          key={dir.path}
          dir={dir}
          isSelected={selectedDir === dir.path}
          isLoading={loading === dir.path}
          entries={listings[dir.path] ?? []}
          onSelect={() => onSelectDir(dir.path)}
        />
      ))}

      {/* Add directory button */}
      <button
        className="w-full text-left text-xs text-inkMuted hover:text-ink px-2 py-1 rounded hover:bg-panelAlt/50 flex items-center gap-1"
        onClick={onManageDirs}
      >
        <span className="text-accent">+</span>
        <span>Add Directory</span>
      </button>
    </div>
  );
}

function DirRow({
  dir,
  isSelected,
  isLoading,
  entries,
  onSelect,
}: {
  dir: DirectoryConfig;
  isSelected: boolean;
  isLoading: boolean;
  entries: { file: string; title: string }[];
  onSelect: () => void;
}) {
  return (
    <button
      className={`w-full text-left text-sm px-2 py-1 rounded flex items-center justify-between ${
        isSelected ? "bg-panelAlt text-ink" : "text-inkMuted hover:text-ink hover:bg-panelAlt/50"
      }`}
      onClick={onSelect}
    >
      <div className="flex items-center gap-1.5 min-w-0">
        <span className="text-xs shrink-0">{dir.isDefault ? "⭐" : "📁"}</span>
        <span className="truncate">{dir.label}</span>
      </div>
      <span className="text-xs text-inkMuted shrink-0">
        {isLoading ? "…" : entries.length}
      </span>
    </button>
  );
}