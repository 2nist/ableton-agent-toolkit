import { useState } from "react";
import { barLengths, meterForLength, type BlueprintSection, type MeterChange } from "../../types/blueprint";

/**
 * The section's per-bar meter, when it has one.
 *
 * A chart that changes meter mid-section (every Zappa transcription does)
 * carries a `meterMap` rather than a single meter, and it has to be
 * editable: the importer's read of bar 17 is a transcription, not a fact.
 *
 * The list is of *changes*, not of bars, because that is what a meter map is
 * — a bar inherits the change above it until the next one. Editing bar 17
 * therefore means editing the change at bar 17, which is why each row shows
 * the bars it governs.
 */
export default function MeterMapPanel({
  section,
  onChange,
}: {
  section: BlueprintSection;
  onChange: (map: MeterChange[] | undefined) => void;
}) {
  const [open, setOpen] = useState(false);
  const changes = section.meterMap ?? [];
  const lengths = barLengths(section);
  const bars = Math.max(0, Math.floor(section.bars));
  const declared = meterForLength(bars > 0 ? lengths[0] : 4);
  const spans = changes.map((change, i) => ({
    change,
    from: change.bar + 1,
    to: (changes[i + 1]?.bar ?? bars) ,
  }));

  const write = (next: MeterChange[]) => {
    // One change covering the section is the same as having no map at all —
    // keeping it would leave two ways to say "4/4".
    onChange(next.length > 1 ? next : undefined);
  };

  const setAt = (bar: number, patch: Partial<MeterChange>) => {
    write(
      changes
        .map((change) => (change.bar === bar ? { ...change, ...patch } : change))
        .filter((change) => change.numerator > 0 && change.denominator > 0)
        .sort((a, b) => a.bar - b.bar),
    );
  };

  const addChange = () => {
    const last = changes[changes.length - 1]?.bar ?? 0;
    const bar = Math.min(bars - 1, last + 1);
    if (bar <= 0 || changes.some((change) => change.bar === bar)) return;
    write([...changes, { bar, numerator: 4, denominator: 4 }].sort((a, b) => a.bar - b.bar));
  };

  return (
    <div className="p-2.5 border-b border-edge">
      <div className="flex items-center justify-between">
        <span
          className="font-mono text-3xs uppercase tracking-wider text-inkMuted"
          title="Meter per bar — a section whose meter changes partway through carries a map of changes instead of one meter"
        >
          Meter
        </span>
        <div className="flex items-center gap-1.5">
          <span className="font-mono text-2xs text-ink">
            {declared.numerator}/{declared.denominator}
          </span>
          <button
            type="button"
            className="rounded border border-edge px-1.5 py-0.5 text-[10px] font-mono text-inkMuted hover:border-accent/70 hover:text-accent"
            onClick={() => setOpen((v) => !v)}
            aria-pressed={open}
            title={changes.length > 0 ? `${changes.length} meter change(s) in this section` : "One meter for the whole section"}
          >
            {open ? "▾" : "▸"} {changes.length > 0 ? `${changes.length} change${changes.length === 1 ? "" : "s"}` : "single"}
          </button>
        </div>
      </div>

      {open && (
        <div className="mt-1.5 flex flex-col gap-1">
          {changes.length === 0 && (
            <p className="text-3xs font-mono text-inkMuted/60">
              One meter across the section. Add a change to vary it.
            </p>
          )}

          {spans.map(({ change, from, to }) => (
            <div key={change.bar} className="flex items-center gap-1 font-mono text-2xs">
              <span className="w-14 shrink-0 text-3xs text-inkMuted/70">
                bars {from}–{Math.max(from, to)}
              </span>
              {(["numerator", "denominator"] as const).map((axis) => (
                <span key={axis} className="flex items-center rounded border border-edge">
                  <button
                    type="button"
                    className="px-1 text-inkMuted hover:text-ink"
                    onClick={() => setAt(change.bar, { [axis]: Math.max(1, change[axis] - 1) })}
                    aria-label={`${axis} down`}
                  >
                    –
                  </button>
                  <span className="min-w-[16px] text-center text-ink">{change[axis]}</span>
                  <button
                    type="button"
                    className="px-1 text-inkMuted hover:text-ink"
                    onClick={() => setAt(change.bar, { [axis]: change[axis] + 1 })}
                    aria-label={`${axis} up`}
                  >
                    +
                  </button>
                </span>
              ))}
              <span className="flex-1" />
              <button
                type="button"
                className="px-1 text-inkMuted/60 hover:text-ink"
                onClick={() => write(changes.filter((c) => c.bar !== change.bar))}
                aria-label={`Remove the meter change at bar ${from}`}
                title="Remove this change — the bars fall back to the meter above"
              >
                ✕
              </button>
            </div>
          ))}

          <div className="flex items-center gap-2 pt-0.5">
            <button
              type="button"
              className="rounded border border-edge px-1.5 py-0.5 text-[10px] font-mono text-inkMuted hover:border-accent/70 hover:text-accent disabled:opacity-40"
              onClick={addChange}
              disabled={bars <= 1}
              title="Add a meter change one bar after the last one"
            >
              + change
            </button>
            {changes.length > 0 && (
              <button
                type="button"
                className="text-[10px] font-mono text-inkMuted/60 hover:text-ink"
                onClick={() => onChange(undefined)}
                title="Drop the map — the whole section returns to one meter"
              >
                single meter
              </button>
            )}
          </div>

          <p className="text-[9px] font-mono text-inkMuted/45">
            {bars} bar{bars === 1 ? "" : "s"} · {lengths.reduce((n, l) => n + l, 0)} beats
          </p>
        </div>
      )}
    </div>
  );
}
