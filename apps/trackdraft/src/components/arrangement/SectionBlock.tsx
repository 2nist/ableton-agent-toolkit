import type { MouseEvent as ReactMouseEvent, ReactNode } from "react";
import type { SectionSpan } from "../../lib/arrangement";
import { useRoleStyle } from "../../lib/roleColors";

export type SectionBlockVariant = "spine" | "timeline";

/** The section-as-a-block renderer shared by the spine and the arrangement
 *  timeline. It owns the anatomy both surfaces already agreed on — role
 *  colour, the selected / in-selection ring, the name + bars readout, the
 *  optional resize grips — and nothing about the axis: `width` arrives as a
 *  prop because the two surfaces scale bars differently on purpose (the
 *  timeline's factor is documented in `ArrangementTimeline`). */
export interface SectionBlockProps {
  span: SectionSpan;
  /** Rendered width in px. The caller owns the axis. */
  width: number;
  /** The focused section — the one single-section views follow. */
  selected: boolean;
  /** Part of a multi-selection that also includes other sections. */
  inSelection: boolean;
  variant: SectionBlockVariant;
  onSelect: (event: ReactMouseEvent<HTMLButtonElement>) => void;
  /** Right-click palette (spine). */
  onMenu?: (event: ReactMouseEvent<HTMLButtonElement>) => void;
  onDoubleClick?: (event: ReactMouseEvent<HTMLButtonElement>) => void;
  /** Hover + focus, measured over the whole column including `readout`. */
  onHoverChange?: (hovered: boolean) => void;
  onResize?: (event: ReactMouseEvent, side: "left" | "right") => void;
  canResizeLeft?: boolean;
  canResizeRight?: boolean;
  /** Browser tooltip naming what the block holds. */
  title?: string;
  /** Hide the name below the caller's legibility threshold. */
  showName?: boolean;
  /** The bars/beats readout under the name. */
  meta?: string;
  metaTitle?: string;
  /** Extra in-block chrome — the spine's coverage gauge and now-playing line. */
  children?: ReactNode;
  /** A strip under the block (the timeline's per-stem readout). Its presence
   *  turns the block into a column and owns the hover target. */
  readout?: ReactNode;
}

const FRAME: Record<SectionBlockVariant, string> = {
  spine:
    "relative shrink-0 h-full flex flex-col justify-center items-start overflow-hidden text-left border-r border-black/25",
  timeline:
    "h-12 rounded-[4px] flex flex-col items-start justify-center px-2 overflow-hidden transition-opacity text-left",
};

const RINGS: Record<SectionBlockVariant, { selected: string; inSelection: string; idle: string }> = {
  spine: {
    selected: "ring-1 ring-accent ring-inset z-10",
    inSelection: "ring-1 ring-accent/55 ring-inset z-10 brightness-110",
    idle: "hover:brightness-110",
  },
  timeline: {
    selected: "ring-1 ring-accent ring-inset opacity-100",
    inSelection: "ring-1 ring-accent/55 ring-inset opacity-100",
    idle: "hover:opacity-90",
  },
};

const NAME: Record<SectionBlockVariant, string> = {
  spine: "hand-value hand-value--tight w-full truncate px-1.5 text-[15px] leading-tight font-medium",
  timeline: "text-[10.5px] font-medium leading-tight truncate w-full",
};

const META: Record<SectionBlockVariant, string> = {
  spine: "px-1.5 mt-0.5 text-[9px] font-mono opacity-70 tabular-nums truncate",
  timeline: "text-[9px] opacity-80 font-mono leading-tight",
};

export function SectionBlock({
  span,
  width,
  selected,
  inSelection,
  variant,
  onSelect,
  onMenu,
  onDoubleClick,
  onHoverChange,
  onResize,
  canResizeLeft = false,
  canResizeRight = false,
  title,
  showName = true,
  meta,
  metaTitle,
  children,
  readout,
}: SectionBlockProps) {
  const style = useRoleStyle()(span.section.role);
  const ring = RINGS[variant];
  // Edge zones narrow with the block (30% per side, 1..5px): a fixed 5px
  // pair fully covered a 1-bar block at the default zoom — every click
  // landed on a resize zone, so the section could not be SELECTED.
  const edgeW = Math.min(5, Math.max(1, width * 0.3));

  const button = (
    <button
      type="button"
      {...(variant === "spine"
        ? { "data-spine-block": span.sectionId }
        : { "data-timeline-block": span.sectionId })}
      aria-pressed={inSelection}
      className={`${FRAME[variant]} ${selected ? ring.selected : inSelection ? ring.inSelection : ring.idle}`}
      style={{ width: readout ? undefined : width, background: style.bg, color: style.text }}
      onClick={onSelect}
      onContextMenu={onMenu}
      onDoubleClick={onDoubleClick}
      title={title}
    >
      {onResize && (
        <>
          {canResizeLeft && (
            <span
              data-resize-zone
              className="absolute left-0 top-0 bottom-0 cursor-ew-resize z-20 hover:bg-accent/30"
              style={{ width: edgeW }}
              onMouseDown={(event) => onResize(event, "left")}
              title="Drag to move this boundary — the previous section grows/shrinks"
            />
          )}
          {canResizeRight && (
            <span
              data-resize-zone
              className="absolute right-0 top-0 bottom-0 cursor-ew-resize z-20 hover:bg-accent/30"
              style={{ width: edgeW }}
              onMouseDown={(event) => onResize(event, "right")}
              title="Drag to resize this section"
            />
          )}
        </>
      )}
      {children}
      <span className={NAME[variant]}>
        {showName ? span.section.name : ""}
        {showName && variant === "spine" && span.variation ? (
          <span className="opacity-60"> ({span.variation})</span>
        ) : null}
      </span>
      {meta && (
        <span className={META[variant]} title={metaTitle}>
          {meta}
        </span>
      )}
    </button>
  );

  if (!readout) return button;

  return (
    <div
      className="shrink-0 flex flex-col"
      style={{ width }}
      onMouseEnter={() => onHoverChange?.(true)}
      onMouseLeave={() => onHoverChange?.(false)}
      onFocus={() => onHoverChange?.(true)}
      onBlur={() => onHoverChange?.(false)}
    >
      {button}
      {readout}
    </div>
  );
}
