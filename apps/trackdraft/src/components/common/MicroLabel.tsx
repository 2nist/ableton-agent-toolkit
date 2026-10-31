import type { ReactNode } from "react";

/** Literal classes, not `text-${size}` — Tailwind scans source text, so an
 *  interpolated size would silently drop both sizes from the stylesheet. */
const SIZE_CLASS = { "3xs": "text-3xs", "2xs": "text-2xs" } as const;

/**
 * The panel / field micro-label: mono · uppercase · tracked · muted.
 *
 * This recipe was copied verbatim into thirteen call sites across six files
 * before it lived here, which is how the same kind of label ended up at four
 * different sizes and two letter-spacings. `MicroLabel` owns the recipe;
 * a call site may add layout (`block mb-1`) but never re-states the type.
 *
 * `as` exists for the same reason as on `TapeLabel`: some call sites are
 * `<label>`s that point at a control, others are plain spans, and swapping
 * the tag would break label-click behaviour.
 */
export default function MicroLabel({
  children,
  as: Tag = "span",
  size = "3xs",
  className = "",
  title,
}: {
  children: ReactNode;
  as?: "span" | "div" | "p" | "label";
  /** Two steps only: `3xs` for panel/field titles, `2xs` for a row label
   *  that sits beside a control. Anything else is a new size, not a variant. */
  size?: "3xs" | "2xs";
  /** Layout only — the type recipe is fixed above. */
  className?: string;
  title?: string;
}) {
  return (
    <Tag
      className={`${SIZE_CLASS[size]} font-mono uppercase tracking-wider text-inkMuted ${className}`.trim()}
      title={title}
    >
      {children}
    </Tag>
  );
}
