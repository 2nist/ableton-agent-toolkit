import type { BlueprintSection } from "../../types/blueprint";
import { BI_TONAL_MATRIX, DEFAULT_COLOR_FLAVOR } from "@platform/progression-engine";
import { DEFAULT_COLOR_OCTAVE } from "../../lib/colorStem";

/** Every bi-tonal flavor in the engine's matrix, deduped to `[id, label]`
 *  — the options for the Color layer's flavor chips. */
const COLOR_FLAVORS = Array.from(
  new Map(
    Object.values(BI_TONAL_MATRIX)
      .flatMap((family) => Object.entries(family))
      .map(([id, def]) => [id, def.label]),
  ),
);

/** The anchor is fixed at octave 4; the color voice's spread is how many
 *  octaves above it (`colorOctave - 4`). Range keeps the color layer a
 *  clearly-separated upper voice without leaving the instrument. */
const COLOR_OCTAVE_MIN = 4;
const COLOR_OCTAVE_MAX = 8;

interface ColorSettingsProps {
  section: BlueprintSection;
  onChange: (updater: (section: BlueprintSection) => BlueprintSection) => void;
}

/** The bi-tonal "Color Chord" layer for a section — flavor + register.
 *  Writes `colorFlavor` / `colorOctave`, consumed by the Color track in
 *  MIDI export, Send to Ableton, and real-time MIDI out. */
export default function ColorSettings({ section, onChange }: ColorSettingsProps) {
  const flavor = section.colorFlavor ?? "";
  const octave = section.colorOctave ?? DEFAULT_COLOR_OCTAVE;

  const chip = (active: boolean) =>
    `font-mono text-2xs rounded px-2 py-1 border ${
      active ? "border-inkMuted text-ink" : "border-edge text-inkMuted hover:text-ink"
    }`;

  return (
    <div>
      <span
        className="font-mono text-3xs uppercase tracking-wider text-inkMuted block mb-1"
        title="Bi-tonal 'Color Chord' layer for this section — the Color track in MIDI export, Send to Ableton, and real-time MIDI out."
      >
        Color
      </span>

      <div className="flex flex-wrap gap-1 mb-2">
        <button
          className={chip(!flavor)}
          title={`Default (${DEFAULT_COLOR_FLAVOR})`}
          onClick={() => onChange((s) => ({ ...s, colorFlavor: undefined }))}
        >
          Default
        </button>
        {COLOR_FLAVORS.map(([id, label]) => (
          <button
            key={id}
            className={chip(flavor === id)}
            title={label}
            onClick={() => onChange((s) => ({ ...s, colorFlavor: id }))}
          >
            {id.replace(/_/g, " ")}
          </button>
        ))}
      </div>

      <div className="flex items-center justify-between">
        <span
          className="font-mono text-2xs uppercase tracking-wider text-inkMuted"
          title="How many octaves above the chord anchor the color voice sits — the register spread of the color layer."
        >
          Register
        </span>
        <div className="flex items-center gap-1">
          <button
            className="font-mono text-2xs rounded px-1.5 py-0.5 border border-edge text-inkMuted hover:text-ink disabled:opacity-40"
            disabled={octave <= COLOR_OCTAVE_MIN}
            onClick={() => onChange((s) => ({ ...s, colorOctave: Math.max(COLOR_OCTAVE_MIN, octave - 1) }))}
          >
            −
          </button>
          <span className="font-mono text-2xs tabular-nums text-ink w-10 text-center">+{octave - 4} oct</span>
          <button
            className="font-mono text-2xs rounded px-1.5 py-0.5 border border-edge text-inkMuted hover:text-ink disabled:opacity-40"
            disabled={octave >= COLOR_OCTAVE_MAX}
            onClick={() => onChange((s) => ({ ...s, colorOctave: Math.min(COLOR_OCTAVE_MAX, octave + 1) }))}
          >
            +
          </button>
        </div>
      </div>
    </div>
  );
}
