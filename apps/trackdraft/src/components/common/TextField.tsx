import type { InputHTMLAttributes } from "react";

export interface TextFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
}

/** Single-line text input with the shared panel/edge recipe. */
export default function TextField({ label, className = "", id, ...rest }: TextFieldProps) {
  const input = (
    <input
      id={id}
      className={`bg-panel border border-edge rounded px-2 py-1 text-xs text-ink placeholder:text-inkMuted/50 focus:outline-none focus:border-accent/60 ${className}`}
      {...rest}
    />
  );
  if (!label) return input;
  return (
    <label className="flex flex-col gap-1">
      <span className="text-3xs font-mono uppercase tracking-wider text-inkMuted">{label}</span>
      {input}
    </label>
  );
}
