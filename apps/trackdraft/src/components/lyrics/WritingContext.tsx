import type { BlueprintSong } from "../../types/blueprint";

interface WritingContextProps {
  song: BlueprintSong;
}

function Field({ label, value }: { label: string; value?: string }) {
  if (!value) return null;
  return (
    <div>
      <p className="text-[10px] text-inkMuted uppercase tracking-wide">{label}</p>
      <p className="text-xs leading-5">{value}</p>
    </div>
  );
}

/** Read-only reference pulled from the dock's Info panel (formerly the
 *  standalone Details tab) -- concept, vocal delivery, and lyrical content
 *  are exactly the creative direction you'd want visible while actually
 *  writing lyrics, instead of switching dock panels to remember them. */
export default function WritingContext({ song }: WritingContextProps) {
  const hasAny = song.concept || song.notes?.vocalDelivery || song.notes?.lyricalContent;
  if (!hasAny) {
    return (
      <div className="border border-edge rounded bg-panel p-3">
        <p className="text-xs text-inkMuted">
          No concept or notes yet — fill those in on the dock's Info panel to see them here while writing.
        </p>
      </div>
    );
  }

  return (
    <div className="border border-edge rounded bg-panel p-3 space-y-2">
      <p className="text-xs text-inkMuted uppercase tracking-wide">Writing context</p>
      <Field label="Concept" value={song.concept} />
      <Field label="Vocal delivery" value={song.notes?.vocalDelivery} />
      <Field label="Lyrical content" value={song.notes?.lyricalContent} />
    </div>
  );
}
