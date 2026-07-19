import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { pitchClass } from "@music-theory/core";
import type { Chord } from "../../types/blueprint";
import { chordDisplayName, chordFunction, CHORD_QUALITIES, functionColorHex } from "../../lib/harmony/chordBuilder";
import { getPreviewPlayer, chordToFreqs } from "../../lib/harmony/audioPreview";
import type { NoteName, ScaleType } from "@music-theory/core";

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

/** One chord in the progression: draggable to reorder, editable in place
 *  (beats, quality), color-coded by harmonic function, and clickable to
 *  audition. Substitution is handled by ChordInspector now, not a popover
 *  here — a chord this small has no room for a real substitution menu. */
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
  const rootPc = pitchClass(chord.root);
  const displayName = chordDisplayName(rootPc, chord.quality, keyName);

  // A substituted chord's roman numeral no longer necessarily matches its
  // root/quality, so its computed function would be misleading — it keeps
  // the accent "sub of X" treatment instead of a function tint.
  const func = chord.isSubstitution ? null : chordFunction(chord, scale);
  const hex = functionColorHex(func);

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    ...(hex ? { borderColor: hex, backgroundColor: `${hex}1a` } : {}),
  };

  function audition() {
    getPreviewPlayer().playChord(chordToFreqs(chord), 1);
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`relative border rounded px-2 py-2 min-w-[96px] text-center cursor-pointer ${
        hex ? "" : "border-edge bg-panelAlt"
      } ${isSelected ? "ring-2 ring-accent" : ""} ${isSounding ? "ring-2 ring-accent/70" : ""}`}
      onClick={() => {
        onSelect();
        audition();
      }}
    >
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
      <div className="font-medium">{displayName}</div>

      <div className="flex items-center justify-center gap-1 mt-1" onClick={(e) => e.stopPropagation()}>
        <input
          type="number"
          min={0.5}
          step={0.5}
          value={chord.beats}
          className="w-10 bg-transparent border border-edge rounded text-[10px] text-center text-inkMuted"
          onChange={(e) => onChange({ ...chord, beats: Math.max(0.5, Number(e.target.value) || chord.beats) })}
        />
        <span className="text-[10px] text-inkMuted">beats</span>
      </div>

      <select
        className="mt-1 w-full bg-transparent border border-edge rounded text-[10px] text-inkMuted text-center"
        value={chord.quality}
        onClick={(e) => e.stopPropagation()}
        onChange={(e) => onChange({ ...chord, quality: e.target.value as Chord["quality"] })}
      >
        {CHORD_QUALITIES.map((q) => (
          <option key={q} value={q}>{q}</option>
        ))}
      </select>

      {chord.isSubstitution && (
        <div className="text-[10px] text-accent mt-1">sub of {chord.substitutedFrom}</div>
      )}

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
