import type { SelectHTMLAttributes } from "react";

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
}

/** Styled native select — the app's selects are native today and this keeps
 *  that (keyboard/mobile behavior free) while unifying the chrome. */
export default function Select({ label, className = "", id, children, ...rest }: SelectProps) {
  const select = (
    <select
      id={id}
      className={`bg-panel border border-edge rounded px-2 py-1 text-xs text-ink focus:outline-none focus:border-accent/60 ${className}`}
      {...rest}
    >
      {children}
    </select>
  );
  if (!label) return select;
  return (
    <label className="flex flex-col gap-1">
      <span className="text-3xs font-mono uppercase tracking-wider text-inkMuted">{label}</span>
      {select}
    </label>
  );
}
