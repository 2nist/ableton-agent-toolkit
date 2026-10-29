import { lazy, Suspense, useEffect } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
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

// Labs pull in @measured/puck (and its editor stack). They are dev tools, not
// part of the songwriting loop — statically importing them put ~4 MB of Puck
// into the main chunk. Load them only when their route is visited.
const LivePreviewSandbox = lazy(() => import("./pages/LivePreviewSandbox"));
const GenreWorkbench = lazy(() => import("./pages/GenreWorkbench"));
const DesignLab = lazy(() => import("./pages/DesignLab"));
const StudioLogLab = lazy(() => import("./pages/studio-log/StudioLogLab"));
const RenderCanvasLayout = lazy(() => import("./components/RenderCanvasLayout"));

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
          <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/song/:songId" element={<SongEditorLayout />}>
            <Route index element={<Navigate to="workbench" replace />} />
            <Route path="structure" element={<StructureView />} />
            <Route path="harmony" element={<HarmonyView />} />
            <Route path="drums" element={<DrumsTab />} />
            <Route path="lyrics" element={<LyricsView />} />
            <Route path="melody" element={<MelodyView />} />
            <Route path="workbench" element={<WorkbenchView />} />
            <Route path="library" element={<LibraryView />} />
            <Route path="settings" element={<SettingsView />} />
          </Route>
          {/* Top-level, not nested under SongEditorLayout — deliberately
              chrome-free (no header/nav/dock) for a window meant to be
              glanced at from across a room while playing. */}
          <Route path="/song/:songId/popout" element={<LyricChordPopout />} />
          <Route path="/sandbox" element={<LivePreviewSandbox />} />
          <Route path="/canvas" element={<RenderCanvasLayout />} />
          <Route path="/genre-workbench" element={<GenreWorkbench />} />
          <Route path="/design-lab" element={<DesignLab />} />
          <Route path="/studio-log" element={<StudioLogLab />} />
          <Route path="/ui-kit-sandbox" element={<Navigate to="/design-lab" replace />} />
          <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </div>
    </BrowserRouter>
  );
}

export default App;
