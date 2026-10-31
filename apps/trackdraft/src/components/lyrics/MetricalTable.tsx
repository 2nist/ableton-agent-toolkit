import type { LyricMetricalRow } from "../../types/blueprint";
import MicroLabel from "../common/MicroLabel";
import TapeLabel from "../common/TapeLabel";

const FIELDS: { key: Exclude<keyof LyricMetricalRow, "notes">; label: string; placeholder: string }[] = [
  { key: "chordProgression", label: "Chords", placeholder: "i – ♭VI – ♭VII" },
  { key: "metricalFeet", label: "Feet", placeholder: "x / x /" },
  { key: "syllableCount", label: "Syl", placeholder: "8" },
  { key: "rhymeScheme", label: "Rhyme", placeholder: "abab" },
];

function emptyRow(): LyricMetricalRow {
  return { chordProgression: "", metricalFeet: "", syllableCount: "", rhymeScheme: "", notes: "" };
}

interface MetricalTableProps {
  rows: LyricMetricalRow[];
  onChange: (rows: LyricMetricalRow[]) => void;
}

/**
 * The schema already sitting in 9 of 14 lalo-chezia songs' lyrics .xlsx
 * files (Chord Progression / Metrical Feet / Syllable Count / Rhyme Scheme /
 * Notes) — "Section" is implicit, because this table lives under one
 * section's tab.
 *
 * It used to be a five-column table with fixed pixel widths (496px of
 * columns) inside the 236px inspector rail, which meant three of the four
 * fields were clipped and the row labels scrolled out of view with them. A
 * row is a card now: chords on their own line, then the three short values
 * side by side, then the notes prose. Same data, readable at rail width.
 */
export default function MetricalTable({ rows, onChange }: MetricalTableProps) {
  function updateRow(index: number, key: keyof LyricMetricalRow, value: string) {
    onChange(rows.map((r, i) => (i === index ? { ...r, [key]: value } : r)));
  }

  function removeRow(index: number) {
    onChange(rows.filter((_, i) => i !== index));
  }

  return (
    <div className="space-y-2">
      <TapeLabel as="p" size="md" className="text-xs text-inkMuted uppercase tracking-wide">Metrical / rhyme table</TapeLabel>

      {rows.map((row, i) => (
        <div key={i} className="space-y-1 rounded border border-edge bg-panelAlt/40 p-1.5">
          <div className="flex items-center gap-1">
            <MicroLabel>Row {i + 1}</MicroLabel>
            <button
              className="ml-auto px-1 text-2xs text-inkMuted hover:text-danger"
              title="Delete this row"
              onClick={() => removeRow(i)}
            >
              ✕
            </button>
          </div>

          <label className="block min-w-0 space-y-0.5">
            <span className="text-3xs text-inkMuted uppercase tracking-wide">{FIELDS[0].label}</span>
            <input
              className="w-full rounded border border-edge bg-transparent px-1 py-0.5 text-2xs outline-none focus:bg-panelAlt"
              placeholder={FIELDS[0].placeholder}
              value={row.chordProgression}
              onChange={(e) => updateRow(i, "chordProgression", e.target.value)}
            />
          </label>

          <div className="grid grid-cols-3 gap-1">
            {FIELDS.slice(1).map((field) => (
              <label key={field.key} className="block min-w-0 space-y-0.5">
                <span className="text-3xs text-inkMuted uppercase tracking-wide">{field.label}</span>
                <input
                  className="w-full min-w-0 rounded border border-edge bg-transparent px-1 py-0.5 text-2xs outline-none focus:bg-panelAlt"
                  placeholder={field.placeholder}
                  value={row[field.key]}
                  onChange={(e) => updateRow(i, field.key, e.target.value)}
                />
              </label>
            ))}
          </div>

          <textarea
            className="w-full min-w-0 resize-y rounded border border-edge bg-transparent px-1 py-1 text-2xs text-inkMuted outline-none focus:bg-panelAlt"
            rows={2}
            placeholder="Notes…"
            value={row.notes}
            onChange={(e) => updateRow(i, "notes", e.target.value)}
          />
        </div>
      ))}

      {rows.length === 0 && (
        <p className="text-2xs text-inkMuted">
          No rows yet — one row per lyric line is the usual shape.
        </p>
      )}

      <button
        className="rounded border border-edge px-1.5 py-0.5 text-2xs text-inkMuted hover:bg-panelAlt hover:text-ink"
        onClick={() => onChange([...rows, emptyRow()])}
      >
        + Add row
      </button>
    </div>
  );
}
