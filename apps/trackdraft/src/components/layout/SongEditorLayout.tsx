import { NavLink, Outlet, useLocation, useNavigate, useParams } from "react-router-dom";
import { useEffect, type ReactNode } from "react";
import { useSongStore } from "../../store/songStore";
import { useDockStore } from "../../store/dockStore";
import { classifySong } from "../../lib/classification";
import SongInfoPanel from "../details/SongInfoPanel";

const TABS = [
  { to: "studio", label: "Studio" },
  { to: "structure", label: "Structure" },
  { to: "harmony", label: "Harmony" },
  { to: "drums", label: "Drums" },
  { to: "lyrics", label: "Lyrics" },
];

type DockTab = { id: "info" | "primary" | "tools" | "layers"; label: string; node: ReactNode };

/** Horizontal tab strip for the dock — shared by the right sidebar
 *  (Structure) and the bottom dock bar (everything else). */
function DockTabStrip({
  tabs,
  activePanel,
  onSelect,
}: {
  tabs: DockTab[];
  activePanel: string;
  onSelect: (id: DockTab["id"]) => void;
}) {
  return (
    <div className="flex gap-1 px-3 pt-0 border-b border-edge shrink-0">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          className={`text-[11px] px-2 py-1 border-b-2 -mb-px ${
            activePanel === tab.id ? "border-accent text-ink" : "border-transparent text-inkMuted hover:text-ink"
          }`}
          onClick={() => onSelect(tab.id)}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

export default function SongEditorLayout() {
  const { songId } = useParams<{ songId: string }>();
  const navigate = useNavigate();
  const songs = useSongStore((s) => s.songs);
  const openSong = useSongStore((s) => s.openSong);
  const canUndo = useSongStore((s) => s.canUndo());
  const canRedo = useSongStore((s) => s.canRedo());
  const undo = useSongStore((s) => s.undo);
  const redo = useSongStore((s) => s.redo);

  const setInfo = useDockStore((s) => s.setInfo);
  const dockInfo = useDockStore((s) => s.info);
  const dockPrimary = useDockStore((s) => s.primary);
  const dockTools = useDockStore((s) => s.tools);
  const dockLayers = useDockStore((s) => s.layers);
  const activePanel = useDockStore((s) => s.activePanel);
  const setActivePanel = useDockStore((s) => s.setActivePanel);

  // Which tab is showing decides where the dock lives: Structure keeps the
  // right sidebar, every other tab gets the bottom dock bar.
  const location = useLocation();
  const activeTab = TABS.find((t) => location.pathname.endsWith(`/${t.to}`))?.to ?? "studio";
  const isStructure = activeTab === "structure";
  const isHarmony = activeTab === "harmony";

  // Dock tab order is Menu → Tools → Layers → Info: a tab's main menu first
  // (Harmony only, today), its selection tools second, its secondary
  // settings panel third (Harmony's Layers — Bass/Color), and song Info
  // last — Info alone when a tab has nothing more specific (Studio,
  // Structure).
  const dockTabs: DockTab[] = [
    ...(dockPrimary ? [{ id: "primary" as const, label: "Menu", node: dockPrimary }] : []),
    ...(dockTools ? [{ id: "tools" as const, label: "Tools", node: dockTools }] : []),
    ...(dockLayers ? [{ id: "layers" as const, label: "Layers", node: dockLayers }] : []),
    { id: "info" as const, label: "Info", node: dockInfo },
  ];
  // Harmony's Tools live in a right sidebar; keep them out of the bottom
  // bar so the dock there reads Menu → Layers → Info while still spanning
  // full width.
  const bottomTabs = isHarmony ? dockTabs.filter((t) => t.id !== "tools") : dockTabs;
  const activeNode = bottomTabs.find((t) => t.id === activePanel)?.node ?? dockInfo;

  const song = songs.find((s) => s.id === songId);

  useEffect(() => {
    if (songId) openSong(songId);
  }, [songId, openSong]);

  // Song Info is registered once per song-editor mount and never cleared —
  // it's available on every tab, unlike `tools` which each tab owns.
  useEffect(() => {
    setInfo(<SongInfoPanel />);
  }, [setInfo]);

  if (!song) {
    return (
      <div className="p-4">
        <p className="text-inkMuted">Song not found.</p>
        <button className="text-accent text-sm mt-2" onClick={() => navigate("/")}>
          ← Back to Dashboard
        </button>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col">
      <header className="flex items-center justify-between border-b border-edge px-3 py-1.5 shrink-0">
        <div className="flex items-center gap-3">
          <button className="text-inkMuted text-sm hover:text-ink" onClick={() => navigate("/")}>
            ←
          </button>
          <h1 className="font-medium">{song.title}</h1>
          <span className="text-xs text-inkMuted">
            {song.key} {song.scale} · {song.bpm} BPM
            {song.sections.length > 0 && <> · {classifySong(song).label}</>}
          </span>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <button
            className="px-2 py-1 rounded disabled:opacity-30 hover:bg-panelAlt"
            disabled={!canUndo}
            onClick={() => undo()}
          >
            Undo
          </button>
          <button
            className="px-2 py-1 rounded disabled:opacity-30 hover:bg-panelAlt"
            disabled={!canRedo}
            onClick={() => redo()}
          >
            Redo
          </button>
        </div>
      </header>

      <nav className="flex gap-0.5 border-b border-edge px-3 shrink-0">
        {TABS.map((tab) => (
          <NavLink
            key={tab.to}
            to={tab.to}
            className={({ isActive }) =>
              `px-2.5 py-1.5 text-[13px] border-b-2 -mb-px ${
                isActive ? "border-accent text-ink" : "border-transparent text-inkMuted hover:text-ink"
              }`
            }
          >
            {tab.label}
          </NavLink>
        ))}
      </nav>

      {/* Main area: content + a dock. Structure keeps the right sidebar;
          Harmony keeps the bottom dock AND a right sidebar for its Tools;
          every other tab gets just the bottom dock bar (formerly the right
          tool menu). */}
      <div className="flex-1 flex min-h-0">
        <main className="flex-1 overflow-y-auto min-w-0">
          <Outlet />
        </main>

        {isStructure && (
          <aside className="w-[272px] shrink-0 border-l border-edge flex flex-col bg-panel">
            {dockTabs.length > 1 && (
              <DockTabStrip tabs={dockTabs} activePanel={activePanel} onSelect={setActivePanel} />
            )}
            <div className="flex-1 overflow-y-auto">
              {activeNode}
            </div>
          </aside>
        )}

        {isHarmony && dockTools && (
          <aside className="w-[272px] shrink-0 border-l border-edge flex flex-col bg-panel">
            <div className="flex-1 overflow-y-auto">
              {dockTools}
            </div>
          </aside>
        )}
      </div>

      {!isStructure && (
        <footer className="shrink-0 border-t border-edge bg-panel flex flex-col max-h-[45vh]">
          {bottomTabs.length > 1 && (
            <DockTabStrip tabs={bottomTabs} activePanel={activePanel} onSelect={setActivePanel} />
          )}
          <div className="flex-1 overflow-y-auto min-h-0">
            {activeNode}
          </div>
        </footer>
      )}
    </div>
  );
}
