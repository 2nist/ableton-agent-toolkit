import { useEffect, useId, useState, type ReactNode } from "react";

function HexField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  const id = useId();
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const valid = /^#[0-9a-f]{6}$/i.test(draft);
  function commit() {
    if (valid) onChange(draft.toUpperCase());
    else setDraft(value);
  }
  return (
    <input
      id={id}
      aria-label={`${label} hex value`}
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); if (event.key === "Escape") { setDraft(value); event.currentTarget.blur(); } }}
      spellCheck={false}
      className={`w-[76px] rounded-sm border bg-canvas px-1.5 py-1 font-mono text-3xs uppercase outline-none ${valid ? "border-edge focus:border-info" : "border-danger text-danger"}`}
    />
  );
}

export function ColorField({ label, value, onChange, note }: { label: string; value: string; onChange: (value: string) => void; note?: string }) {
  const id = useId();
  return (
    <div className="flex min-w-0 items-center gap-2 py-1.5">
      <input id={id} aria-label={`${label} color`} type="color" value={value} onChange={(event) => onChange(event.target.value.toUpperCase())} className="h-7 w-8 shrink-0 cursor-pointer rounded-sm border border-edge bg-panel p-0.5" />
      <label htmlFor={id} className="min-w-0 flex-1 truncate text-2xs" title={note ?? label}>{label}</label>
      <HexField label={label} value={value} onChange={onChange} />
    </div>
  );
}

export function SliderField({ label, value, min, max, step = 1, unit = "px", onChange }: {
  label: string; value: number; min: number; max: number; step?: number; unit?: string; onChange: (value: number) => void;
}) {
  return (
    <label className="block py-2.5">
      <span className="flex items-center justify-between gap-3 text-2xs"><span>{label}</span><output className="font-mono text-inkMuted">{value}{unit}</output></span>
      <input type="range" aria-label={label} min={min} max={max} step={step} value={value} onChange={(event) => onChange(Number(event.target.value))} className="fader mt-2 w-full" />
    </label>
  );
}

export function WorkshopGroup({ title, children, open = false }: { title: string; children: ReactNode; open?: boolean }) {
  return (
    <details open={open} className="border-b border-edge/50 py-1">
      <summary className="cursor-pointer select-none py-2 font-mono text-3xs font-semibold uppercase tracking-[0.12em] text-inkMuted hover:text-ink">{title}</summary>
      <div className="pb-3">{children}</div>
    </details>
  );
}
