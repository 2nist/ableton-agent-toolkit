/**
 * Inline panel editor — the Study desk's own controls.
 *
 * It lives inside the panel it edits (rather than in shell chrome) because
 * Study is a desk of the Harmony view, not a station: a facet that only
 * appears for one desk would have to lie about the view's tool set, and a
 * global rail for a desk-sized surface blurs the layout grammar.
 */

import { dimensionsFor, measuresFor } from "../../lib/study/fields";
import { useStudyStore } from "../../store/studyStore";
import type { Grain, PanelSpec } from "../../lib/study/types";

const SELECT = "rounded border border-edge bg-panelAlt px-1 py-0.5 font-mono text-[10px] text-ink";

const GRAINS: { id: Grain; label: string }[] = [
  { id: "song", label: "song" },
  { id: "section", label: "section" },
  { id: "chord", label: "chord" },
];

function defaultsForGrain(grain: Grain): Partial<PanelSpec> {
  if (grain === "chord") {
    return { dimension: "roman", row: "roman", col: "nextRoman", measures: ["count", "meanTension"] };
  }
  if (grain === "song") {
    return { dimension: "form", row: "form", col: "key", measures: ["count", "meanTension"] };
  }
  return { dimension: "role", row: "role", col: "meter", measures: ["count", "meanTension"] };
}

export default function PanelEditor({ panel }: { panel: PanelSpec }) {
  const updatePanel = useStudyStore((s) => s.updatePanel);
  const removePanel = useStudyStore((s) => s.removePanel);

  return (
    <div className="space-y-1.5 rounded border border-edge/70 bg-deep p-1.5">
      <div className="flex flex-wrap items-center gap-1">
        <span className="font-mono text-[8px] uppercase tracking-wider text-inkMuted/60">grain</span>
        <select
          className={SELECT}
          value={panel.grain}
          onChange={(event) => {
            const grain = GRAINS.find((entry) => entry.id === event.target.value);
            if (!grain) return;
            updatePanel(panel.id, { grain: grain.id, ...defaultsForGrain(grain.id) });
          }}
        >
          {GRAINS.map((grain) => (
            <option key={grain.id} value={grain.id}>
              {grain.label}
            </option>
          ))}
        </select>

        {panel.kind === "breakdown" || panel.kind === "distribution" ? (
          <>
            <span className="font-mono text-[8px] uppercase tracking-wider text-inkMuted/60">
              {panel.kind === "distribution" ? "field" : "group"}
            </span>
            <select
              className={SELECT}
              value={panel.dimension ?? ""}
              onChange={(event) => {
                const dimension = dimensionsFor(panel.grain).find((entry) => entry.key === event.target.value);
                if (!dimension) return;
                updatePanel(panel.id, {
                  dimension: dimension.key,
                  title: panel.kind === "breakdown" ? `By ${dimension.label}` : panel.title,
                });
              }}
            >
              {dimensionsFor(panel.grain).map((dimension) => (
                <option key={dimension.key} value={dimension.key}>
                  {dimension.label}
                </option>
              ))}
            </select>
          </>
        ) : null}

        {panel.kind === "matrix"
          ? (["row", "col"] as const).map((axis) => (
              <span key={axis} className="flex items-center gap-1">
                <span className="font-mono text-[8px] uppercase tracking-wider text-inkMuted/60">{axis}</span>
                <select
                  className={SELECT}
                  value={panel[axis] ?? ""}
                  onChange={(event) => {
                    const dimension = dimensionsFor(panel.grain).find((entry) => entry.key === event.target.value);
                    if (dimension) updatePanel(panel.id, { [axis]: dimension.key });
                  }}
                >
                  {dimensionsFor(panel.grain).map((dimension) => (
                    <option key={dimension.key} value={dimension.key}>
                      {dimension.label}
                    </option>
                  ))}
                </select>
              </span>
            ))
          : null}

        <span className="flex items-center gap-1">
          <span className="font-mono text-[8px] uppercase tracking-wider text-inkMuted/60">limit</span>
          <input
            type="number"
            min={1}
            max={40}
            value={panel.limit ?? 12}
            onChange={(event) => updatePanel(panel.id, { limit: Math.max(1, Number(event.target.value) || 1) })}
            className={`${SELECT} w-12 tabular-nums`}
          />
        </span>

        <button
          type="button"
          onClick={() => removePanel(panel.id)}
          className="ml-auto rounded border border-edge px-1 py-0.5 font-mono text-[9px] text-inkMuted hover:text-ink"
          title="Remove this panel"
        >
          ✕ remove
        </button>
      </div>

      {panel.kind === "breakdown" || panel.kind === "rows" ? (
        <div className="flex flex-wrap items-center gap-1">
          <span className="font-mono text-[8px] uppercase tracking-wider text-inkMuted/60">measure</span>
          {measuresFor(panel.grain).map((measure) => {
            const active = panel.measures.includes(measure.key);
            return (
              <button
                key={measure.key}
                type="button"
                aria-pressed={active}
                onClick={() =>
                  updatePanel(panel.id, {
                    measures: active
                      ? panel.measures.filter((key) => key !== measure.key)
                      : [...panel.measures, measure.key],
                  })
                }
                className={`rounded border px-1 py-0.5 font-mono text-[9px] ${
                  active ? "border-accent/60 bg-accent/15 text-accent" : "border-edge text-inkMuted hover:text-ink"
                }`}
              >
                {measure.label}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
