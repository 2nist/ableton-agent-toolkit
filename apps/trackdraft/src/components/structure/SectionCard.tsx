import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { BlueprintSection } from "../../types/blueprint";
import SectionEditor from "./SectionEditor";

/**
 * A sortable card on the Structure page. Everything about the section's
 * fields lives in `SectionEditor` — this wrapper only owns the drag handle
 * and the drop animation, so the page and the Workbench rail cannot drift
 * apart again.
 */
interface SectionCardProps {
  section: BlueprintSection;
  repeats: number;
  onChange: (updater: (section: BlueprintSection) => BlueprintSection) => void;
  onChangeRepeats: (repeats: number) => void;
  onDelete: () => void;
}

export default function SectionCard({ section, repeats, onChange, onChangeRepeats, onDelete }: SectionCardProps) {
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
      className="border border-edge rounded bg-panel p-2.5"
    >
      <SectionEditor
        density="card"
        section={section}
        repeats={repeats}
        onChange={onChange}
        onChangeRepeats={onChangeRepeats}
        onDelete={onDelete}
        leading={
          <button
            {...attributes}
            {...listeners}
            className="cursor-grab text-inkMuted px-1 select-none shrink-0"
            aria-label="Drag to reorder"
          >
            ⠿
          </button>
        }
      />
    </div>
  );
}
