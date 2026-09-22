import type { ReactNode } from "react";
import Icon, { type IconName } from "./Icon";

/** Icon button — the shared glyph control: 20px tall, glyph-only, meaning
 *  in the tooltip. Born in the timeline strip (Spine), promoted to
 *  components/common/ when the context rail's panels became icon tabs —
 *  the first shared control of the shell chrome (T1 primitives
 *  territory; more icon surfaces are coming). Since the icon pass
 *  (2026-09-21) callers pass `icon` — an SVG from ./Icon — instead of a
 *  text glyph; the children form stays for legacy callers. */
export default function IconBtn({
  title,
  onClick,
  disabled = false,
  active = false,
  icon,
  children,
}: {
  title: string;
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
  icon?: IconName;
  children?: ReactNode;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      title={title}
      className={`h-[20px] min-w-[24px] px-1 flex items-center justify-center rounded border text-[12px] leading-none font-mono ${
        active ? "border-accent/60 text-accent" : "border-edge text-ink/75"
      } ${disabled ? "opacity-30" : "hover:text-ink hover:border-inkMuted/60 hover:bg-panelAlt/50"}`}
    >
      {icon ? <Icon name={icon} /> : children}
    </button>
  );
}
