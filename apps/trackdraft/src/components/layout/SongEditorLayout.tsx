import { NavLink, Outlet, useLocation, useNavigate, useParams } from "react-router-dom";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useSongStore } from "../../store/songStore";
import { useDockStore } from "../../store/dockStore";
import { useDrumsDraftStore } from "../../store/drumsDraftStore";
import { getSongTransport } from "../../lib/playback/songTransport";
import { playSong, pauseSong, stopSong, liveRefresh, playSectionLoop, resumeUnlooped } from "../../lib/playback/transportControl";
import { sectionSpans } from "../../lib/arrangement";
import { classifySong } from "../../lib/classification";
import SongInfoPanel from "../details/SongInfoPanel";
import type { BlueprintSong } from "../../types/blueprint";

const TABS = [
  { to: "studio", label: "Studio" },
  { to: "structure", label: "Structure" },
  { to: "harmony", label: "Harmony" },
  { to: "drums", label: "Drums" },
  { to: "lyrics", label: "Lyrics" },
  { to: "melody", label: "Melody" },
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
  const clockSource = useSongStore((s) => s.clockSource);

  // Global playback state — the header transport (Play / Pause / Stop + a
  // "now playing" readout) lives on every tab so you can start the song and
  // keep editing while it sounds.
  const [isPlaying, setIsPlaying] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [playingBeat, setPlayingBeat] = useState(0);
  const [playingSection, setPlayingSection] = useState<string | null>(null);
  const [playingSectionId, setPlayingSectionId] = useState<string | null>(null);
  /** Section-loop toggle — when on, the current part plays over and over. */
  const [loopOn, setLoopOn] = useState(false);
  // The tick handler needs the current song to name the section; keep a ref
  // so the (once-mounted) subscription always reads the latest song.
  const songRef = useRef<BlueprintSong | null>(null);

  // Subscribes once for the layout's lifetime. Playback deliberately
  // survives tab-to-tab navigation (so you can edit Harmony/Drums/Melody
  // while the song is playing); it only stops when leaving the song editor
  // entirely — otherwise the singleton transport would keep sounding on the
  // Dashboard.
  useEffect(() => {
    const transport = getSongTransport();
    const unsubscribe = transport.onTick((tick) => {
      setIsPlaying(tick.isPlaying);
      setIsPaused(transport.isPaused());
      setPlayingBeat(tick.beat);
      // A hard stop (not a pause) also drops the section loop.
      if (!tick.isPlaying && !transport.isPaused()) setLoopOn(false);
      const s = songRef.current;
      if (s && tick.sectionIndex >= 0) {
        const span = sectionSpans(s)[tick.sectionIndex];
        setPlayingSection(span?.section?.name ?? null);
        setPlayingSectionId(span?.sectionId ?? null);
      } else {
        setPlayingSection(null);
        setPlayingSectionId(null);
      }
    });
    return () => {
      unsubscribe();
      stopSong();
    };
  }, []);

  // Real-time editing while playing: whenever the song changes (harmony/
  // melody edits, a committed drums pattern) or the drums editor's draft
  // moves, re-plan the live MIDI scheduler from the current playhead —
  // debounced so a slider drag coalesces into one re-plan instead of a
  // glitch per tick.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const schedule = () => {
      if (!getSongTransport().getIsPlaying()) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        const song = useSongStore.getState().currentSong();
        if (song) void liveRefresh(song);
      }, 120);
    };
    const unsubSong = useSongStore.subscribe(schedule);
    const unsubDraft = useDrumsDraftStore.subscribe(schedule);
    return () => {
      unsubSong();
      unsubDraft();
      if (timer) clearTimeout(timer);
    };
  }, []);

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
  songRef.current = song ?? songRef.current;

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

  /** Global Play / Resume — same shared logic Studio's button uses, so the
   *  header and Studio can't disagree about what "play" means. Disabled
   *  while playing (use Pause or Stop); resumes from a paused position. */
  async function togglePlayback() {
    if (!song || isPlaying) return;
    await playSong(song, clockSource);
  }

  /** Global Pause — freeze the playhead (and silence live MIDI out). */
  function pausePlayback() {
    pauseSong();
  }

  /** Global Stop — reset to the top. */
  function stopPlayback() {
    stopSong();
  }

  /** Section loop toggle — loop the part currently playing, over and over,
   *  until it's turned off (or playback stops). */
  async function toggleLoop() {
    if (!song) return;
    if (loopOn) {
      setLoopOn(false);
      await resumeUnlooped(song);
      return;
    }
    const sectionId = playingSectionId ?? song.sections[0]?.id;
    if (!sectionId) return;
    const ok = await playSectionLoop(song, sectionId);
    if (ok) setLoopOn(true);
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
        <div className="flex items-center gap-1.5 text-sm">
          <button
            className={`text-xs font-medium px-2.5 py-1 rounded disabled:opacity-40 ${
              isPlaying ? "bg-panelAlt text-inkMuted" : "bg-accent text-black"
            }`}
            onClick={() => void togglePlayback()}
            disabled={isPlaying || song.sections.length === 0}
            title={isPaused ? "Resume from where you paused" : "Play the song — keeps playing while you edit any tab"}
          >
            {isPaused ? "▶ Resume" : clockSource === "ableton" ? "⟲ Sync" : "▶ Play"}
          </button>
          <button
            className="px-2 py-1 rounded text-xs disabled:opacity-30 hover:bg-panelAlt"
            disabled={!isPlaying || clockSource === "ableton"}
            onClick={pausePlayback}
            title="Pause — freeze the playhead, resume from here later"
          >
            ❚❚
          </button>
          <button
            className="px-2 py-1 rounded text-xs disabled:opacity-30 hover:bg-panelAlt"
            disabled={!isPlaying && !isPaused}
            onClick={stopPlayback}
            title="Stop — reset to the start"
          >
            ■
          </button>
          {(isPlaying || isPaused) && (
            <span className="text-[11px] text-inkMuted font-mono" title="Current position and section">
              ● {playingBeat.toFixed(1)}
              {playingSection ? ` · ${playingSection}` : ""}
            </span>
          )}
          <button
            className={`px-1.5 py-1 rounded text-sm disabled:opacity-30 hover:bg-panelAlt ${
              loopOn ? "bg-accent text-black" : ""
            }`}
            disabled={!isPlaying || clockSource === "ableton"}
            onClick={() => void toggleLoop()}
            title={
              loopOn
                ? "Looping this part — click to stop looping"
                : "Loop the part that's playing, over and over, until you turn it off"
            }
          >
            ⟳
          </button>
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

      {/* Studio is the "taste + arc" hub now — its arrangement blocks carry
          per-section harmony/drums/melody readouts and the Mix/Bend panel
          sits to the right, so the bottom Info dock (the only content Studio
          ever registered) is dropped there. Every other tab keeps it. */}
      {!isStructure && activeTab !== "studio" && (
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
