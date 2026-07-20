import { useState } from "react";
import type { SectionRole } from "../../types/blueprint";

const ROLES: SectionRole[] = ["intro", "verse", "pre_chorus", "chorus", "bridge", "solo", "breakdown", "outro", "custom"];

export interface SectionMarkerProps {
  lineCount: number;
  /** Existing sections a "Merge into" target can be picked from — typically the section immediately before the selection, plus any other real (non-"Unassigned") section. */
  mergeTargets: { id: string; name: string }[];
  onMarkAsSection: (target: { role: SectionRole; name: string }) => void;
  onMergeInto: (targetSectionId: string) => void;
  onSplitHere: () => void;
  onUnassign: () => void;
  onCancel: () => void;
}

/** The floating action bar that appears once a line range is selected in
 *  LyricsView's "Song text" mode — the UI surface for sectionize.ts's four
 *  operations (mark/merge/split/unassign). Kept purely presentational; all
 *  the actual line-range math lives in sectionize.ts. */
export default function SectionMarker({
  lineCount,
  mergeTargets,
  onMarkAsSection,
  onMergeInto,
  onSplitHere,
  onUnassign,
  onCancel,
}: SectionMarkerProps) {
  const [role, setRole] = useState<SectionRole>("verse");
  const [name, setName] = useState("New Section");
  const [mergeTargetId, setMergeTargetId] = useState(mergeTargets[0]?.id ?? "");

  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 bg-panel border border-edge rounded shadow-lg px-4 py-3 flex items-center gap-3 z-50">
      <span className="text-xs text-inkMuted whitespace-nowrap">
        {lineCount} line{lineCount === 1 ? "" : "s"} selected
      </span>

      <div className="flex items-center gap-1">
        <select
          className="bg-panelAlt border border-edge rounded text-sm px-2 py-1"
          value={role}
          onChange={(e) => setRole(e.target.value as SectionRole)}
        >
          {ROLES.map((r) => (
            <option key={r} value={r}>{r}</option>
          ))}
        </select>
        <input
          className="bg-panelAlt border border-edge rounded text-sm px-2 py-1 w-32"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Section name"
        />
        <button
          className="bg-accent text-black text-sm font-medium px-3 py-1 rounded"
          onClick={() => onMarkAsSection({ role, name })}
        >
          Mark as section
        </button>
      </div>

      {mergeTargets.length > 0 && (
        <div className="flex items-center gap-1 border-l border-edge pl-3">
          <select
            className="bg-panelAlt border border-edge rounded text-sm px-2 py-1 max-w-32"
            value={mergeTargetId}
            onChange={(e) => setMergeTargetId(e.target.value)}
          >
            {mergeTargets.map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
          <button
            className="border border-edge rounded text-sm px-3 py-1 text-inkMuted hover:text-ink hover:bg-panelAlt"
            onClick={() => mergeTargetId && onMergeInto(mergeTargetId)}
          >
            Merge into
          </button>
        </div>
      )}

      <button
        className="border border-edge rounded text-sm px-3 py-1 text-inkMuted hover:text-ink hover:bg-panelAlt"
        onClick={onSplitHere}
        title="Break the containing section into two at this point, keeping its role"
      >
        Split here
      </button>

      <button
        className="border border-edge rounded text-sm px-3 py-1 text-inkMuted hover:text-ink hover:bg-panelAlt"
        onClick={onUnassign}
        title="Park these lines in a visible Unassigned section for later"
      >
        Unassign
      </button>

      <button className="text-inkMuted hover:text-ink text-sm px-2" onClick={onCancel}>
        ✕
      </button>
    </div>
  );
}
