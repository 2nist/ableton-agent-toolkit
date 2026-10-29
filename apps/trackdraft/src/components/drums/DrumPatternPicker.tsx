import { grooveOf, PATTERN_GROUPS, type GrooveChoice } from "../../lib/drums/grooveModel";
import { variantCount } from "../../lib/playback/drumPreview";
import type { BlueprintSection, DrumPattern, MeterOutline } from "../../types/blueprint";

/**
 * The one pattern picker.
 *
 * Three surfaces used to assemble this by hand — the inspector's Pattern tab,
 * the Structure section editor, and (visually) the groove shelf — with two
 * hardcoded copies of the pattern vocabulary between them, and none of them
 * clearing the rhythm blocks that would mask the choice. This renders the
 * source as a single control and emits a `GrooveChoice`; the caller applies it
 * with `applyGrooveChoice`, so every entry point behaves identically.
 */
export default function DrumPatternPicker({
  section,
  onChoose,
  compact = false,
  showModes = true,
  showVariants = true,
  className = "",
  buildOutline,
}: {
  section: BlueprintSection;
  onChoose: (choice: GrooveChoice) => void;
  /**
   * Starting outline for Euclid mode. The section's own meter at an eighth
   * grid is the right default, and only the caller knows the helpers for it —
   * a fixed 4/4 here would silently put a 7/8 section in four.
   */
  buildOutline?: (section: BlueprintSection) => MeterOutline;
  /** Structure-tab form: one select, no mode chips, no variant stepper. */
  compact?: boolean;
  showModes?: boolean;
  showVariants?: boolean;
  className?: string;
}) {
  const source = grooveOf(section);
  const pattern = source.kind === "preset" ? source.pattern : undefined;
  const total = variantCount(pattern);
  const index = source.kind === "preset" ? source.variant ?? 0 : 0;

  const chip = (active: boolean) =>
    `px-2 py-1 rounded border text-xs ${
      active ? "border-accent bg-accent/15 text-ink" : "border-edge text-inkMuted hover:text-ink"
    }`;

  return (
    <div className={`flex items-center gap-1.5 ${compact ? "w-full" : "flex-wrap"} ${className}`}>
      {showModes && !compact && (
        <>
          <button
            type="button"
            className={chip(source.kind === "auto")}
            onClick={() => onChoose({ kind: "auto" })}
            title="Let the engine pick this section's groove from role, meter and velocity"
          >
            Auto
          </button>
          <button
            type="button"
            className={chip(source.kind === "outline")}
            onClick={() =>
              onChoose({ kind: "outline", outline: (buildOutline ?? defaultOutline)(section) })
            }
            title="Author this section's drums as a Euclidean meter, independent of the section's time signature"
          >
            Euclid
          </button>
        </>
      )}

      <select
        className={`${compact ? "flex-1 min-w-0" : "w-40 shrink-0"} bg-panelAlt border border-edge rounded px-2 py-1 text-xs text-ink`}
        value={pattern ?? ""}
        onChange={(e) => {
          const value = e.target.value;
          if (!value) {
            onChoose({ kind: source.kind === "outline" ? "outline" : "auto", ...(source.kind === "outline" ? { outline: source.outline } : {}) } as GrooveChoice);
            return;
          }
          if (value === "none") {
            onChoose({ kind: "muted" });
            return;
          }
          onChoose({ kind: "preset", pattern: value as DrumPattern, variant: 0 });
        }}
        title={
          source.kind === "outline"
            ? "This section runs a Euclidean outline — picking a preset replaces it"
            : "Named pattern for the whole section — empty defers to the engine"
        }
      >
        <option value="">{compact ? "auto" : "Preset…"}</option>
        {PATTERN_GROUPS.map((group) => (
          <optgroup key={group.label} label={group.label}>
            {group.patterns.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </optgroup>
        ))}
      </select>

      {showVariants && total > 1 && (
        <div className="flex items-center gap-1 shrink-0" title="Which performance of this pattern to use">
          <button
            type="button"
            className={chip(false)}
            onClick={() =>
              pattern && onChoose({ kind: "preset", pattern, variant: Math.max(0, index - 1) })
            }
          >
            ◀
          </button>
          <span className="font-mono text-2xs tabular-nums text-ink min-w-[44px] text-center">
            {index + 1}/{total}
          </span>
          <button
            type="button"
            className={chip(false)}
            onClick={() =>
              pattern && onChoose({ kind: "preset", pattern, variant: Math.min(total - 1, index + 1) })
            }
          >
            ▶
          </button>
        </div>
      )}
    </div>
  );
}

/** Fallback when a caller passes no `buildOutline`: one 4/4 bar in eighths. */
function defaultOutline(section: BlueprintSection): MeterOutline {
  const numerator = Math.max(1, Math.round(section.timeSignatureNumerator || 4));
  const cells: (2 | 3)[] = [];
  for (let left = numerator * 2; left > 0; ) {
    const cell = left >= 3 && left !== 4 ? 3 : 2;
    cells.push(cell as 2 | 3);
    left -= cell;
  }
  return { cellBeats: 0.5, cells, label: `${numerator}/${2 ** (section.timeSignatureDenPower ?? 2)}` };
}
