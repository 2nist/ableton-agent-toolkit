import { KEY_ROOTS } from "@music-theory/core";
import type { ScaleType } from "@music-theory/core";

const WHEEL_KEYS = KEY_ROOTS.slice(0, 12); // 12 unique pitch classes, already circle-of-fifths ordered
const SCALES: ScaleType[] = ["ionian", "dorian", "phrygian", "lydian", "mixolydian", "aeolian", "locrian"];

interface KeySelectorProps {
  activeKey: string;
  activeScale: ScaleType;
  onChangeKey: (key: string) => void;
  onChangeScale: (scale: ScaleType) => void;
}

/** The song's default key/scale — a compact single row, not a dedicated
 *  visualization. Per-section overrides (modulation) happen right on the
 *  honeycomb's own root cell instead of a second control here; this is
 *  only ever the song-wide fallback. */
export default function KeySelector({ activeKey, activeScale, onChangeKey, onChangeScale }: KeySelectorProps) {
  return (
    <div className="flex items-center gap-2 text-sm">
      <span className="text-xs text-inkMuted uppercase tracking-wide">Song key</span>
      <select
        className="bg-panelAlt border border-edge rounded px-2 py-1 text-ink"
        value={activeKey}
        onChange={(e) => onChangeKey(e.target.value)}
      >
        {WHEEL_KEYS.map((key) => (
          <option key={key} value={key}>{key}</option>
        ))}
      </select>
      <select
        className="bg-panelAlt border border-edge rounded px-2 py-1 text-ink"
        value={activeScale}
        onChange={(e) => onChangeScale(e.target.value as ScaleType)}
      >
        {SCALES.map((scale) => (
          <option key={scale} value={scale}>{scale}</option>
        ))}
      </select>
    </div>
  );
}
