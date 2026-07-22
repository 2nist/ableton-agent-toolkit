import { useNavigate } from "react-router-dom";
import { useSongStore } from "../../store/songStore";
import { GENRE_CATALOG } from "../../data/genre-catalog";

export default function TemplateList() {
  const createNewSong = useSongStore((s) => s.createNewSong);
  const navigate = useNavigate();

  function handleCreateFromTemplate(id: string) {
    const genre = GENRE_CATALOG.find((g) => g.id === id);
    if (!genre) return;

    const song = createNewSong(genre.name);
    const defaults = genre.defaults;
    if (defaults) {
      useSongStore.getState().updateCurrentSong((s) => ({
        ...s,
        bpm: defaults.bpm ?? s.bpm,
        key: (defaults.key as typeof s.key) ?? s.key,
        scale: (defaults.scale as typeof s.scale) ?? s.scale,
        concept: defaults.concept ?? s.concept,
      }));
    }
    navigate(`/song/${song.id}/structure`);
  }

  return (
    <div className="space-y-1">
      <span className="text-xs font-semibold text-inkMuted uppercase tracking-wider px-1">
        Templates
      </span>
      {GENRE_CATALOG.map((genre) => (
        <button
          key={genre.id}
          className="w-full text-left text-xs px-2 py-1 rounded text-inkMuted hover:text-ink hover:bg-panelAlt/50 truncate"
          onClick={() => handleCreateFromTemplate(genre.id)}
          title={genre.description}
        >
          {genre.name}
        </button>
      ))}
    </div>
  );
}