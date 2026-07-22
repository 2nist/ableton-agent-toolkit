import DirectoryTree from "./DirectoryTree";

interface SidebarProps {
  selectedDir: string | null;
  activeView: "songs" | "templates";
  onSelectDir: (path: string | null) => void;
  onSelectView: (view: "songs" | "templates") => void;
  onManageDirs: () => void;
}

export default function Sidebar({
  selectedDir,
  activeView,
  onSelectDir,
  onSelectView,
  onManageDirs,
}: SidebarProps) {
  return (
    <aside className="w-[200px] shrink-0 border-r border-edge bg-panel flex flex-col min-h-0">
      {/* Navigation */}
      <nav className="px-2 py-2 space-y-0.5 shrink-0">
        <button
          className={`w-full text-left text-xs px-2 py-1 rounded ${
            activeView === "songs" ? "bg-panelAlt text-ink font-medium" : "text-inkMuted hover:text-ink hover:bg-panelAlt/50"
          }`}
          onClick={() => onSelectView("songs")}
        >
          Songs
        </button>
        <button
          className={`w-full text-left text-xs px-2 py-1 rounded ${
            activeView === "templates" ? "bg-panelAlt text-ink font-medium" : "text-inkMuted hover:text-ink hover:bg-panelAlt/50"
          }`}
          onClick={() => onSelectView("templates")}
        >
          Templates
        </button>
      </nav>

      <div className="border-t border-edge" />

      {/* Directories (scrollable, takes remaining space) */}
      <div className="flex-1 overflow-y-auto px-2 py-2">
        <DirectoryTree
          selectedDir={selectedDir}
          onSelectDir={onSelectDir}
          onManageDirs={onManageDirs}
        />
      </div>

      {/* Import Zone at bottom */}
      <div className="border-t border-edge shrink-0">
        <ImportZoneSidebar />
      </div>
    </aside>
  );
}

/** Compact sidebar variant of the import drop zone. */
function ImportZoneSidebar() {
  const targets = [
    { icon: "🎵", label: "Audio", status: "soon" as const },
    { icon: "🎹", label: "MIDI", status: "soon" as const },
    { icon: "📝", label: "Lyrics", status: "planned" as const },
    { icon: "📦", label: "Ableton", status: "planned" as const },
  ];

  return (
    <div className="px-2 py-2 space-y-1">
      <span className="text-[9px] font-semibold text-inkMuted uppercase tracking-wider block">
        Import (drop)
      </span>
      <div className="grid grid-cols-2 gap-1">
        {targets.map((t) => (
          <div
            key={t.label}
            className="border border-edge border-dashed rounded px-1 py-1.5 text-center hover:border-inkMuted transition-colors cursor-default"
            onDrop={(e) => e.preventDefault()}
            onDragOver={(e) => e.preventDefault()}
          >
            <div className="text-sm">{t.icon}</div>
            <div className="text-[9px] text-inkMuted">{t.label}</div>
            <div
              className={`text-[7px] px-1 rounded mt-0.5 inline-block ${
                t.status === "soon" ? "bg-amber-400/20 text-amber-400" : "bg-neutral-500/20 text-neutral-500"
              }`}
            >
              {t.status === "soon" ? "Soon" : "Planned"}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
