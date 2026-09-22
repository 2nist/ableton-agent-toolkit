import { NavLink, Outlet, useNavigate, useParams } from "react-router-dom";
import { useEffect } from "react";
import { useSongStore } from "../../store/songStore";
import { useDrumsDraftStore } from "../../store/drumsDraftStore";
import { getSongTransport } from "../../lib/playback/songTransport";
import { stopSong, liveRefresh } from "../../lib/playback/transportControl";
import { classifySong } from "../../lib/classification";
import Spine from "../shell/Spine";
import LibraryRail from "../shell/LibraryRail";
import InspectorRail from "../shell/InspectorRail";

const TABS = [
  { to: "workbench", label: "Workbench β" },
  { to: "studio", label: "Studio" },
  { to: "structure", label: "Structure" },
  { to: "harmony", label: "Harmony" },
  { to: "drums", label: "Drums" },
  { to: "lyrics", label: "Lyrics" },
  { to: "melody", label: "Melody" },
];

export default function SongEditorLayout() {
  const { songId } = useParams<{ songId: string }>();
  const navigate = useNavigate();
  const songs = useSongStore((s) => s.songs);
  const openSong = useSongStore((s) => s.openSong);

  // Playback deliberately survives tab-to-tab navigation (so you can edit
  // any element while the song sounds); it only stops when leaving the song
  // editor entirely — otherwise the singleton transport would keep sounding
  // on the Dashboard. The spine band (mounted below, on EVERY song route)
  // owns the transport UI, its state and the section loop — P2 folded the
  // legacy header transport into it, so this layout mirrors none of that.
  useEffect(() => () => stopSong(), []);

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

  const song = songs.find((s) => s.id === songId);

  // Make the route's song the store's current song. This must also re-run
  // when hydration populates `songs` (child effects fire BEFORE App's
  // loadFromStorage pass, so the first attempt can hit an empty list and
  // silently no-op — deep links then rendered the LAST persisted song's
  // content under the route's title; found 2026-09-20). Guarded by the id
  // comparison so ordinary edits (which replace `songs` every keystroke)
  // don't re-open the song and wipe the undo history.
  const currentSongId = useSongStore((s) => s.currentSongId);
  useEffect(() => {
    if (song && songId && currentSongId !== songId) openSong(songId);
  }, [song?.id, songId, currentSongId, openSong]);

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
        {/* Transport now lives in the spine's strip, mounted below on every
            song route (P2) — the legacy header cluster died along with this
            layout's copy of its state. What remains here is identity only:
            song, key, tempo, classification. */}
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

      {/* The spine — shell chrome on every song route (P2): the transport
          strip, bar ruler, true-scale blocks and chords lane live above
          every tab, so navigating never loses the song's shape. */}
      <Spine song={song} />

      {/* Main area: library + canvas + inspector (layout grammar, user
          decision 2026-09-21 — LEFT library · CENTER canvas · RIGHT
          contextual inspector · no bottom). Slice C: the Library is shell
          chrome now, same as the spine and the inspector — every song
          route carries the same three zones. */}
      <div className="flex-1 flex min-h-0">
        <LibraryRail />
        <main className="flex-1 overflow-y-auto min-w-0">
          <Outlet />
        </main>
        <InspectorRail />
      </div>
    </div>
  );
}
