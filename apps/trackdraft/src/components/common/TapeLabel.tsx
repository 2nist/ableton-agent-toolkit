import type { ReactNode } from "react";
import { usePalette } from "../../theme/palette";

/** How big the strip of tape is. Three steps, declared in theme/themes.css —
 *  a call site picks one instead of inventing a font size. */
export type TapeSize = "sm" | "md" | "lg";

/** Which way the strip leans. Neighbouring labels alternate so a column of
 *  them doesn't look machine-applied. */
export type TapeTilt = "left" | "right" | "none";

/**
 * A masking-tape header.
 *
 * Lives here so the studio-log theme has ONE implementation of the label:
 * before this, thirteen call sites each carried their own `text-3xs` /
 * `text-[11px]` / `text-xs`, and the same kind of panel header appeared at
 * four different sizes in one column. Size and lean are props now.
 *
 * The theme does the styling (`.tape-label`, gated on `[data-theme]`), so in
 * the dark theme the paper classes are simply absent and `className` provides
 * the original chrome styling — that keeps the dark app pixel-identical.
 */
export default function TapeLabel({
  children,
  size = "md",
  tilt = "left",
  className = "",
  title,
  onClick,
  as: Tag = "span",
}: {
  children: ReactNode;
  size?: TapeSize;
  tilt?: TapeTilt;
  /** The element to render. Kept as a prop so a call site that replaces a
   *  block-level `<p>` or `<div>` keeps its dark-theme layout — an inline
   *  `<span>` would silently drop `mb-1` and the line break. Headings are
   *  allowed because a section's own name is a header in both themes. */
  as?: "span" | "p" | "div" | "h2" | "h3";
  /** Layout + dark-theme typography. Ignored in the paper theme wherever the
   *  tape recipe sets the same property (size, colour, letter-spacing). */
  className?: string;
  title?: string;
  /** Headers that are also controls (the workbench's rename-on-click title). */
  onClick?: () => void;
}) {
  const handDrawn = usePalette().handDrawn;
  const tape = handDrawn
    ? `tape-label tape-label--${size}${tilt === "right" ? " tape-label--end" : tilt === "none" ? " tape-label--flat" : ""}`
    : "";
  return (
    <Tag className={`${tape} ${className}`.trim() || undefined} title={title} onClick={onClick}>
      {children}
    </Tag>
  );
}
