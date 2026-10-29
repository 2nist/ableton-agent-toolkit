import { KEY_ROOTS } from "@music-theory/core";
import type { NoteName, ScaleType } from "@music-theory/core";
import { useSongStore } from "../../store/songStore";
import type { BlueprintSong } from "../../types/blueprint";

const SCALES: ScaleType[] = ["ionian", "dorian", "phrygian", "lydian", "mixolydian", "aeolian", "locrian"];

/**
 * Key, scale and tempo — the three values every other element reads, so
 * they sit on the workbench itself rather than behind a settings route.
 *
 * These were the only genuinely unique controls on the retired Studio view
 * (its transport lives in the spine, its MIDI panel in Settings, its sync
 * controls in the inspector's Sync facet). Editing here goes through
 * `updateCurrentSong`, so it is undoable like any other song edit.
 */
export default function SongSettingsStrip({ song }: { song: BlueprintSong }) {
  const updateCurrentSong = useSongStore((s) => s.updateCurrentSong);

  return (
    <div className="flex items-center gap-2 px-3 py-1 border-b border-edge bg-panelAlt/30 shrink-0">
      <label className="flex items-center gap-1">
        <span className="text-3xs font-mono uppercase tracking-widest text-inkMuted">Key</span>
        <select
          className="bg-panelAlt border border-edge rounded px-1 py-0.5 font-mono text-[10px]"
          value={song.key}
          onChange={(e) => updateCurrentSong((s) => ({ ...s, key: e.target.value as NoteName }))}
          title="The song's tonic — transposes nothing, re-reads every chord against it"
        >
          {KEY_ROOTS.slice(0, 12).map((k) => (
            <option key={k} value={k}>
              {k}
            </option>
          ))}
        </select>
      </label>

      <label className="flex items-center gap-1">
        <span className="text-3xs font-mono uppercase tracking-widest text-inkMuted">Scale</span>
        <select
          className="bg-panelAlt border border-edge rounded px-1 py-0.5 font-mono text-[10px]"
          value={song.scale}
          onChange={(e) => updateCurrentSong((s) => ({ ...s, scale: e.target.value as ScaleType }))}
          title="Mode — decides which colour tones and borrowed chords the harmony tools offer"
        >
          {SCALES.map((sc) => (
            <option key={sc} value={sc}>
              {sc}
            </option>
          ))}
        </select>
      </label>

      <label className="flex items-center gap-1">
        <span className="text-3xs font-mono uppercase tracking-widest text-inkMuted">BPM</span>
        <input
          type="number"
          min={20}
          max={999}
          className="w-14 bg-panelAlt border border-edge rounded px-1 py-0.5 font-mono text-[10px] text-center"
          value={song.bpm}
          onChange={(e) => {
            const bpm = Math.max(20, Math.min(999, parseInt(e.target.value, 10) || 120));
            updateCurrentSong((s) => ({ ...s, bpm }));
          }}
          title="Tempo — playback, the bar ruler, and the MIDI export all use this"
        />
      </label>
    </div>
  );
}
