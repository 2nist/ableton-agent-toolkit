import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { BlueprintSection, NarrativeProfile, SectionRole, VelocityPreset, DrumPattern } from "../../types/blueprint";
import { DRUM_PATTERN_OPTIONS, variantCount } from "../../lib/playback/drumPreview";
import DrumNecklacePreview from "./DrumNecklacePreview";
import TapeLabel from "../common/TapeLabel";

const ROLES: SectionRole[] = [
  "intro", "verse", "pre_chorus", "chorus", "bridge", "solo", "breakdown", "outro", "custom",
];
const VELOCITIES: VelocityPreset[] = ["ppp", "pp", "p", "mp", "mf", "f", "ff", "fff"];
// song-structure's SongSection stores the denominator as a power of two
// (denPower 2 == denominator 4, i.e. 4/4) rather than the raw number --
// matches the S() DSL's ts_den_power convention. Converted to/from a
// real denominator here so the UI shows "4" not "2".
const DENOMINATOR_OPTIONS = [2, 4, 8, 16];

interface SectionCardProps {
  section: BlueprintSection;
  repeats: number;
  onChange: (updater: (section: BlueprintSection) => BlueprintSection) => void;
  onChangeRepeats: (repeats: number) => void;
  onDelete: () => void;
}

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
    <label className="flex flex-col gap-0.5 w-full">
      <span className="flex justify-between">
        <span>{label}</span>
        <span className="text-inkMuted/60 tabular-nums">{readout}</span>
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

export default function SectionCard({ section, repeats, onChange, onChangeRepeats, onDelete }: SectionCardProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: section.id,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="border border-edge rounded bg-panel p-2.5 space-y-1.5"
    >
      <div className="flex items-center gap-2">
        <button
          {...attributes}
          {...listeners}
          className="cursor-grab text-inkMuted px-1 select-none"
          aria-label="Drag to reorder"
        >
          ⠿
        </button>
        {/* `size` is only read in the paper theme, where the tape is torn to
            the name's length; in the dark theme the field stays `flex-1`. */}
        <input
          className="tape-input bg-transparent font-medium flex-1 outline-none"
          size={Math.max(4, section.name.length + 1)}
          value={section.name}
          onChange={(e) => onChange((s) => ({ ...s, name: e.target.value }))}
        />
        <select
          className="bg-panelAlt border border-edge rounded text-xs px-2 py-1"
          value={section.role}
          onChange={(e) => onChange((s) => ({ ...s, role: e.target.value as SectionRole }))}
        >
          {ROLES.map((r) => (
            <option key={r} value={r}>{r}</option>
          ))}
        </select>
        <button
          className="text-inkMuted hover:text-danger text-xs px-2"
          onClick={onDelete}
        >
          Delete
        </button>
      </div>

      <div className="flex flex-wrap gap-2 text-xs text-inkMuted">
        <label className="flex items-center gap-1">
          Time sig
          <input
            type="number"
            min={1}
            max={32}
            className="w-10 bg-panelAlt border border-edge rounded px-1 py-0.5 text-ink"
            value={section.timeSignatureNumerator}
            onChange={(e) =>
              onChange((s) => ({ ...s, timeSignatureNumerator: Number(e.target.value) || 1 }))
            }
          />
          <span>/</span>
          <select
            className="bg-panelAlt border border-edge rounded px-1 py-0.5 text-ink"
            value={2 ** section.timeSignatureDenPower}
            onChange={(e) =>
              onChange((s) => ({ ...s, timeSignatureDenPower: Math.log2(Number(e.target.value)) }))
            }
          >
            {DENOMINATOR_OPTIONS.map((d) => (
              <option key={d} value={d}>{d}</option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1">
          Bars
          <input
            type="number"
            min={1}
            className="w-14 bg-panelAlt border border-edge rounded px-1 py-0.5 text-ink"
            value={section.bars}
            onChange={(e) => onChange((s) => ({ ...s, bars: Number(e.target.value) || 1 }))}
          />
        </label>
        <label className="flex items-center gap-1">
          Beats/chord
          <input
            type="number"
            min={1}
            className="w-14 bg-panelAlt border border-edge rounded px-1 py-0.5 text-ink"
            value={section.beatsPerChord}
            onChange={(e) => onChange((s) => ({ ...s, beatsPerChord: Number(e.target.value) || 1 }))}
          />
        </label>
        <label
          className="flex items-center gap-1"
          title="How many times this section plays in a row here — repeat the same Chorus without duplicating it into a separate section. 0 skips it without deleting it."
        >
          Repeats
          <input
            type="number"
            min={0}
            className="w-12 bg-panelAlt border border-edge rounded px-1 py-0.5 text-ink"
            value={repeats}
            onChange={(e) => onChangeRepeats(Number(e.target.value))}
          />
        </label>
        {section.drumMeterOutline ? (
          <span
            className="flex items-center gap-1 text-xs text-inkMuted"
            title="This section uses an odd-meter outline instead of a named pattern — edit it in the Drums tab, not here."
          >
            Drums <span className="text-accent">outline · {section.drumMeterOutline.label}</span>
          </span>
        ) : (
          <label className="flex items-center gap-1" title="Override the heuristic drum pattern for this section. Leave empty to use automatic inference from role, velocity and meter.">
            Drums
            <select
              className="bg-panelAlt border border-edge rounded px-1 py-0.5 text-ink"
              value={section.drumPattern ?? ""}
              onChange={(e) => {
                const val = e.target.value;
                onChange((s) => ({
                  ...s,
                  drumPattern: val ? (val as DrumPattern) : undefined,
                  drumVariantIndex: val ? 0 : undefined,
                }));
              }}
            >
              <option value="">auto (heuristic)</option>
              {DRUM_PATTERN_OPTIONS.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
          </label>
        )}
        {!section.drumMeterOutline && section.drumPattern && (
          <span className="flex items-center gap-1 text-xs text-inkMuted" title="Which variant of the selected pattern to use.">
            <button
              className="px-1 hover:text-ink select-none"
              onClick={() => {
                const total = variantCount(section.drumPattern);
                if (total <= 1) return;
                const cur = section.drumVariantIndex ?? 0;
                onChange((s) => ({ ...s, drumVariantIndex: Math.max(0, cur - 1) }));
              }}
            >
              ◂
            </button>
            <span className="tabular-nums min-w-[3ch] text-center">
              {((section.drumVariantIndex ?? 0) + 1)}/{variantCount(section.drumPattern)}
            </span>
            <button
              className="px-1 hover:text-ink select-none"
              onClick={() => {
                const total = variantCount(section.drumPattern);
                if (total <= 1) return;
                const cur = section.drumVariantIndex ?? 0;
                onChange((s) => ({ ...s, drumVariantIndex: Math.min(total - 1, cur + 1) }));
              }}
            >
              ▸
            </button>
          </span>
        )}
        {(section.harmonyMeterOutline || section.harmonyFollowsDrums || section.syncopationOffset) && (
          <span
            className="flex items-center gap-1 text-xs text-inkMuted"
            title="This section's chord rhythm is customized — edit it in the Harmony tab, not here."
          >
            Harmony
            {section.harmonyMeterOutline ? (
              <span className="text-accent">outline · {section.harmonyMeterOutline.label}</span>
            ) : section.harmonyFollowsDrums ? (
              <span className="text-accent">follows drums</span>
            ) : null}
            {section.syncopationOffset ? (
              <span className="text-accent">push {Math.round(section.syncopationOffset * 4)}/16</span>
            ) : null}
          </span>
        )}
        <label className="flex items-center gap-1" title="Also drives the generated drums: quiet sections get sparse patterns, loud ones get intense patterns.">
          Velocity
          <select
            className="bg-panelAlt border border-edge rounded px-1 py-0.5 text-ink"
            value={section.velocity}
            onChange={(e) => onChange((s) => ({ ...s, velocity: e.target.value as VelocityPreset }))}
          >
            {VELOCITIES.map((v) => (
              <option key={v} value={v}>{v}</option>
            ))}
          </select>
        </label>
        {section.narrative ? (
          <div className="flex flex-col gap-1 text-xs text-inkMuted pt-1 border-t border-edge/30">
            <div className="flex items-center justify-between gap-2">
              <TapeLabel size="sm" tilt="right" className="font-mono text-3xs uppercase tracking-wider">
                Narrative arc
              </TapeLabel>
              <button
                type="button"
                className="text-3xs text-inkMuted hover:text-danger px-1 shrink-0"
                title="Remove this section's narrative arc — it goes back to following the song master"
                onClick={() => onChange((s) => ({ ...s, narrative: undefined }))}
              >
                remove
              </button>
            </div>
            <div className="flex gap-2">
              <NarrativeFader
                label="Tension"
                value={section.narrative.tension_profile}
                readout={`${Math.round(section.narrative.tension_profile * 100)}%`}
                hint="harmony · dissonance"
                onChange={(v) => onChange((s) => ({ ...s, narrative: { ...s.narrative!, tension_profile: v } }))}
              />
              <NarrativeFader
                label="Energy"
                value={section.narrative.rhythmic_energy}
                readout={`${Math.round(section.narrative.rhythmic_energy * 100)}%`}
                hint="density · velocities"
                onChange={(v) => onChange((s) => ({ ...s, narrative: { ...s.narrative!, rhythmic_energy: v } }))}
              />
            </div>
            <div className="flex gap-2">
              <NarrativeFader
                label="Boundary"
                value={section.narrative.transition_delta}
                signed
                readout={`${section.narrative.transition_delta > 0 ? "+" : ""}${section.narrative.transition_delta.toFixed(2)}`}
                hint={boundaryHint(section.narrative.transition_delta)}
                onChange={(v) => onChange((s) => ({ ...s, narrative: { ...s.narrative!, transition_delta: v } }))}
              />
              <NarrativeFader
                label="Warp"
                value={section.narrative.structural_warp}
                readout={`${Math.round(section.narrative.structural_warp * 100)}%`}
                hint={warpHint(section.narrative.structural_warp)}
                onChange={(v) => onChange((s) => ({ ...s, narrative: { ...s.narrative!, structural_warp: v } }))}
              />
            </div>
          </div>
        ) : (
          <button
            type="button"
            className="text-xs text-inkMuted hover:text-ink underline underline-offset-4 px-1"
            title="Add a narrative arc to tint this section's subgenre vocabulary (tension, energy, boundary, warp)"
            onClick={() =>
              onChange((s) => ({
                ...s,
                narrative: {
                  tension_profile: 0.5,
                  rhythmic_energy: 0.5,
                  transition_delta: 0,
                  structural_warp: 0,
                } as NarrativeProfile,
              }))
            }
          >
            + Narrative arc
          </button>
        )}
      </div>

      {section.drumPattern && (
        <DrumNecklacePreview pattern={section.drumPattern} variantIndex={section.drumVariantIndex} />
      )}

      <textarea
        className="w-full bg-panelAlt border border-edge rounded px-2 py-1 text-xs text-inkMuted resize-y"
        rows={2}
        placeholder="Transition into this section…"
        value={section.transitionNote ?? ""}
        onChange={(e) => onChange((s) => ({ ...s, transitionNote: e.target.value }))}
      />
    </div>
  );
}
