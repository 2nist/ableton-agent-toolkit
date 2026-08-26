import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy, arrayMove } from "@dnd-kit/sortable";
import { useSongStore } from "../../store/songStore";
import { addSection, removeSection, updateSection, updateRepeats, repeatsFor, applySongMap } from "../../lib/sections";
import { getSongMap } from "../../data/songMaps";
import { getGenreMap } from "../../data/genre-catalog/index";
import SectionCard from "./SectionCard";
import MapPicker from "./MapPicker";

export default function StructureView() {
  const currentSong = useSongStore((s) => s.currentSong());
  const updateCurrentSong = useSongStore((s) => s.updateCurrentSong);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  if (!currentSong) return null;
  const song = currentSong;

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const fromIndex = song.sections.findIndex((s) => s.id === active.id);
    const toIndex = song.sections.findIndex((s) => s.id === over.id);
    if (fromIndex === -1 || toIndex === -1) return;
    updateCurrentSong((s) => ({ ...s, sections: arrayMove(s.sections, fromIndex, toIndex) }));
  }

  return (
    <div className="p-4 max-w-3xl space-y-3">
      <MapPicker
        hasSections={song.sections.length > 0}
        onApply={(mapId, options) => {
          const map = getSongMap(mapId) ?? getGenreMap(mapId);
          if (map) updateCurrentSong((s) => applySongMap(s, map, options));
        }}
      />

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={song.sections.map((s) => s.id)} strategy={verticalListSortingStrategy}>
          <div className="space-y-2">
            {song.sections.map((section) => (
              <SectionCard
                key={section.id}
                section={section}
                repeats={repeatsFor(song, section.id)}
                onChange={(updater) => updateCurrentSong((s) => updateSection(s, section.id, updater))}
                onChangeRepeats={(repeats) => updateCurrentSong((s) => updateRepeats(s, section.id, repeats))}
                onDelete={() => updateCurrentSong((s) => removeSection(s, section.id))}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>

      {song.sections.length === 0 && (
        <p className="text-inkMuted text-sm">No sections yet — apply a template above or add one.</p>
      )}

      <div className="flex items-center gap-2">
        <button
          className="border border-edge rounded px-2.5 py-1.5 text-sm text-inkMuted hover:text-ink hover:bg-panelAlt"
          onClick={() => updateCurrentSong((s) => addSection(s))}
        >
          + Add section
        </button>
        {/* Agent-handoff affordance: the current song, as canonical
            blueprint JSON, straight to the clipboard — the same shape the
            *.trackdraft.json exports and the Ableton extension consume. */}
        <button
          className="border border-edge rounded px-3 py-2 text-sm text-inkMuted hover:text-ink hover:bg-panelAlt"
          title="Copy this song as blueprint JSON (the schema the Ableton extension reads)"
          onClick={() => void navigator.clipboard.writeText(JSON.stringify(song, null, 2))}
        >
          Copy song JSON
        </button>
      </div>
    </div>
  );
}
