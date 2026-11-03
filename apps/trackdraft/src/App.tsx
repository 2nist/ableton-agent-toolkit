import { lazy, Suspense, useEffect } from "react";
import { BrowserRouter, Routes, Route, Navigate, useParams } from "react-router-dom";
import { useSongStore } from "./store/songStore";
import { flushAllPendingWrites } from "./store/storage";
import { startAtomSqUserMidi, stopAtomSqUserMidi } from "./lib/playback/userMidi";
import Dashboard from "./components/dashboard/Dashboard";
import SongEditorLayout from "./components/layout/SongEditorLayout";
import StructureView from "./components/structure/StructureView";
import HarmonyView from "./components/harmony/HarmonyView";
import DrumsTab from "./components/drums/DrumsTab";
import LyricsView from "./components/lyrics/LyricsView";
import MelodyView from "./components/melody/MelodyView";
import WorkbenchView from "./components/workspace/WorkbenchView";
import LibraryView from "./components/library/LibraryView";
import SettingsView from "./components/settings/SettingsView";
import LyricChordPopout from "./components/popout/LyricChordPopout";
import StorageWarning from "./components/shell/StorageWarning";
import ConfirmHost from "./components/common/ConfirmHost";
import ErrorBoundary from "./components/common/ErrorBoundary";

// Labs pull in @measured/puck (and its editor stack). They are dev tools, not
// part of the songwriting loop — statically importing them put ~4 MB of Puck
// into the main chunk. Load them only when their route is visited.
// The Puck sandbox is a design lab that talks to localhost:5200 — it is a
// dev tool, so it is neither routed nor built into the packaged app.
const LivePreviewSandbox = import.meta.env.DEV
  ? lazy(() => import("./pages/LivePreviewSandbox"))
  : null;
/** The infinite-canvas experiment (session plan §0.5). Dev-only: it renders
 *  `sectionSpans()` and writes nothing, so it cannot reach a packaged build
 *  until it earns the right. */
const PolyView = import.meta.env.DEV ? lazy(() => import("./components/poly/PolyView")) : null;
/** Spike S3: the canvas at 64 sections, measured. Dev-only, writes nothing. */
const PolyPerfLab = import.meta.env.DEV
  ? lazy(() => import("./components/poly/PolyPerfLab"))
  : null;
const GenreWorkbench = lazy(() => import("./pages/GenreWorkbench"));
const DesignLab = lazy(() => import("./pages/DesignLab"));
const StudioLogLab = lazy(() => import("./pages/studio-log/StudioLogLab"));
const RenderCanvasLayout = lazy(() => import("./components/RenderCanvasLayout"));

/** The discovery board lives in the Harmony Study desk; the short-lived
 *  top-level /study address (one pre-beta build) lands on the desk instead of
 *  dead-ending on a blank canvas. */
function StudyRedirect() {
  const { songId } = useParams<{ songId: string }>();
  return <Navigate to={`/song/${songId}/harmony`} replace />;
}

function App() {
  const hydrate = useSongStore((s) => s.hydrate);

  // One load path: the store's repository knows whether this is the desktop
  // library directory or localStorage, so there is no host check here.
  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  // Start listening for ATOM SQ User-mode MIDI messages once on mount.
  useEffect(() => {
    startAtomSqUserMidi();
    return () => stopAtomSqUserMidi();
  }, []);

  // Autosave is debounced; without this, closing the tab within the debounce
  // window silently drops the last edit. `visibilitychange` covers mobile and
  // tab switches, `pagehide` covers navigation/close.
  useEffect(() => {
    const flush = () => flushAllPendingWrites();
    const onVisibility = () => {
      if (document.visibilityState === "hidden") flush();
    };
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  return (
    <BrowserRouter>
      <div className="min-h-screen bg-canvas text-ink">
        <StorageWarning />
        <ConfirmHost />
        <Suspense fallback={null}>
          {/* Last line: a crash inside the shell itself (not just a view)
              still leaves a readable screen instead of a blank tab. */}
          <ErrorBoundary label="TrackDraft">
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/song/:songId" element={<SongEditorLayout />}>
                <Route index element={<Navigate to="workbench" replace />} />
                <Route path="structure" element={<StructureView />} />
                <Route path="harmony" element={<HarmonyView />} />
                <Route path="drums" element={<DrumsTab />} />
                <Route path="lyrics" element={<LyricsView />} />
                <Route path="melody" element={<MelodyView />} />
                <Route path="study" element={<StudyRedirect />} />
                <Route path="workbench" element={<WorkbenchView />} />
                {import.meta.env.DEV && PolyView ? (
                  <Route path="poly" element={<PolyView />} />
                ) : null}
                <Route path="library" element={<LibraryView />} />
                <Route path="settings" element={<SettingsView />} />
              </Route>
              {/* Top-level, not nested under SongEditorLayout — deliberately
                  chrome-free (no header/nav/dock) for a window meant to be
                  glanced at from across a room while playing. */}
              <Route path="/song/:songId/popout" element={<LyricChordPopout />} />
              {import.meta.env.DEV && LivePreviewSandbox ? (
                <Route path="/sandbox" element={<LivePreviewSandbox />} />
              ) : null}
              {import.meta.env.DEV && PolyPerfLab ? (
                <Route path="/perf" element={<PolyPerfLab />} />
              ) : null}
              <Route path="/canvas" element={<RenderCanvasLayout />} />
              <Route path="/genre-workbench" element={<GenreWorkbench />} />
              <Route path="/design-lab" element={<DesignLab />} />
              <Route path="/studio-log" element={<StudioLogLab />} />
              <Route path="/ui-kit-sandbox" element={<Navigate to="/design-lab" replace />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </ErrorBoundary>
        </Suspense>
      </div>
    </BrowserRouter>
  );
}

export default App;
