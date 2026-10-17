import type { ButtonHTMLAttributes, ReactNode } from "react";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md";

const VARIANTS: Record<Variant, string> = {
  primary: "bg-accent text-black font-medium border border-accent hover:bg-accent/90",
  secondary: "border border-edge text-inkMuted hover:text-ink hover:bg-panelAlt",
  ghost: "border border-transparent text-inkMuted hover:text-ink hover:bg-panelAlt",
  danger: "border border-red-500/60 text-red-400 hover:bg-red-500/10",
};

const SIZES: Record<Size, string> = {
  sm: "px-2 py-0.5 text-[10px]",
  md: "px-3 py-1 text-xs",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  children: ReactNode;
}

/** The canonical button recipe. New UI should use this rather than repeating
 *  the class strings; existing call sites migrate as their station is
 *  touched (docs/ui-standardization.md Phase 1). */
export default function Button({
  variant = "secondary",
  size = "md",
  className = "",
  type = "button",
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={`rounded disabled:opacity-40 disabled:cursor-not-allowed ${VARIANTS[variant]} ${SIZES[size]} ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}
