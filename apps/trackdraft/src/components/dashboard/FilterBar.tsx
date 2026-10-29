import { NOTE_TO_PC } from "@music-theory/core";
import type { ConfidenceLevel } from "../../lib/confidence";
import { getConfidenceLevels } from "../../lib/confidence";

/**
 * Every note name the app can store — sharps AND flats.
 *
 * This was a hand-written sharp-only list, so eight songs in the Beatles
 * catalogue (Eb, Bb, Db, Ab) were silently filtered out of the dashboard by the
 * default filter, and the key chips offered no way to reveal them. Derived from
 * the theory engine's own vocabulary so it cannot drift again; sorted by pitch
 * class, with enharmonic spellings adjacent.
 */
const ALL_KEYS = Object.keys(NOTE_TO_PC).sort(
  (a, b) => (NOTE_TO_PC[a] ?? 0) - (NOTE_TO_PC[b] ?? 0) || a.localeCompare(b),
);
const ALL_SCALES = ["ionian", "dorian", "phrygian", "lydian", "mixolydian", "aeolian", "locrian"];

export interface Filters {
  search: string;
  keys: Set<string>;
  scales: Set<string>;
  confidence: Set<ConfidenceLevel>;
  bpmMin: number;
  bpmMax: number;
  hasSections: boolean;
}

export function defaultFilters(): Filters {
  return {
    search: "",
    keys: new Set(ALL_KEYS),
    scales: new Set(ALL_SCALES),
    confidence: new Set(getConfidenceLevels().map((l) => l.level)),
    bpmMin: 20,
    bpmMax: 300,
    hasSections: false,
  };
}

interface FilterBarProps {
  filters: Filters;
  onChange: (filters: Filters) => void;
}

export default function FilterBar({ filters, onChange }: FilterBarProps) {
  const confidenceLevels = getConfidenceLevels();

  function toggleSet<T>(set: Set<T>, item: T): Set<T> {
    const next = new Set(set);
    if (next.has(item)) {
      next.delete(item);
    } else {
      next.add(item);
    }
    return next;
  }

  return (
    <div className="px-3 py-2 space-y-2 border-b border-edge shrink-0">
      {/* Search + quick toggles */}
      <div className="flex items-center gap-2">
        <input
          className="flex-1 bg-panel border border-edge rounded px-2 py-1 text-xs"
          placeholder="Search songs…"
          value={filters.search}
          onChange={(e) => onChange({ ...filters, search: e.target.value })}
        />
        <label className="flex items-center gap-1 text-[10px] text-inkMuted cursor-pointer">
          <input
            type="checkbox"
            className="rounded bg-panel border-edge"
            checked={filters.hasSections}
            onChange={(e) => onChange({ ...filters, hasSections: e.target.checked })}
          />
          Has sections
        </label>
      </div>

      {/* Confidence filter chips */}
      <div className="flex items-center gap-1 flex-wrap">
        <span className="text-[10px] text-inkMuted mr-0.5">Conf:</span>
        {confidenceLevels.map(({ level, label, color }) => (
          <button
            key={level}
            className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] border transition-colors ${
              filters.confidence.has(level)
                ? "border-accent/50 bg-panelAlt text-ink"
                : "border-edge text-inkMuted hover:text-ink"
            }`}
            onClick={() => onChange({ ...filters, confidence: toggleSet(filters.confidence, level) })}
          >
            <span className={`inline-block w-1.5 h-1.5 rounded-full ${color}`} />
            {label}
          </button>
        ))}
      </div>

      {/* Key filter chips */}
      <div className="flex items-center gap-1 flex-wrap">
        <span className="text-[10px] text-inkMuted mr-0.5">Key:</span>
        {ALL_KEYS.map((key) => (
          <button
            key={key}
            className={`px-1.5 py-0.5 rounded text-[10px] border transition-colors ${
              filters.keys.has(key)
                ? "border-accent/50 bg-panelAlt text-ink"
                : "border-edge text-inkMuted hover:text-ink"
            }`}
            onClick={() => onChange({ ...filters, keys: toggleSet(filters.keys, key) })}
          >
            {key}
          </button>
        ))}
      </div>

      {/* Scale filter chips */}
      <div className="flex items-center gap-1 flex-wrap">
        <span className="text-[10px] text-inkMuted mr-0.5">Scale:</span>
        {ALL_SCALES.map((scale) => (
          <button
            key={scale}
            className={`px-1.5 py-0.5 rounded text-[10px] border transition-colors capitalize ${
              filters.scales.has(scale)
                ? "border-accent/50 bg-panelAlt text-ink"
                : "border-edge text-inkMuted hover:text-ink"
            }`}
            onClick={() => onChange({ ...filters, scales: toggleSet(filters.scales, scale) })}
          >
            {scale}
          </button>
        ))}
      </div>
    </div>
  );
}

export { ALL_KEYS, ALL_SCALES };