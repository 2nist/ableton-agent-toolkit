import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext, horizontalListSortingStrategy, arrayMove, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { pitchClass } from "@music-theory/core";
import type { NoteName, ScaleType } from "@music-theory/core";
import type { BlueprintSection, Chord, ChordPerformanceEffect } from "../../types/blueprint";
import { chordDisplayName, chordFunction, functionColorHex } from "../../lib/harmony/chordBuilder";

const CELL_W = 78;

const EFFECT_CYCLE: (ChordPerformanceEffect | undefined)[] = [
  undefined,
  { style: "strum" },
  { style: "pulse" },
  { style: "arp" },
];

/** Cycle a chord's performance effect through none → strum → pulse → arp → none. */
function nextPerformanceEffect(
  current: ChordPerformanceEffect | undefined,
): ChordPerformanceEffect | undefined {
  const idx = EFFECT_CYCLE.findIndex(
    (e) => e?.style === current?.style && (e === undefined) === (current === undefined),
  );
  return EFFECT_CYCLE[(idx + 1) % EFFECT_CYCLE.length];
}

/** Small shape-in-time glyph for a performance effect — legible at a glance in
 *  the slim effect lane so a strummed chord *looks* strummed. */
function EffectGlyph({ style }: { style: "strum" | "pulse" | "arp" }) {
  const stroke = "#ffa500";
  if (style === "strum")
    return (
      <svg width="30" height="16" aria-hidden="true">
        <g stroke={stroke} strokeWidth={1.8} strokeLinecap="round">
          <line x1="4" y1="13" x2="4" y2="7" /><line x1="11" y1="12" x2="11" y2="5" />
          <line x1="18" y1="11" x2="18" y2="3" /><line x1="25" y1="9" x2="25" y2="2" />
        </g>
      </svg>
    );
  if (style === "pulse")
    return (
      <svg width="30" height="16" aria-hidden="true">
        <g stroke={stroke} strokeWidth={1.8} strokeLinecap="round">
          <line x1="5" y1="13" x2="5" y2="4" /><line x1="12" y1="13" x2="12" y2="9" />
          <line x1="19" y1="13" x2="19" y2="4" /><line x1="26" y1="13" x2="26" y2="9" />
        </g>
      </svg>
    );
  // arp: ascending stepping pattern
  return (
    <svg width="30" height="16" aria-hidden="true">
      <g stroke={stroke} strokeWidth={1.8} strokeLinecap="round">
        <line x1="4" y1="12" x2="4" y2="8" /><line x1="11" y1="8" x2="11" y2="4" />
        <line x1="18" y1="4" x2="18" y2="8" /><line x1="25" y1="8" x2="25" y2="12" />
      </g>
    </svg>
  );
}

interface ProgressionTrackProps {
  section: BlueprintSection;
  keyName: NoteName;
  scale: ScaleType;
  selectedChordId: string | null;
  /** Selecting a chord (from a cell) opens its editor in the dock,
   *  driven by the shared harmonySelectionStore. */
  onSelectChord: (id: string) => void;
  onChangeChords: (chords: Chord[]) => void;
  /** Update a single chord in-place — used by the effect lane so a
   *  quick effect toggle doesn't force a full array replacement. */
  onUpdateChord: (id: string, update: Partial<Chord>) => void;
}

function SortableChordCell({
  chord,
  keyName,
  scale,
  isSelected,
  onSelect,
  onRemove,
}: {
  chord: Chord;
  keyName: NoteName;
  scale: ScaleType;
  isSelected: boolean;
  onSelect: () => void;
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: chord.id });
  const rootPc = pitchClass(chord.root);
  const func = chord.isSubstitution ? null : chordFunction(chord, scale);
  const stripe = chord.isSubstitution ? "#ffa500" : functionColorHex(func) ?? "#2e2e34";

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.5 : 1,
        width: CELL_W,
      }}
      className={`relative h-[40px] shrink-0 rounded-[5px] border bg-panelAlt cursor-pointer overflow-hidden pt-1 px-2 ${
        isSelected ? "border-accent ring-2 ring-accent" : "border-edge hover:border-inkMuted"
      }`}
      onClick={() => onSelect()}
    >
      <span className="absolute inset-y-0 left-0 w-[3px]" style={{ background: stripe }} />
      <div className="font-mono text-[9.5px] leading-none" style={{ color: chord.isSubstitution ? "#ffa500" : "#8a8a92" }}>
        {chord.romanNumeral}
      </div>
      <div className="text-[15px] font-semibold leading-tight mt-0.5" style={chord.isSubstitution ? { color: "#ffa500" } : undefined}>
        {chordDisplayName(rootPc, chord.quality, keyName)}
      </div>
      <button
        className="absolute top-0.5 right-1 text-[11px] leading-none text-inkMuted hover:text-red-400 p-0.5"
        aria-label="Remove chord"
        onPointerDown={(e) => e.stopPropagation()}
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

/** The progression and its effect lane as two vertically-aligned slim tracks —
 *  each chord sits directly above its own effect slot (matching fixed widths).
 *  Drag a chord to reorder; click a chord cell to select it, click an effect
 *  slot to cycle effects, right-click an effect slot to open the chord editor. */
export default function ProgressionTrack({
  section,
  keyName,
  scale,
  selectedChordId,
  onSelectChord,
  onChangeChords,
  onUpdateChord,
}: ProgressionTrackProps) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const from = section.chords.findIndex((c) => c.id === active.id);
    const to = section.chords.findIndex((c) => c.id === over.id);
    if (from === -1 || to === -1) return;
    onChangeChords(arrayMove(section.chords, from, to));
  }

  const empty = section.chords.length === 0;

  return (
    <>
      {/* Progression row */}
      <div className="grid grid-cols-[96px_1fr] items-stretch border-t border-edge">
        <div className="flex flex-col items-end justify-center gap-0.5 px-3 border-r border-edge">
          <span className="font-mono text-[9px] uppercase tracking-wider text-inkMuted">Progression</span>
          {!empty && <span className="font-mono text-[8.5px] text-inkMuted/70">{section.chords.length}</span>}
        </div>
        <div className="px-3 py-1.5 overflow-x-auto">
          {empty ? (
            <p className="text-xs text-inkMuted py-1.5">
              No chords yet — click a dashed cell on the honeycomb above to add one.
            </p>
          ) : (
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
              <SortableContext items={section.chords.map((c) => c.id)} strategy={horizontalListSortingStrategy}>
                <div className="flex gap-1.5 w-max">
                  {section.chords.map((chord, i) => (
                    <SortableChordCell
                      key={chord.id}
                      chord={chord}
                      keyName={keyName}
                      scale={scale}
                      isSelected={selectedChordId === chord.id}
                      onSelect={() => onSelectChord(chord.id)}
                      onRemove={() => onChangeChords(section.chords.filter((c) => c.id !== chord.id))}
                    />
                  ))}
                </div>
              </SortableContext>
            </DndContext>
          )}
        </div>
      </div>

      {/* Effect lane — click to cycle, right-click to open editor */}
      <div className="grid grid-cols-[96px_1fr] items-stretch border-t border-edge">
        <div className="flex items-center justify-end px-3 border-r border-edge">
          <span className="font-mono text-[9px] uppercase tracking-wider text-inkMuted">Effects</span>
        </div>
        <div className="px-3 py-1.5 overflow-x-auto">
          {empty ? (
            <div className="h-[32px]" />
          ) : (
            <div className="flex gap-1.5 w-max">
              {section.chords.map((chord) => (
                <button
                  key={chord.id}
                  style={{ width: CELL_W }}
                  className={`h-[32px] shrink-0 rounded-[5px] border flex items-center justify-center ${
                    chord.performance ? "border-accent/60 border-solid" : "border-edge border-dashed"
                  } bg-[#131316] hover:border-inkMuted`}
                  title={chord.performance ? `${chord.performance.style} — click to cycle, right-click to edit` : "Add a performance effect"}
                  onClick={() => {
                    const next = nextPerformanceEffect(chord.performance);
                    onUpdateChord(chord.id, { performance: next });
                    onSelectChord(chord.id);
                  }}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    onSelectChord(chord.id);
                  }}
                >
                  {chord.performance ? (
                    <span className="flex items-center gap-1.5">
                      <EffectGlyph style={chord.performance.style} />
                      <span className="font-mono text-[8.5px] uppercase tracking-wide text-accent">{chord.performance.style}</span>
                    </span>
                  ) : (
                    <span className="font-mono text-[8.5px] uppercase tracking-wide text-inkMuted/60">+ effect</span>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

    </>
  );
}