import type { LyricMetricalRow } from "../../types/blueprint";

const COLUMNS: { key: keyof LyricMetricalRow; label: string; width: string }[] = [
  { key: "chordProgression", label: "Chord Progression", width: "w-40" },
  { key: "metricalFeet", label: "Metrical Feet", width: "w-32" },
  { key: "syllableCount", label: "Syllable Count", width: "w-28" },
  { key: "rhymeScheme", label: "Rhyme Scheme", width: "w-24" },
  { key: "notes", label: "Notes", width: "flex-1" },
];

function emptyRow(): LyricMetricalRow {
  return { chordProgression: "", metricalFeet: "", syllableCount: "", rhymeScheme: "", notes: "" };
}

interface MetricalTableProps {
  rows: LyricMetricalRow[];
  onChange: (rows: LyricMetricalRow[]) => void;
}

/** The exact schema already sitting unused in 9 of 14 lalo-chezia songs'
 *  lyrics .xlsx files (Section / Chord Progression / Metrical Feet /
 *  Syllable Count / Rhyme Scheme / Notes) -- "Section" here is implicit,
 *  this table lives under one section's tab already. */
export default function MetricalTable({ rows, onChange }: MetricalTableProps) {
  function updateRow(index: number, key: keyof LyricMetricalRow, value: string) {
    onChange(rows.map((r, i) => (i === index ? { ...r, [key]: value } : r)));
  }

  function removeRow(index: number) {
    onChange(rows.filter((_, i) => i !== index));
  }

  return (
    <div className="space-y-2">
      <p className="text-xs text-inkMuted uppercase tracking-wide">Metrical / rhyme table</p>
      <div className="border border-edge rounded overflow-hidden">
        <div className="flex bg-panelAlt text-xs text-inkMuted px-2 py-1">
          {COLUMNS.map((col) => (
            <div key={col.key} className={col.width}>{col.label}</div>
          ))}
          <div className="w-6" />
        </div>
        {rows.map((row, i) => (
          <div key={i} className="flex items-center px-2 py-1 border-t border-edge">
            {COLUMNS.map((col) => (
              <input
                key={col.key}
                className={`${col.width} bg-transparent text-sm px-1 py-0.5 outline-none focus:bg-panelAlt rounded`}
                value={row[col.key]}
                onChange={(e) => updateRow(i, col.key, e.target.value)}
              />
            ))}
            <button
              className="w-6 text-inkMuted hover:text-red-400 text-xs"
              onClick={() => removeRow(i)}
            >
              ✕
            </button>
          </div>
        ))}
        {rows.length === 0 && (
          <div className="px-2 py-3 text-xs text-inkMuted">No rows yet.</div>
        )}
      </div>
      <button
        className="text-xs border border-edge rounded px-2 py-1 text-inkMuted hover:text-ink hover:bg-panelAlt"
        onClick={() => onChange([...rows, emptyRow()])}
      >
        + Add row
      </button>
    </div>
  );
}
