import type { ReactNode } from "react";
import type { BlueprintSection, DrumPattern, SectionRole, VelocityPreset } from "../../types/blueprint";
import { DRUM_PATTERN_OPTIONS, variantCount } from "../../lib/playback/drumPreview";
import DrumNecklacePreview from "./DrumNecklacePreview";
import NarrativeArcEditor from "./NarrativeArcEditor";

/**
 * The section editor — ONE implementation of "what you can change about a
 * section", in two densities:
 *
 *   card  the Structure page's sortable card (a wrapping row of fields)
 *   rail  the Workbench's right-rail panel (stacked rows, ~240px wide)
 *
 * They used to be two components, and they drifted exactly as you'd expect:
 * the rail was missing the narrative arc for as long as the card had it, and
 * the tape treatment on the section name stopped at the page's edge. Fields
 * live here now so a new one can't land in only one of them.
 *
 * Writes are the caller's: both densities push through the same
 * `lib/sections` helpers, so the two doors still open into one room.
 */

const ROLES: SectionRole[] = [
  "intro", "verse", "pre_chorus", "chorus", "bridge", "solo", "breakdown", "outro", "custom",
];
const VELOCITIES: VelocityPreset[] = ["ppp", "pp", "p", "mp", "mf", "f", "ff", "fff"];
// song-structure's SongSection stores the denominator as a power of two
// (denPower 2 == denominator 4, i.e. 4/4) rather than the raw number --
// matches the S() DSL's ts_den_power convention. Converted to/from a
// real denominator here so the UI shows "4" not "2".
const DENOMINATOR_OPTIONS = [2, 4, 8, 16];

export type SectionDensity = "card" | "rail";

/** One labelled control. The card spells the field name out; the rail has no
 *  room for that and uses the printed abbreviations a session sheet does.
 *
 *  Declared at module scope on purpose: a component defined inside the
 *  render function is a NEW type on every render, so React remounts its
 *  inputs and the caret jumps out of the field the user is typing in. */
function Field({
  compact,
  labelText,
  name,
  short,
  title,
  children,
}: {
  compact: boolean;
  labelText: string;
  name: string;
  short: string;
  title?: string;
  children: ReactNode;
}) {
  return (
    <label className={`flex items-center gap-1 ${labelText} text-inkMuted ${compact ? "w-full" : ""}`} title={title}>
      {compact ? <span className="uppercase tracking-wide text-[10.5px]">{short}</span> : name}
      {children}
    </label>
  );
}

export default function SectionEditor({
  section,
  repeats,
  onChange,
  onChangeRepeats,
  onDelete,
  density,
  leading,
  extra,
}: {
  section: BlueprintSection;
  repeats: number;
  onChange: (updater: (section: BlueprintSection) => BlueprintSection) => void;
  onChangeRepeats: (repeats: number) => void;
  onDelete: () => void;
  density: SectionDensity;
  /** The card's drag handle — owned by the sortable wrapper, rendered first. */
  leading?: ReactNode;
  /** Anything a host wants between the fields and the arc (the rail's
      progression-fit readout). */
  extra?: ReactNode;
}) {
  const compact = density === "rail";
  const labelText = compact ? "text-2xs" : "text-xs";
  const input = "bg-panelAlt border border-edge rounded px-1 py-0.5 text-ink";
  const select = "bg-panelAlt border border-edge rounded px-1 py-0.5 text-ink";

  const pattern = section.drumPattern;

  const drums = section.drumMeterOutline ? (
    <span
      className={`flex items-center gap-1 ${labelText} text-inkMuted`}
      title="This section uses an odd-meter outline instead of a named pattern — edit it in the Drums tab, not here."
    >
      Drums <span className="text-accent">outline · {section.drumMeterOutline.label}</span>
    </span>
  ) : (
    <label className={`flex items-center gap-1.5 ${labelText} text-inkMuted ${compact ? "w-full" : ""}`}>
      <span className={compact ? "uppercase tracking-wide text-[10.5px]" : ""}>Drums</span>
      <select
        className={`${select} ${compact ? "flex-1 min-w-0" : ""}`}
        value={section.drumPattern ?? ""}
        onChange={(e) => {
          const val = e.target.value;
          onChange((s) => ({
            ...s,
            drumPattern: val ? (val as DrumPattern) : undefined,
            drumVariantIndex: val ? 0 : undefined,
          }));
        }}
        title="Override the heuristic drum pattern — empty = automatic from role, velocity and meter"
      >
        <option value="">{compact ? "auto" : "auto (heuristic)"}</option>
        {DRUM_PATTERN_OPTIONS.map((p) => (
          <option key={p} value={p}>{p}</option>
        ))}
      </select>
      {pattern && (
        <span className="shrink-0 flex items-center gap-0.5 text-2xs font-mono" title="Which variant of the selected pattern to use">
          <button
            className="px-1 hover:text-ink select-none"
            onClick={() => {
              const total = variantCount(pattern);
              if (total <= 1) return;
              const cur = section.drumVariantIndex ?? 0;
              onChange((s) => ({ ...s, drumVariantIndex: Math.max(0, cur - 1) }));
            }}
          >
            ◂
          </button>
          <span className="tabular-nums min-w-[3ch] text-center">
            {((section.drumVariantIndex ?? 0) + 1)}/{variantCount(pattern)}
          </span>
          <button
            className="px-1 hover:text-ink select-none"
            onClick={() => {
              const total = variantCount(pattern);
              if (total <= 1) return;
              const cur = section.drumVariantIndex ?? 0;
              onChange((s) => ({ ...s, drumVariantIndex: Math.min(total - 1, cur + 1) }));
            }}
          >
            ▸
          </button>
        </span>
      )}
    </label>
  );

  const harmonyReadout = (section.harmonyMeterOutline || section.harmonyFollowsDrums || section.syncopationOffset) && (
    <span
      className={`flex items-center gap-1 ${labelText} text-inkMuted`}
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
  );

  const numberFields = (
    <>
      <Field compact={compact} labelText={labelText} name="Time sig" short="TS" title="Meter numerator over denominator">
        <input
          type="number"
          min={1}
          max={32}
          className={`w-10 ${input} text-center`}
          value={section.timeSignatureNumerator}
          onChange={(e) => onChange((s) => ({ ...s, timeSignatureNumerator: Number(e.target.value) || 1 }))}
        />
        <span>/</span>
        <select
          className={select}
          value={2 ** section.timeSignatureDenPower}
          onChange={(e) => onChange((s) => ({ ...s, timeSignatureDenPower: Math.log2(Number(e.target.value)) }))}
        >
          {DENOMINATOR_OPTIONS.map((d) => (
            <option key={d} value={d}>{d}</option>
          ))}
        </select>
      </Field>
      <Field compact={compact} labelText={labelText} name="Bars" short="Bars" title="Section length in bars">
        <input
          type="number"
          min={1}
          className={`w-14 ${input}`}
          value={section.bars}
          onChange={(e) => onChange((s) => ({ ...s, bars: Number(e.target.value) || 1 }))}
        />
      </Field>
      <Field compact={compact} labelText={labelText} name="Beats/chord" short="BTS/CH" title="How long each chord cell lasts">
        <input
          type="number"
          min={1}
          className={`w-14 ${input}`}
          value={section.beatsPerChord}
          onChange={(e) => onChange((s) => ({ ...s, beatsPerChord: Number(e.target.value) || 1 }))}
        />
      </Field>
      <Field
        compact={compact}
        labelText={labelText}
        name="Repeats"
        short="RPT"
        title="How many times this section plays in a row here — repeat the same Chorus without duplicating it into a separate section. 0 skips it without deleting it."
      >
        <input
          type="number"
          min={0}
          className={`w-12 ${input}`}
          value={repeats}
          onChange={(e) => onChangeRepeats(Number(e.target.value))}
        />
      </Field>
    </>
  );

  const restFields = (
    <>
      {drums}
      {harmonyReadout}
      <Field
        compact={compact}
        labelText={labelText}
        name="Velocity"
        short="Velocity"
        title="Also drives the generated drums: quiet sections get sparse patterns, loud ones get intense patterns."
      >
        <select
          className={`${select} ${compact ? "flex-1 min-w-0" : ""}`}
          value={section.velocity}
          onChange={(e) => onChange((s) => ({ ...s, velocity: e.target.value as VelocityPreset }))}
        >
          {VELOCITIES.map((v) => (
            <option key={v} value={v}>{v}</option>
          ))}
        </select>
      </Field>
      <NarrativeArcEditor
        compact={compact}
        narrative={section.narrative}
        onChange={(narrative) => onChange((s) => ({ ...s, narrative }))}
      />
    </>
  );

  return (
    <div className={compact ? "space-y-1.5" : "space-y-1.5"}>
      {/* Identity: the name is the section's own header, then role and delete */}
      <div className={compact ? "flex items-center gap-1.5" : "flex items-center gap-2"}>
        {leading}
        {/* `size` is only read in the paper theme, where the tape is torn to
            the name's length; in the dark theme the field stays `flex-1`. */}
        <input
          className={`tape-input ${compact ? "bg-panelAlt border border-edge rounded px-1.5 py-1" : "bg-transparent outline-none font-medium"} flex-1 min-w-0 ${labelText} text-ink font-medium`}
          size={Math.max(4, section.name.length + 1)}
          value={section.name}
          onChange={(e) => onChange((s) => ({ ...s, name: e.target.value }))}
          title="Section name"
        />
        <select
          className={`${select} ${labelText}`}
          value={section.role}
          onChange={(e) => onChange((s) => ({ ...s, role: e.target.value as SectionRole }))}
          title="Section role — drives drum inference, transitions, and the timeline colour"
        >
          {ROLES.map((r) => (
            <option key={r} value={r}>{r}</option>
          ))}
        </select>
        <button
          className={
            compact
              ? "shrink-0 text-2xs font-mono text-inkMuted/70 hover:text-danger border border-edge rounded px-1.5 py-1"
              : "text-xs text-inkMuted hover:text-danger px-2 shrink-0"
          }
          onClick={onDelete}
          title="Delete this section"
        >
          {compact ? "✕" : "Delete"}
        </button>
      </div>

      {/* Fields: one wrapping row on the page, stacked rows in the rail.
          The host's `extra` (the rail's progression-fit readout) goes straight
          under the numbers it describes, before drums/velocity/arc. */}
      <div className={compact ? "space-y-1.5" : "flex flex-wrap items-center gap-2"}>
        {numberFields}
      </div>
      {extra}
      <div className={compact ? "space-y-1.5" : "flex flex-wrap items-center gap-2"}>
        {restFields}
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
