import type { MapSlot } from "../../data/songMaps";

/**
 * The two ways a template can show itself before it is applied — shared by
 * the Structure picker and the dashboard's template cards, so both describe a
 * form the same way. "Narrative" is abstract enough that a name and a
 * sentence can't carry it; a shape can.
 */
/** The arc a template carries, as a picture.
 *
 *  "Narrative" is abstract enough that a name and a sentence can't describe
 *  it — tension rising then collapsing is a SHAPE, and the only honest way to
 *  show it before applying is to draw it. Two lines: tension solid, energy
 *  dashed, over the slot positions. Maps with no arc draw nothing.
 *
 *  Module scope, not inside the component: a component declared in a render
 *  body is a new type every render, which remounts its subtree. */
export function ArcSparkline({ slots }: { slots: MapSlot[] }) {
  const points = slots
    .map((slot, i) => ({ x: slots.length > 1 ? (i / (slots.length - 1)) * 100 : 50, n: slot.narrative }))
    .filter((p): p is { x: number; n: NonNullable<MapSlot["narrative"]> } => !!p.n);
  if (points.length < 2) return null;

  const line = (pick: (n: NonNullable<MapSlot["narrative"]>) => number) =>
    points.map((p) => `${p.x.toFixed(1)},${(26 - pick(p.n) * 24).toFixed(1)}`).join(" ");

  return (
    <svg
      viewBox="0 0 100 28"
      preserveAspectRatio="none"
      className="w-full h-7"
      style={{ color: "var(--ink-hand, currentColor)" }}
      aria-label="Tension and energy across the form"
    >
      <polyline points={line((n) => n.tension_profile)} fill="none" stroke="currentColor" strokeWidth={1.4} strokeOpacity={0.85} vectorEffect="non-scaling-stroke" />
      <polyline
        points={line((n) => n.rhythmic_energy)}
        fill="none" stroke="currentColor" strokeWidth={1.2} strokeOpacity={0.45} strokeDasharray="3 2.5"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

/** The form as a strip of sections — what you actually get, before you get it. */
export function SectionStrip({ slots }: { slots: MapSlot[] }) {
  return (
    <div className="flex flex-wrap gap-1">
      {slots.map((slot, i) => (
        <span
          key={`${slot.label}-${i}`}
          className="inline-flex items-center gap-1 rounded border border-edge bg-panelAlt px-1.5 py-0.5 text-2xs"
          title={slot.purpose || slot.label}
        >
          <span className="text-ink truncate max-w-[9rem]">{slot.label}</span>
          <span className="font-mono text-inkMuted/70 tabular-nums">
            {slot.bars ?? 8}b
            {slot.timeSignatureNumerator ? ` ${slot.timeSignatureNumerator}/${2 ** (slot.timeSignatureDenPower ?? 2)}` : ""}
          </span>
          {slot.narrative && <span className="text-[8px] opacity-60" title="carries a narrative arc">◆</span>}
        </span>
      ))}
    </div>
  );
}
