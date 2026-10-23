import { useCallback, useMemo, useState } from "react";
import type { DrumLaneId } from "@drum/library";
import type { SectionSpan } from "../../../lib/arrangement";
import { beatsPerBarOf } from "../../../lib/timeline/beatMap";
import type { BlueprintSection, DrumBlockFx } from "../../../types/blueprint";
import { DRUM_LANES, laneColor } from "../laneStyle";
import { usePalette } from "../../../theme/palette";
import { EuclidRing, FxPanel, MotionRing, VelocityPanel } from "./SelectionDisplays";
import { euclidBlocksFor, fxBlocksFor, fxForLanes, motionBlockFor, motionLabelFor, upsertModeBlocks } from "./selectionMath";
import type { VelocityOp } from "./velocityOps";
import TapeLabel from "../../common/TapeLabel";

/**
 * The Selection Workbench — the working area that comes up WITH a
 * selection (and goes away with it). It is the docked home for every
 * control family the drum timeline grows: the big nested-Euclidean display
 * (one ring per selected drum), the Motion gesture ring, the Range FX rows
 * (swing / humanize / quantize / velCurve) and the Velocity patterns
 * panel — every family is live now.
 * Edits write through the shared draft store, so Apply/Cancel behave
 * exactly like every other surface — and both of them END the selection
 * session (the whole point: no popup to click away).
 *
 * No selection → the parent does not render this at all, so the timeline
 * keeps the full width until the user pulls a selection up.
 */


type Mode = "euclid" | "motion" | "velocity" | "fx";

interface SelectionWorkbenchProps {
  /** The span the selection lives in (null when nothing is selected). */
  span: SectionSpan | null;
  /** Draft-aware section for the span. */
  section: BlueprintSection | null;
  range: { startBeat: number; endBeat: number; laneKeys: string[] } | null;
  onWrite: (mutate: (sec: BlueprintSection) => BlueprintSection) => void;
  /** One-shot velocity shaping over the selection (ramp / accents / …). */
  onVelocityOp: (op: VelocityOp) => void;
  /** Freeze the selection's audible material into editable dots. */
  onFlatten: () => void;
  /** Roll the section to its next seeded variant (null → disabled). */
  onRegenerate: (() => void) | null;
  hasDraft: boolean;
  onApply: () => void;
  onCancel: () => void;
}

export default function SelectionWorkbench(props: SelectionWorkbenchProps) {
  const P = usePalette();
  const { span, section, range, onWrite, onVelocityOp, onFlatten, onRegenerate, hasDraft, onApply, onCancel } = props;
  const [panel, setPanel] = useState<Mode>("euclid");

  const lanes = (range?.laneKeys ?? []) as DrumLaneId[];
  const nBeats = range ? Math.max(1, Math.round(range.endBeat - range.startBeat)) : 1;

  const existingEuclid = useMemo(
    () => (section && range ? (section.drumBlocks ?? []).find(
      (b) => b.mode === "euclid" && b.lane === lanes[0] &&
        Math.abs(b.startBeat - range.startBeat) < 1e-6 && Math.abs(b.endBeat - range.endBeat) < 1e-6,
    ) ?? null : null),
    [section, range, lanes],
  );
  const existingMotion = useMemo(
    () => (section && range ? (section.drumBlocks ?? []).find(
      (b) => b.mode === "motion" && b.lane === lanes[0] &&
        Math.abs(b.startBeat - range.startBeat) < 1e-6 && Math.abs(b.endBeat - range.endBeat) < 1e-6,
    ) ?? null : null),
    [section, range, lanes],
  );
  const existingFx = useMemo(
    () => (section && range ? fxForLanes(section.drumBlocks, lanes, range.startBeat, range.endBeat) : undefined),
    [section, range, lanes],
  );

  // Keyed by range so switching sections/selections re-seeds the controls.
  const seedKey = `${span?.section.id ?? "-"}:${range?.startBeat ?? "-"}:${range?.endBeat ?? "-"}:${lanes.join("+")}`;
  const [seeded, setSeeded] = useState("");
  const [euclid, setEuclid] = useState({ k: 1, rotation: 0 });
  const [motion, setMotion] = useState({ x: 0, y: 0 });
  const [fx, setFx] = useState<DrumBlockFx>({});
  if (range && seeded !== seedKey) {
    setSeeded(seedKey);
    setEuclid({
      k: existingEuclid?.euclid?.k ?? Math.max(1, Math.round(nBeats / 2)),
      rotation: existingEuclid?.euclid?.rotation ?? 0,
    });
    setMotion({ x: existingMotion?.motion?.x ?? 0, y: existingMotion?.motion?.y ?? 0 });
    setFx(existingFx ?? {});
  }

  const writeEuclid = useCallback((k: number, rotation: number) => {
    if (!range) return;
    setEuclid({ k, rotation });
    onWrite((sec) => ({
      ...sec,
      drumBlocks: upsertModeBlocks(
        sec.drumBlocks, range.startBeat, range.endBeat,
        euclidBlocksFor(lanes, range.startBeat, range.endBeat, k, nBeats, rotation),
      ),
    }));
  }, [range, lanes, nBeats, onWrite]);

  const writeMotion = useCallback((x: number, y: number) => {
    if (!range || lanes.length === 0) return;
    setMotion({ x, y });
    onWrite((sec) => ({
      ...sec,
      drumBlocks: upsertModeBlocks(
        sec.drumBlocks, range.startBeat, range.endBeat,
        [motionBlockFor(lanes[0], range.startBeat, range.endBeat, x, y)],
      ),
    }));
  }, [range, lanes, onWrite]);

  const writeFx = useCallback((next: DrumBlockFx) => {
    if (!range) return;
    setFx(next);
    onWrite((sec) => ({
      ...sec,
      drumBlocks: fxBlocksFor(sec.drumBlocks, lanes, range.startBeat, range.endBeat, next),
    }));
  }, [range, lanes, onWrite]);

  // ---- empty state -------------------------------------------------------------

  if (!range || !span || !section || lanes.length === 0) {
    // The parent only renders the workbench while a selection exists —
    // this guard just covers degenerate ranges (empty laneKeys etc.).
    return null;
  }

  const bpb = beatsPerBarOf(span);
  const barOf = (beat: number) => span.startBar + Math.floor(beat / bpb);
  const isEuclid = panel === "euclid";

  const chips: { id: Mode; label: string; live: boolean }[] = [
    { id: "euclid", label: "Euclid", live: true },
    { id: "motion", label: "Motion", live: true },
    { id: "fx", label: "FX", live: true },
    { id: "velocity", label: "Velocity", live: true },
  ];

  return (
    <aside className="w-[340px] shrink-0 sticky top-2 self-start max-h-[calc(100vh-140px)] overflow-y-auto border border-edge rounded bg-deep/40">
      {/* header */}
      <div className="px-3 pt-2.5 pb-2 border-b border-edge">
        <TapeLabel as="div" size="md" className="font-mono text-2xs uppercase tracking-wider text-track">Selection workbench</TapeLabel>
        <div className="font-mono text-xs text-ink mt-1">{section.name}</div>
        <div className="font-mono text-2xs text-inkMuted mt-0.5">
          bars {barOf(range.startBeat)}–{barOf(Math.max(range.startBeat, range.endBeat - 1e-6))} ·
          {" "}beats {range.startBeat}–{range.endBeat} of {span.durationBeats}
        </div>
      </div>

      {/* mode chips */}
      <div className="flex flex-wrap gap-1 px-3 py-2 border-b border-edge">
        {chips.map((c) => (
          <button
            key={c.id}
            onClick={() => setPanel(c.id)}
            className={`font-mono text-2xs rounded px-2 py-1 border ${
              panel === c.id
                ? "border-track text-track bg-track/10"
                : c.live
                  ? "border-edge text-inkMuted hover:text-ink"
                  : "border-edge text-inkMuted/60"
            }`}
          >
            {c.label}
          </button>
        ))}
      </div>

      {/* the control display */}
      {(isEuclid || panel === "motion") && (
        <div className="border-b border-edge">
          <div className="p-2">
            {isEuclid ? (
              <EuclidRing
                k={euclid.k} n={nBeats} rotation={euclid.rotation} lanes={lanes}
                onChange={writeEuclid}
              />
            ) : (
              <MotionRing x={motion.x} y={motion.y} onChange={writeMotion} />
            )}
          </div>
          <div className="px-3 pb-2.5">
            <div className="font-mono text-sm text-track">
              {isEuclid
                ? `${euclid.k}/${nBeats} · ↻${euclid.rotation} · ${Math.round((euclid.k / nBeats) * 100)}%`
                : motionLabelFor(motion) ?? "DRAG TO GESTURE"}
            </div>
            <div className="font-mono text-2xs text-inkMuted mt-0.5">
              {isEuclid
                ? "angle = rotation · distance = density · nested rings = selected lanes"
                : "↗ build · ↖ crescendo · ↓ break · ↙ thin"}
            </div>
          </div>
        </div>
      )}

      {/* selected lanes */}
      <div className="flex items-center gap-1.5 flex-wrap px-3 py-2 border-b border-edge">
        {lanes.map((k) => {
          const lane = DRUM_LANES.find((l) => l.key === k);
          return (
            <span key={k} className="flex items-center gap-1 font-mono text-2xs border border-edge rounded px-1.5 py-0.5 text-inkMuted">
              <span className="w-2 h-2 rounded-full" style={{ background: lane ? laneColor(lane, P) : P.track }} />
              {lane?.label}
            </span>
          );
        })}
        {lanes.length > 1 && (
          <span className="font-mono text-2xs text-inkMuted">interleaved — one rhythm across the set</span>
        )}
      </div>

      {/* planned control families */}
      {panel === "velocity" && (
        <div className="border-b border-edge">
          <VelocityPanel onOp={onVelocityOp} />
        </div>
      )}
      {panel === "fx" && (
        <div className="border-b border-edge">
          <FxPanel values={fx} onChange={writeFx} />
        </div>
      )}

      {/* footer */}
      <div className="px-3 py-2.5">
        {hasDraft ? (
          <span className="font-mono text-2xs text-track">● preview — edits staged</span>
        ) : (
          <span className="font-mono text-2xs text-inkMuted">no edits yet — drag a ring to stage one</span>
        )}
        <div className="flex items-center gap-1.5 mt-2 flex-wrap">
          <button
            onClick={onFlatten}
            className="font-mono text-2xs rounded px-2 py-1 border border-edge text-inkMuted hover:text-ink"
            title="Freeze the selection's audible material into editable dots"
          >
            ❄ Flatten
          </button>
          <button
            onClick={onRegenerate ?? undefined}
            disabled={!onRegenerate}
            className={`font-mono text-2xs rounded px-2 py-1 border ${
              onRegenerate
                ? "border-edge text-inkMuted hover:text-ink"
                : "border-edge text-inkMuted/40 cursor-not-allowed"
            }`}
            title={onRegenerate ? "Roll the section to its next seeded variant" : "No variants for this section's pattern"}
          >
            ⟳ Regenerate
          </button>
        </div>
        <div className="flex items-center gap-2 mt-2">
          <button
            onClick={onApply}
            disabled={!hasDraft}
            className={`font-mono text-xs rounded px-3 py-1.5 border ${
              hasDraft
                ? "border-accent text-accent bg-accent/10 hover:bg-accent/20"
                : "border-edge text-inkMuted/50 cursor-not-allowed"
            }`}
          >
            ✓ Apply
          </button>
          <button
            onClick={onCancel}
            disabled={!hasDraft}
            className={`font-mono text-xs rounded px-3 py-1.5 border ${
              hasDraft ? "border-edge text-inkMuted hover:text-ink" : "border-edge text-inkMuted/50 cursor-not-allowed"
            }`}
          >
            ✕ Cancel
          </button>
        </div>
      </div>
    </aside>
  );
}
