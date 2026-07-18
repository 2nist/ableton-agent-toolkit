import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { BlueprintSection, SectionRole, DrumPattern, VelocityPreset } from "../../types/blueprint";

const ROLES: SectionRole[] = [
  "intro", "verse", "pre_chorus", "chorus", "bridge", "solo", "breakdown", "outro", "custom",
];
const DRUM_PATTERNS: DrumPattern[] = [
  "none", "kick_only", "standard", "half_time", "driving", "bridge_sparse", "intense", "dnb", "78", "68", "54",
];
const VELOCITIES: VelocityPreset[] = ["ppp", "pp", "p", "mp", "mf", "f", "ff", "fff"];
// song-structure's SongSection stores the denominator as a power of two
// (denPower 2 == denominator 4, i.e. 4/4) rather than the raw number --
// matches the S() DSL's ts_den_power convention. Converted to/from a
// real denominator here so the UI shows "4" not "2".
const DENOMINATOR_OPTIONS = [2, 4, 8, 16];

interface SectionCardProps {
  section: BlueprintSection;
  onChange: (updater: (section: BlueprintSection) => BlueprintSection) => void;
  onDelete: () => void;
}

export default function SectionCard({ section, onChange, onDelete }: SectionCardProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: section.id,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="border border-edge rounded bg-panel p-3 space-y-2"
    >
      <div className="flex items-center gap-2">
        <button
          {...attributes}
          {...listeners}
          className="cursor-grab text-inkMuted px-1 select-none"
          aria-label="Drag to reorder"
        >
          ⠿
        </button>
        <input
          className="bg-transparent font-medium flex-1 outline-none"
          value={section.name}
          onChange={(e) => onChange((s) => ({ ...s, name: e.target.value }))}
        />
        <select
          className="bg-panelAlt border border-edge rounded text-xs px-2 py-1"
          value={section.role}
          onChange={(e) => onChange((s) => ({ ...s, role: e.target.value as SectionRole }))}
        >
          {ROLES.map((r) => (
            <option key={r} value={r}>{r}</option>
          ))}
        </select>
        <button
          className="text-inkMuted hover:text-red-400 text-xs px-2"
          onClick={onDelete}
        >
          Delete
        </button>
      </div>

      <div className="flex flex-wrap gap-3 text-xs text-inkMuted">
        <label className="flex items-center gap-1">
          Time sig
          <input
            type="number"
            min={1}
            max={32}
            className="w-10 bg-panelAlt border border-edge rounded px-1 py-0.5 text-ink"
            value={section.timeSignatureNumerator}
            onChange={(e) =>
              onChange((s) => ({ ...s, timeSignatureNumerator: Number(e.target.value) || 1 }))
            }
          />
          <span>/</span>
          <select
            className="bg-panelAlt border border-edge rounded px-1 py-0.5 text-ink"
            value={2 ** section.timeSignatureDenPower}
            onChange={(e) =>
              onChange((s) => ({ ...s, timeSignatureDenPower: Math.log2(Number(e.target.value)) }))
            }
          >
            {DENOMINATOR_OPTIONS.map((d) => (
              <option key={d} value={d}>{d}</option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1">
          Bars
          <input
            type="number"
            min={1}
            className="w-14 bg-panelAlt border border-edge rounded px-1 py-0.5 text-ink"
            value={section.bars}
            onChange={(e) => onChange((s) => ({ ...s, bars: Number(e.target.value) || 1 }))}
          />
        </label>
        <label className="flex items-center gap-1">
          Beats/chord
          <input
            type="number"
            min={1}
            className="w-14 bg-panelAlt border border-edge rounded px-1 py-0.5 text-ink"
            value={section.beatsPerChord}
            onChange={(e) => onChange((s) => ({ ...s, beatsPerChord: Number(e.target.value) || 1 }))}
          />
        </label>
        <label className="flex items-center gap-1">
          Drums
          <select
            className="bg-panelAlt border border-edge rounded px-1 py-0.5 text-ink"
            value={section.drumPattern}
            onChange={(e) => onChange((s) => ({ ...s, drumPattern: e.target.value as DrumPattern }))}
          >
            {DRUM_PATTERNS.map((d) => (
              <option key={d} value={d}>{d}</option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1">
          Velocity
          <select
            className="bg-panelAlt border border-edge rounded px-1 py-0.5 text-ink"
            value={section.velocity}
            onChange={(e) => onChange((s) => ({ ...s, velocity: e.target.value as VelocityPreset }))}
          >
            {VELOCITIES.map((v) => (
              <option key={v} value={v}>{v}</option>
            ))}
          </select>
        </label>
      </div>

      <textarea
        className="w-full bg-panelAlt border border-edge rounded px-2 py-1 text-xs text-inkMuted resize-y"
        rows={2}
        placeholder="Transition into this section…"
        value={section.transitionNote ?? ""}
        onChange={(e) => onChange((s) => ({ ...s, transitionNote: e.target.value }))}
      />
    </div>
  );
}
