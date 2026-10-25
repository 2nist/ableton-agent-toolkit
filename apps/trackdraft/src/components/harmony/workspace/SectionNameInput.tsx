import { useRef, useState } from "react";

/** What an inline rename settles on: the trimmed name, or null to cancel.
 *  Blank and unchanged both mean "leave it alone" — an empty section name is
 *  not something the spine or the picker can show. */
export function resolveSectionName(current: string, next: string): string | null {
  const trimmed = next.trim();
  return trimmed.length > 0 && trimmed !== current ? trimmed : null;
}

type Props = {
  name: string;
  onCommit: (name: string) => void;
  onCancel: () => void;
  className?: string;
};

/**
 * Inline section rename. Enter or leaving the field keeps the new name,
 * Escape throws it away — the same rule in the band and in the bar sweep,
 * so both places read the same.
 */
export function SectionNameInput({ name, onCommit, onCancel, className }: Props) {
  const [value, setValue] = useState(name);
  const settled = useRef(false);

  function finish(commit: boolean) {
    if (settled.current) return;
    settled.current = true;
    const next = commit ? resolveSectionName(name, value) : null;
    if (next === null) onCancel();
    else onCommit(next);
  }

  return (
    <input
      autoFocus
      value={value}
      onChange={(event) => setValue(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          finish(true);
        }
        if (event.key === "Escape") {
          event.preventDefault();
          finish(false);
        }
      }}
      onBlur={() => finish(true)}
      placeholder="section name"
      className={className}
    />
  );
}
