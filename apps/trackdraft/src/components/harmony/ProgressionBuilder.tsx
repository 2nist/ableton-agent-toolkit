import { useEffect, useState } from "react";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext, horizontalListSortingStrategy, arrayMove } from "@dnd-kit/sortable";
import type { ScaleType, NoteName } from "@music-theory/core";
import type { BlueprintSection, Chord } from "../../types/blueprint";
import { getPreviewPlayer } from "../../lib/harmony/audioPreview";
import ChordCard from "./ChordCard";

interface ProgressionBuilderProps {
  section: BlueprintSection;
  keyName: NoteName;
  scale: ScaleType;
  bpm: number;
  selectedChordId: string | null;
  onSelectChord: (id: string | null) => void;
  onChangeChords: (chords: Chord[]) => void;
}

export default function ProgressionBuilder({
  section,
  keyName,
  scale,
  bpm,
  selectedChordId,
  onSelectChord,
  onChangeChords,
}: ProgressionBuilderProps) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  const [isPlaying, setIsPlaying] = useState(false);
  const [playingIndex, setPlayingIndex] = useState<number | null>(null);

  // Stop playback whenever the section changes or this view unmounts —
  // otherwise switching sections while a progression loops leaves it
  // sounding against chords the user can no longer see.
  useEffect(() => {
    return () => getPreviewPlayer().stop();
  }, [section.id]);

  function updateChord(index: number, updated: Chord) {
    onChangeChords(section.chords.map((c, i) => (i === index ? updated : c)));
  }

  function removeChord(index: number) {
    onChangeChords(section.chords.filter((_, i) => i !== index));
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const fromIndex = section.chords.findIndex((c) => c.id === active.id);
    const toIndex = section.chords.findIndex((c) => c.id === over.id);
    if (fromIndex === -1 || toIndex === -1) return;
    onChangeChords(arrayMove(section.chords, fromIndex, toIndex));
  }

  function togglePlay() {
    const player = getPreviewPlayer();
    if (isPlaying) {
      player.stop();
      setIsPlaying(false);
      setPlayingIndex(null);
      return;
    }
    setIsPlaying(true);
    player.playProgression(section.chords, bpm, {
      loop: true,
      onChordStart: setPlayingIndex,
    });
  }

  return (
    <div className="space-y-3">
      <div>
        <div className="flex items-center justify-between mb-1">
          <p className="text-xs text-inkMuted uppercase tracking-wide">Progression</p>
          {section.chords.length > 0 && (
            <button
              className="text-xs border border-edge rounded px-2 py-0.5 text-inkMuted hover:text-ink hover:bg-panelAlt"
              onClick={togglePlay}
            >
              {isPlaying ? "■ Stop" : "▸ Play"}
            </button>
          )}
        </div>
        {section.chords.length === 0 ? (
          <p className="text-sm text-inkMuted">No chords yet — click a dashed cell on the honeycomb above to add one.</p>
        ) : (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={section.chords.map((c) => c.id)} strategy={horizontalListSortingStrategy}>
              <div className="flex flex-wrap gap-2">
                {section.chords.map((chord, i) => (
                  <ChordCard
                    key={chord.id}
                    chord={chord}
                    keyName={keyName}
                    scale={scale}
                    isSounding={playingIndex === i}
                    isSelected={selectedChordId === chord.id}
                    onSelect={() => onSelectChord(chord.id)}
                    onChange={(updated) => updateChord(i, updated)}
                    onRemove={() => removeChord(i)}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        )}
      </div>
    </div>
  );
}
