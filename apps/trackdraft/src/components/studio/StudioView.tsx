import { useSongStore } from "../../store/songStore";
import { downloadSongJson } from "../../lib/exportImport";
import ArrangementTimeline from "./ArrangementTimeline";

/** The song's home tab. Top row is controls (Export today; the intended
 *  anchor for whatever this tab's actions grow into, not a one-off button
 *  placement) above the arrangement timeline — the "what will Ableton
 *  build" breakdown that used to sit below the timeline was cut entirely,
 *  since it only restated section names/chord counts the timeline's own
 *  hover already shows. */
export default function StudioView() {
  const currentSong = useSongStore((s) => s.currentSong());
  if (!currentSong) return null;
  const song = currentSong;

  return (
    <div className="p-6 max-w-5xl space-y-4">
      <div className="flex items-center justify-end gap-2 border-b border-edge pb-3">
        <button
          className="bg-accent text-black text-xs font-medium px-3 py-1.5 rounded"
          onClick={() => downloadSongJson(song)}
        >
          Export JSON
        </button>
      </div>

      {song.sections.length === 0 ? (
        <p className="text-inkMuted text-sm">
          Add sections in the Structure tab first — Studio shows your song's arrangement here once it has some.
        </p>
      ) : (
        <ArrangementTimeline song={song} />
      )}
    </div>
  );
}
