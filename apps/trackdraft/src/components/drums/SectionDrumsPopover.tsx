import DrumsDockTools from "./DrumsDockTools";

/** The click-on-the-timeline editor for a section's drums — the modal
 *  counterpart to `TransitionPopover`, replacing the old persistent
 *  right-side dock panel. Clicking a section on the timeline opens this
 *  in place (the design reference's "modal menu on click of timeline"
 *  interaction); the inner controls are the same `DrumsDockTools` the
 *  dock used to show, in its compact variant, so there's exactly one
 *  editor with two hosts — never a fork of the editing logic.
 *
 *  Positioning is intentionally dumb (caller passes pixel coords already
 *  clamped to the scroll container); this shell only adds the header,
 *  the close affordance, and the scroll confinement. Clicking outside
 *  closes it via `DrumsView`'s document-level listener. */
export default function SectionDrumsPopover({
  left,
  top,
  onClose,
}: {
  left: number;
  top: number;
  onClose: () => void;
}) {
  return (
    <div
      data-section-drums-popover
      className="absolute z-10 w-80 max-h-[70vh] overflow-y-auto rounded border border-edge bg-panelAlt p-2.5 shadow-lg"
      style={{ left, top }}
    >
      <div className="flex items-center justify-between mb-1.5">
        <span className="font-mono text-3xs uppercase tracking-wider text-inkMuted">Section drums</span>
        <button className="text-inkMuted hover:text-ink leading-none text-sm" onClick={onClose} title="Close">
          &times;
        </button>
      </div>
      <DrumsDockTools compact />
    </div>
  );
}
