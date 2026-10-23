import type { NarrativeProfile } from "../../types/blueprint";
import TapeLabel from "../common/TapeLabel";

/**
 * A section's narrative arc — the four abstract axes that tint the subgenre's
 * concrete vocabulary (see `packages/drum-library/src/narrative.ts`).
 *
 * ONE implementation, because it lives in two editors: the Structure page's
 * card and the Workbench's right-rail panel, which are otherwise separate
 * components. Before this, the rail had no narrative controls at all, so the
 * layer was only reachable from the page a writer rarely opens.
 */

/** A narrative axis as a real fader.
 *
 *  `appearance-none` used to strip the browser's thumb with nothing drawn in
 *  its place, so the control was a 1px bar you could neither see nor grab. The
 *  `.fader` recipe in theme/themes.css draws the track AND the thumb in both
 *  themes. Each axis also states what it currently does, because two of them
 *  only act past a threshold — a slider whose upper half does nothing is a
 *  trap unless the label says so.
 *
 *  Deliberately not a wrapping <label> around other labels: nesting labels is
 *  invalid HTML whose activation behaviour browsers disagree about. Each input
 *  is wrapped by its own label instead. */
function NarrativeFader({
  label,
  value,
  readout,
  hint,
  signed = false,
  onChange,
}: {
  label: string;
  value: number;
  readout: string;
  hint: string;
  signed?: boolean;
  onChange: (value: number) => void;
}) {
  return (
    <label className="flex flex-col gap-0.5 w-full min-w-0">
      <span className="flex justify-between gap-1">
        <span className="truncate">{label}</span>
        <span className="text-inkMuted/60 tabular-nums shrink-0">{readout}</span>
      </span>
      <input
        type="range"
        min={signed ? -100 : 0}
        max={100}
        step={5}
        className="fader w-full"
        value={Math.round(value * 100)}
        onChange={(e) => onChange(Number(e.target.value) / 100)}
      />
      <span className="text-3xs text-inkMuted/50 truncate" title={hint}>
        {hint}
      </span>
    </label>
  );
}

/** Mirrors `narrativeTransitionModel`'s thresholds so the label can't lie. */
function boundaryHint(delta: number): string {
  if (delta > 0.35) return "builds into the next section";
  if (delta < -0.35) return "drains out of this one";
  return "neutral — role decides";
}

/** Mirrors `NARRATIVE_STRUCTURAL_WARP_THRESHOLD`. */
function warpHint(warp: number): string {
  return warp > 0.5 ? "warped 2s/3s harmony grid" : "flat — no warp below 50%";
}

/** A neutral arc — audible as "no change", so adding one is always safe. */
export const NEUTRAL_NARRATIVE: NarrativeProfile = {
  tension_profile: 0.5,
  rhythmic_energy: 0.5,
  transition_delta: 0,
  structural_warp: 0,
};

export default function NarrativeArcEditor({
  narrative,
  onChange,
  compact = false,
}: {
  narrative: NarrativeProfile | undefined;
  onChange: (narrative: NarrativeProfile | undefined) => void;
  /** One fader per row — the Workbench rail is ~230px, too narrow to read two
   *  readouts side by side. */
  compact?: boolean;
}) {
  if (!narrative) {
    return (
      <button
        type="button"
        className="text-xs text-inkMuted hover:text-ink underline underline-offset-4 px-1 self-start"
        title="Add a narrative arc to tint this section's subgenre vocabulary (tension, energy, boundary, warp)"
        onClick={() => onChange({ ...NEUTRAL_NARRATIVE })}
      >
        + Narrative arc
      </button>
    );
  }

  const set = <K extends keyof NarrativeProfile>(key: K, value: NarrativeProfile[K]) =>
    onChange({ ...narrative, [key]: value });

  return (
    <div className="flex flex-col gap-1 text-xs text-inkMuted pt-1 border-t border-edge/30">
      <div className="flex items-center justify-between gap-2">
        <TapeLabel size="sm" tilt="right" className="font-mono text-3xs uppercase tracking-wider">
          Narrative arc
        </TapeLabel>
        <button
          type="button"
          className="text-3xs text-inkMuted hover:text-danger px-1 shrink-0"
          title="Remove this section's narrative arc — it goes back to following the song master"
          onClick={() => onChange(undefined)}
        >
          remove
        </button>
      </div>
      <div className={compact ? "flex flex-col gap-1.5" : "grid grid-cols-2 gap-2"}>
        <NarrativeFader
          label="Tension"
          value={narrative.tension_profile}
          readout={`${Math.round(narrative.tension_profile * 100)}%`}
          hint="harmony · dissonance"
          onChange={(v) => set("tension_profile", v)}
        />
        <NarrativeFader
          label="Energy"
          value={narrative.rhythmic_energy}
          readout={`${Math.round(narrative.rhythmic_energy * 100)}%`}
          hint="density · velocities"
          onChange={(v) => set("rhythmic_energy", v)}
        />
        <NarrativeFader
          label="Boundary"
          value={narrative.transition_delta}
          signed
          readout={`${narrative.transition_delta > 0 ? "+" : ""}${narrative.transition_delta.toFixed(2)}`}
          hint={boundaryHint(narrative.transition_delta)}
          onChange={(v) => set("transition_delta", v)}
        />
        <NarrativeFader
          label="Warp"
          value={narrative.structural_warp}
          readout={`${Math.round(narrative.structural_warp * 100)}%`}
          hint={warpHint(narrative.structural_warp)}
          onChange={(v) => set("structural_warp", v)}
        />
      </div>
    </div>
  );
}
