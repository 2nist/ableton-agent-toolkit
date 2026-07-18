import { useEffect } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { useSongStore } from "./store/songStore";
import Dashboard from "./components/dashboard/Dashboard";

// Structure/Harmony/Lyrics views land here in later phases as additional
// <Route> entries, matching this same shell.
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
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </div>
    </BrowserRouter>
  );
}

export default App;
