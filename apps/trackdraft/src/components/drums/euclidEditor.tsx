import { twoThreeCellCounts, euclidOnsetSteps, numerator as outlineNumerator } from "@drum/library";
import type { MeterOutline } from "../../types/blueprint";
import Knob from "../common/Knob";
import { usePalette, withAlpha } from "../../theme/palette";
import { handCell } from "../../theme/handDrawn";

/** Shared Euclidean rhythm primitives — the same Length/Density/Offset
 *  sliders + step strips used by the Drums editor's outline authoring, so
 *  Harmony's Euclidean rhythm control reuses exactly the same engine and
 *  the two can never drift in how a k/n outline is presented.
 */

export function SliderRow({ label, min, max, value, display, onChange }: {
  label: string; min: number; max: number; value: number; display?: number; onChange: (v: number) => void;
}) {
  const hi = Math.max(min, max);
  return (
    <div className="flex items-center gap-2" title={label}>
      <Knob
        value={Math.min(value, hi)}
        min={min}
        max={hi}
        step={1}
        size={28}
        defaultValue={min}
        onChange={onChange}
        className="text-accent"
      />
      <div className="min-w-0 flex-1">
        <span className="block font-mono text-2xs uppercase tracking-wider text-inkMuted truncate">{label}</span>
        <span className="block text-ink tabular-nums font-mono text-xs leading-tight">{display ?? value}</span>
      </div>
    </div>
  );
}

/** Length (n) / Density (k) / Offset (rotation) — the intuitive way to
 *  author "k pulses spread as evenly as possible across n steps". */
export function EuclidSliders({ n, k, rotation, onChange }: {
  n: number; k: number; rotation: number;
  onChange: (n: number, k: number, r: number) => void;
}) {
  const validCounts = twoThreeCellCounts(n);
  const kIndex = Math.max(0, validCounts.indexOf(k));
  const kMax = Math.max(0, validCounts.length - 1);
  return (
    <div className="space-y-2.5">
      <SliderRow
        label="Length"
        min={2}
        max={16}
        value={n}
        onChange={(v) => {
          // Change ONLY the length — keep the current density/offset, and
          // only snap them if they can't exist at the new length.
          const counts = twoThreeCellCounts(v);
          const nextK = counts.includes(k) ? k : (counts[0] ?? k);
          onChange(v, nextK, Math.min(rotation, Math.max(0, nextK - 1)));
        }}
      />
      <SliderRow
        label="Density"
        min={0}
        max={kMax}
        value={Math.min(kIndex, kMax)}
        display={validCounts[Math.min(kIndex, kMax)]}
        onChange={(idx) => {
          // Change ONLY the density — keep the offset (clamped to fit).
          const nextK = validCounts[Math.round(idx)] ?? k;
          onChange(n, nextK, Math.min(rotation, Math.max(0, nextK - 1)));
        }}
      />
      <SliderRow
        label="Offset"
        min={0}
        max={Math.max(0, k - 1)}
        value={Math.min(rotation, Math.max(0, k - 1))}
        onChange={(r) => onChange(n, k, Math.round(r))}
      />
    </div>
  );
}

/** Narrow step-sequencer strip: n cells, the k onsets filled in. */
export function StepView({ outline, color }: { outline: MeterOutline; color?: string }) {
  const P = usePalette();
  const accent = color ?? P.track;
  const n = outlineNumerator(outline);
  const onsets: boolean[] = new Array(n).fill(false);
  let step = 0;
  for (const cell of outline.cells) {
    if (step < n) onsets[step] = true;
    step += cell;
  }
  return (
    <div className="flex gap-px" title={outline.label}>
      {onsets.map((on, i) => (
        <div
          key={i}
          className={`h-3 w-3 rounded-[2px] ${P.handDrawn ? "hand-cell" : ""}${on && P.handDrawn ? " hand-cell--on" : ""}`}
          style={{
            background: on ? accent : withAlpha(P.grid, 0.28),
            ...(P.handDrawn ? { ...handCell(i + 3), "--hatch": `${40 + (i % 4) * 3}deg` } : null),
          } as React.CSSProperties}
        />
      ))}
    </div>
  );
}

/** Narrow step-sequencer strip for a free-form Euclidean pattern. `large`
 *  renders a bigger grid for the Voice-by-Voice editor's pattern display. */
export function EuclidStepView({ k, n, rotation, color, large }: { k: number; n: number; rotation: number; color?: string; large?: boolean }) {
  const P = usePalette();
  const onsets = euclidOnsetSteps({ k, n, rotation });
  const box = large ? "h-4 w-4 rounded-[3px]" : "h-3 w-3 rounded-[2px]";
  return (
    <div className="flex gap-px">
      {Array.from({ length: n }).map((_, i) => (
        <div
          key={i}
          className={`${box} ${P.handDrawn ? "hand-cell" : ""}${onsets.includes(i) && P.handDrawn ? " hand-cell--on" : ""}`}
          style={{
            background: onsets.includes(i) ? color ?? P.track : withAlpha(P.grid, 0.28),
            ...(P.handDrawn ? handCell(i + 11) : null),
          }}
        />
      ))}
    </div>
  );
}
