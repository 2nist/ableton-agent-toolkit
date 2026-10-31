import type { ReactNode } from "react";

export interface SegmentedOption<T extends string | number> {
  id: T;
  label: ReactNode;
  /** The only place a dense chip can explain itself. */
  hint?: string;
}

/**
 * A group of mutually-exclusive chips — the app's most repeated control.
 *
 * BARS `1 2 4 8 16 ALL` · PLACE `triad 7th` · VIEW `front tilt top` ·
 * TOOLS `map rhythm midi` · the harmony desk switch · Table/Scene · the
 * layers row. Twelve wrappers of `flex overflow-hidden rounded border
 * border-edge` with the same `aria-pressed` + filled-active-when-selected
 * wiring, written out by hand each time.
 *
 * This is deliberately a *group*, not a generic `<Button>`: the repetition in
 * this codebase is the group and its state contract, not the button tag (404
 * of 413 buttons are multi-line JSX with per-site structure, so there is no
 * honest bulk conversion for them — see the note in
 * `docs/ui-standardization.md`).
 *
 * Two sizes, because the two real call sites differ and unifying them by
 * fiat would change the pixels of one:
 *   dense  — inside a toolbar row that already sets its own type (FloorBand)
 *   normal — stands alone (the desk switch)
 */
export default function Segmented<T extends string | number>({
  label,
  value,
  options,
  onChange,
  variant = "dense",
  disabled = false,
}: {
  /** Optional leading word, styled as the toolbar's micro-label. */
  label?: string;
  value: T;
  options: readonly SegmentedOption<T>[];
  onChange: (value: T) => void;
  variant?: "dense" | "normal";
  disabled?: boolean;
}) {
  const chip =
    variant === "dense"
      ? "border-r border-edge px-1 py-0.5 last:border-r-0"
      : "border-r border-edge px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.08em] last:border-r-0";

  return (
    <span className="flex items-center gap-1">
      {label ? (
        <span className="text-[8px] uppercase tracking-wider text-inkMuted/70">
          {label}
        </span>
      ) : null}
      <span className="flex overflow-hidden rounded border border-edge">
        {options.map((option) => (
          <button
            key={String(option.id)}
            type="button"
            aria-pressed={value === option.id}
            disabled={disabled}
            title={option.hint}
            onClick={() => onChange(option.id)}
            className={`${chip} disabled:opacity-40 ${
              value === option.id ? "bg-accent text-accentInk" : "hover:text-ink"
            }`}
          >
            {option.label}
          </button>
        ))}
      </span>
    </span>
  );
}
