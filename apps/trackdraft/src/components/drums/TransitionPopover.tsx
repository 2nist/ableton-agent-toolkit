import { TRANSITION_COLOR, TRANSITION_LABEL, TRANSITION_MODELS } from "./transitionStyle";
import type { DrumTransitionModel } from "../../types/blueprint";

/** The click-on-the-timeline popover for a section's handoff — the piece
 *  the design reference (Groove Chain, variation C) built the whole
 *  interaction around: click *at the boundary itself* and get an
 *  immediate, in-place picker, instead of first selecting the section
 *  and then finding "Transition" partway down the dock. Every field here
 *  writes straight into the same `drumTransitionModel`/
 *  `drumTransitionBars` the dock's own Transition block edits, so the two
 *  entry points stay two views of one piece of state, never a fork. */
export default function TransitionPopover({
  sectionName,
  currentModel,
  currentBars,
  left,
  top,
  onSetModel,
  onSetBars,
  onClose,
}: {
  sectionName: string;
  currentModel: DrumTransitionModel | undefined;
  currentBars: number | undefined;
  left: number;
  top: number;
  onSetModel: (model: DrumTransitionModel | null) => void;
  onSetBars: (bars: number) => void;
  onClose: () => void;
}) {
  return (
    <div
      className="absolute z-10 w-56 rounded border border-edge bg-panelAlt p-2.5 shadow-lg"
      style={{ left, top }}
    >
      <div className="flex items-center justify-between mb-2">
        <span className="font-mono text-3xs uppercase tracking-wider text-inkMuted">
          {sectionName} &middot; handoff
        </span>
        <button className="text-inkMuted hover:text-ink leading-none text-sm" onClick={onClose} title="Close">
          &times;
        </button>
      </div>

      <div className="flex flex-wrap gap-1 mb-2">
        <button
          className={`font-mono text-2xs rounded px-2 py-1 border ${
            !currentModel ? "border-inkMuted text-ink" : "border-edge text-inkMuted hover:text-ink"
          }`}
          onClick={() => onSetModel(null)}
        >
          none
        </button>
        {TRANSITION_MODELS.map((model) => {
          const active = currentModel === model;
          const color = TRANSITION_COLOR[model];
          return (
            <button
              key={model}
              className="font-mono text-2xs rounded px-2 py-1 border"
              style={{
                borderColor: active ? color : "#2E2E34",
                color: active ? color : "#8B94A1",
                backgroundColor: active ? `${color}1a` : "transparent",
              }}
              onClick={() => onSetModel(model)}
            >
              {TRANSITION_LABEL[model]}
            </button>
          );
        })}
      </div>

      {currentModel && (
        <div className="flex items-center gap-2 text-sm">
          <span className="font-mono text-3xs text-inkMuted">Bars</span>
          <button
            className="w-6 h-6 rounded border border-edge text-inkMuted hover:text-ink"
            onClick={() => onSetBars((currentBars ?? 1) - 1)}
          >
            &minus;
          </button>
          <span className="font-mono tabular-nums min-w-[2ch] text-center">{currentBars ?? 1}</span>
          <button
            className="w-6 h-6 rounded border border-edge text-inkMuted hover:text-ink"
            onClick={() => onSetBars((currentBars ?? 1) + 1)}
          >
            +
          </button>
        </div>
      )}
    </div>
  );
}
