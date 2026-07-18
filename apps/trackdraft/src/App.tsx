import { useEffect } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { useSongStore } from "./store/songStore";
import Dashboard from "./components/dashboard/Dashboard";
import SongEditorLayout from "./components/layout/SongEditorLayout";
import StructureView from "./components/structure/StructureView";
import HarmonyView from "./components/harmony/HarmonyView";
import LyricsView from "./components/lyrics/LyricsView";
import DetailsView from "./components/details/DetailsView";

function App() {
  const loadFromStorage = useSongStore((s) => s.loadFromStorage);

  useEffect(() => {
    loadFromStorage();
  }, [loadFromStorage]);

  return (
    <BrowserRouter>
      <div className="min-h-screen bg-canvas text-ink">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/song/:songId" element={<SongEditorLayout />}>
            <Route index element={<Navigate to="details" replace />} />
            <Route path="details" element={<DetailsView />} />
            <Route path="structure" element={<StructureView />} />
            <Route path="harmony" element={<HarmonyView />} />
            <Route path="lyrics" element={<LyricsView />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </div>
    </BrowserRouter>
  );
}

export default App;
