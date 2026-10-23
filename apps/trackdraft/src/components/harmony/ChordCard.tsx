import { useState } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { pitchClass } from "@music-theory/core";
import type { Chord, ChordPerformanceEffect } from "../../types/blueprint";
import { chordDisplayName, chordFunction, qualityLabel, functionColorHex } from "../../lib/harmony/chordBuilder";
import { CHORD_QUALITY_GROUPS } from "@music-theory/core";
import type { NoteName, ScaleType } from "@music-theory/core";

type EditProperty = "none" | "quality" | "beats" | "performance";
const PERFORMANCE_STYLES: ChordPerformanceEffect["style"][] = ["strum", "pulse", "arp"];

interface ChordCardProps {
  chord: Chord;
  keyName: NoteName;
  scale: ScaleType;
  isSounding: boolean;
  isSelected: boolean;
  onSelect: () => void;
  onChange: (chord: Chord) => void;
  onRemove: () => void;
}

/** One chord in the progression: draggable to reorder, color-coded by
 *  harmonic function, and clickable to audition.  Progressive-disclosure
 *  editing — the always-visible inline fields are replaced by a single
 *  "edit property" dropdown that reveals the chosen editor only when
 *  selected.  Substitutions stay in ChordInspector (right panel) to
 *  avoid cluttering a chord card this small. */
export default function ChordCard({
  chord,
  keyName,
  scale,
  isSounding,
  isSelected,
  onSelect,
  onChange,
  onRemove,
}: ChordCardProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: chord.id });
  const [editProp, setEditProp] = useState<EditProperty>("none");
  const rootPc = pitchClass(chord.root);
  const displayName = chordDisplayName(rootPc, chord.quality, keyName);

  const func = chord.isSubstitution ? null : chordFunction(chord, scale);
  const hex = functionColorHex(func);

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    ...(hex ? { borderColor: hex, backgroundColor: `${hex}1a` } : {}),
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`relative border rounded px-2 py-2 min-w-[110px] text-center cursor-pointer ${
        hex ? "" : "border-edge bg-panelAlt"
      } ${isSelected ? "ring-2 ring-accent" : ""} ${isSounding ? "ring-2 ring-accent/70" : ""}`}
      onClick={() => onSelect()}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        // Right-click: select and open inspector (external to this card)
        onSelect();
      }}
    >
      {/* Header row: drag handle, roman numeral, remove */}
      <div className="flex items-center justify-center gap-1">
        <button
          {...attributes}
          {...listeners}
          className="text-inkMuted/60 hover:text-inkMuted cursor-grab select-none text-xs"
          aria-label="Drag to reorder"
          onClick={(e) => e.stopPropagation()}
        >
          ⠿
        </button>
        <div className="text-xs" style={hex ? { color: hex } : undefined}>
          {chord.romanNumeral}
        </div>
      </div>

      {/* Chord display name */}
      <div className="font-medium text-sm">{displayName}</div>

      {chord.isSubstitution && (
        <div className="text-[10px] text-accent mt-0.5">sub of {chord.substitutedFrom}</div>
      )}

      {chord.performance && (
        <div className="text-[10px] text-inkMuted/70 mt-0.5">~{chord.performance.style}</div>
      )}

      {/* Progressive-disclosure editing */}
      <div className="mt-1.5" onClick={(e) => e.stopPropagation()}>
        <select
          className="w-full bg-transparent border border-edge rounded text-[10px] text-inkMuted text-center py-0.5"
          value={editProp}
          onChange={(e) => setEditProp(e.target.value as EditProperty)}
        >
          <option value="none">▾ edit…</option>
          <option value="quality">quality</option>
          <option value="beats">beats</option>
          <option value="performance">performance</option>
        </select>

        {editProp === "quality" && (
          <select
            className="mt-1 w-full bg-transparent border border-edge rounded text-[10px] text-inkMuted text-center py-0.5"
            value={chord.quality}
            onChange={(e) => onChange({ ...chord, quality: e.target.value as Chord["quality"] })}
          >
            {CHORD_QUALITY_GROUPS.map((group) => (
              <optgroup key={group.label} label={group.label}>
                {group.qualities.map((q) => (
                  <option key={q} value={q}>{qualityLabel(q)}</option>
                ))}
              </optgroup>
            ))}
          </select>
        )}

        {editProp === "beats" && (
          <div className="flex items-center justify-center gap-1 mt-1">
            <input
              type="number"
              min={0.5}
              step={0.5}
              value={chord.beats}
              className="w-10 bg-transparent border border-edge rounded text-[10px] text-center text-inkMuted py-0.5"
              onChange={(e) =>
                onChange({ ...chord, beats: Math.max(0.5, Number(e.target.value) || chord.beats) })
              }
            />
            <span className="text-[10px] text-inkMuted">beats</span>
          </div>
        )}

        {editProp === "performance" && (
          <select
            className="mt-1 w-full bg-transparent border border-edge rounded text-[10px] text-inkMuted text-center py-0.5"
            value={chord.performance?.style ?? "none"}
            onChange={(e) => {
              const style = e.target.value as ChordPerformanceEffect["style"] | "none";
              onChange({ ...chord, performance: style === "none" ? undefined : { style } });
            }}
          >
            <option value="none">none</option>
            {PERFORMANCE_STYLES.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        )}
      </div>

      <button
        className="absolute top-0.5 right-1 text-[10px] text-inkMuted hover:text-red-400"
        onClick={(e) => {
          e.stopPropagation();
          onRemove();
        }}
      >
        ✕
      </button>
    </div>
  );
}
