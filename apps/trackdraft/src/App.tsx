import { useEffect } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { useSongStore } from "./store/songStore";
import { startAtomSqUserMidi, stopAtomSqUserMidi } from "./lib/playback/userMidi";
import Dashboard from "./components/dashboard/Dashboard";
import SongEditorLayout from "./components/layout/SongEditorLayout";
import StudioView from "./components/studio/StudioView";
import StructureView from "./components/structure/StructureView";
import HarmonyView from "./components/harmony/HarmonyView";
import DrumsView from "./components/drums/DrumsView";
import LyricsView from "./components/lyrics/LyricsView";
import MelodyView from "./components/melody/MelodyView";
import WorkbenchView from "./components/workspace/WorkbenchView";
import LibraryView from "./components/library/LibraryView";
import LivePreviewSandbox from "./pages/LivePreviewSandbox";
import GenreWorkbench from "./pages/GenreWorkbench";
import DesignLab from "./pages/DesignLab";
import RenderCanvasLayout from "./components/RenderCanvasLayout";
import LyricChordPopout from "./components/popout/LyricChordPopout";

function App() {
  const loadFromStorage = useSongStore((s) => s.loadFromStorage);

  useEffect(() => {
    loadFromStorage();
  }, [loadFromStorage]);

  // Start listening for ATOM SQ User-mode MIDI messages once on mount.
  useEffect(() => {
    startAtomSqUserMidi();
    return () => stopAtomSqUserMidi();
  }, []);

  return (
    <BrowserRouter>
      <div className="min-h-screen bg-canvas text-ink">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/song/:songId" element={<SongEditorLayout />}>
            <Route index element={<Navigate to="studio" replace />} />
            <Route path="studio" element={<StudioView />} />
            <Route path="structure" element={<StructureView />} />
            <Route path="harmony" element={<HarmonyView />} />
            <Route path="drums" element={<DrumsView />} />
            <Route path="lyrics" element={<LyricsView />} />
            <Route path="melody" element={<MelodyView />} />
            <Route path="workbench" element={<WorkbenchView />} />
            <Route path="library" element={<LibraryView />} />
          </Route>
          {/* Top-level, not nested under SongEditorLayout — deliberately
              chrome-free (no header/nav/dock) for a window meant to be
              glanced at from across a room while playing. */}
          <Route path="/song/:songId/popout" element={<LyricChordPopout />} />
          <Route path="/sandbox" element={<LivePreviewSandbox />} />
          <Route path="/canvas" element={<RenderCanvasLayout />} />
          <Route path="/genre-workbench" element={<GenreWorkbench />} />
          <Route path="/design-lab" element={<DesignLab />} />
          <Route path="/ui-kit-sandbox" element={<Navigate to="/design-lab" replace />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </div>
    </BrowserRouter>
  );
}

export default App;
