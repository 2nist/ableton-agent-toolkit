import { useEffect, useRef, useState } from "react";
import { useSongStore } from "../../store/songStore";
import { useDrumsSelectionStore } from "../../store/drumsSelectionStore";
import { useDrumsDraftStore } from "../../store/drumsDraftStore";
import { updateSection } from "../../lib/sections";
import {
  DRUM_PATTERN_OPTIONS,
  variantCount,
  resolveSectionVoiceNecklaces,
  resolveOutlineVoiceNecklaces,
  euclidOnsetSteps,
} from "../../lib/playback/drumPreview";
import { TRANSITION_COLOR, TRANSITION_LABEL, TRANSITION_MODELS } from "./transitionStyle";
import NecklaceRow from "./NecklaceRow";
import { VOICE_LABEL, VOICE_ORDER } from "./voiceStyle";
import { buildEuclideanOutline, twoThreeCellCounts, numerator as outlineNumerator, type KitVoice } from "@drum/library";
import type { BlueprintSection, DrumPattern, DrumTransitionModel, MeterOutline } from "../../types/blueprint";

type DrumMode = "auto" | "preset";
type ToolTab = "pattern" | "variation" | "transition";

const DEFAULT_DENOM = 8;
const CHIP = "font-mono text-2xs rounded px-2 py-1 border border-edge text-inkMuted hover:text-ink";
const CHIP_ON = "font-mono text-2xs rounded px-2 py-1 border border-accent text-accent bg-accent/10";
const TAB = "flex-1 rounded border border-edge px-2 py-1 font-mono text-2xs uppercase tracking-wider text-inkMuted hover:text-ink";
const TAB_ON = "flex-1 rounded border border-accent px-2 py-1 font-mono text-2xs uppercase tracking-wider text-accent bg-accent/10";

function modeOf(sec: BlueprintSection): DrumMode {
  return sec.drumPattern ? "preset" : "auto";
}

/** Which rotation (if any) of `buildEuclideanOutline(n, d, k, r)` matches
 *  the outline's cells — so the Offset slider shows a real number rather
 *  than a guess after manual edits. */
function inferRotation(outline: MeterOutline, n: number, k: number): number {
  if (!twoThreeCellCounts(n).includes(k)) return 0;
  const d = Math.round(4 / outline.cellBeats);
  for (let r = 0; r < k; r++) {
    const cells = buildEuclideanOutline(n, d, k, r).cells;
    if (cells.length === outline.cells.length && cells.every((c, i) => c === outline.cells[i])) return r;
  }
  return 0;
}

function SliderRow({ label, min, max, value, display, onChange }: {
  label: string; min: number; max: number; value: number; display?: number; onChange: (v: number) => void;
}) {
  return (
    <label className="block">
      <span className="flex items-center justify-between font-mono text-2xs uppercase tracking-wider text-inkMuted mb-0.5">
        <span>{label}</span>
        <span className="text-ink tabular-nums">{display ?? value}</span>
      </span>
      <input
        type="range"
        min={min}
        max={Math.max(min, max)}
        step={1}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full h-1.5 accent-[#E8B54A] cursor-pointer"
      />
    </label>
  );
}

/** Length (n) / Density (k) / Offset (rotation) — the intuitive way to
 *  author "k pulses spread as evenly as possible across n steps". */
function EuclidSliders({ n, denom, k, rotation, onChange }: {
  n: number; denom: number; k: number; rotation: number;
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

/** Free-form Length (n) / Density (k) / Offset (rotation) sliders for a
 *  per-voice Euclidean pattern — Density is freely adjustable 1..n (`k`
 *  onsets spread as evenly as possible across `n` steps). Changing one
 *  slider only touches that value (clamping the others only if they'd
 *  fall out of range). */
function FreeSliders({ n, k, rotation, onChange }: {
  n: number; k: number; rotation: number;
  onChange: (n: number, k: number, r: number) => void;
}) {
  return (
    <div className="space-y-2.5">
      <SliderRow
        label="Length"
        min={2}
        max={16}
        value={n}
        onChange={(v) => onChange(v, Math.min(k, v), Math.min(rotation, v - 1))}
      />
      <SliderRow label="Density" min={1} max={n} value={k} onChange={(v) => onChange(n, v, rotation)} />
      <SliderRow label="Offset" min={0} max={Math.max(0, n - 1)} value={rotation} onChange={(v) => onChange(n, k, v)} />
    </div>
  );
}

/** Narrow step-sequencer strip: n cells, the k onsets filled in. */
function StepView({ outline, color }: { outline: MeterOutline; color: string }) {
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
          className="h-3 w-3 rounded-[2px]"
          style={{ background: on ? color : "rgba(255,255,255,0.08)" }}
        />
      ))}
    </div>
  );
}

/** Narrow step-sequencer strip for a free-form Euclidean pattern. `large`
 *  renders a bigger grid for the Voice-by-Voice editor's pattern display. */
function EuclidStepView({ k, n, rotation, color, large }: { k: number; n: number; rotation: number; color: string; large?: boolean }) {
  const onsets = euclidOnsetSteps({ k, n, rotation });
  const box = large ? "h-4 w-4 rounded-[3px]" : "h-3 w-3 rounded-[2px]";
  return (
    <div className="flex gap-px">
      {Array.from({ length: n }).map((_, i) => (
        <div
          key={i}
          className={box}
          style={{ background: onsets.includes(i) ? color : "rgba(255,255,255,0.08)" }}
        />
      ))}
    </div>
  );
}

/** The Drum tab's dock editor. Clicking a section on the timeline loads it
 *  here; every edit is written to a working draft the timeline previews
 *  live, committed to the song with Apply (undoable) or thrown away with
 *  Optimized for the horizontal bottom dock: the tab row also carries the
 *  section-groove controls (Auto + Preset + Variant). The Pattern tab is
 *  Voice-by-Voice first — voice chips | a large Euclidean pattern display |
 *  the Length/Density/Offset sliders — with the whole-section Euclidean
 *  editor tucked at the bottom for genuine outline/odd-meter sections.
 *  Tabs: Pattern · Detour (ending rhythm detour) · Transition.
 *  TODO: Transition models all render the same today — the model only
 *  stores an energy label (build/break/cut/drop); the audible difference
 *  is applied at export in the bridge, not previewed here yet. */
export default function DrumPatternTools() {
  const currentSong = useSongStore((s) => s.currentSong());
  const updateCurrentSong = useSongStore((s) => s.updateCurrentSong);
  const selectedSectionId = useDrumsSelectionStore((s) => s.selectedSectionId);
  const draftSectionId = useDrumsDraftStore((s) => s.sectionId);
  const draftSection = useDrumsDraftStore((s) => s.section);
  const setDraft = useDrumsDraftStore((s) => s.setDraft);
  const clearDraft = useDrumsDraftStore((s) => s.clearDraft);
  const [tab, setTab] = useState<ToolTab>("pattern");
  const [voice, setVoice] = useState<KitVoice | null>(null);
  // The preset to restore when Auto is toggled back off — kept locally so
  // switching to Auto doesn't forget the groove you were just on.
  const lastPresetRef = useRef<DrumPattern | null>(null);

  // Switching sections throws away any uncommitted draft — a draft is a
  // "this section, right now" working surface, not song data.
  useEffect(() => {
    clearDraft();
    setVoice(null);
    lastPresetRef.current = null;
  }, [selectedSectionId, clearDraft]);

  if (!currentSong) return null;
  const song = currentSong;
  const section = song.sections.find((s) => s.id === selectedSectionId) ?? null;
  if (!section) {
    return (
      <div className="p-3">
        <p className="text-xs text-inkMuted">Click a section on the timeline to edit its pattern.</p>
      </div>
    );
  }

  // Non-null alias for use inside the helper closures below (TS narrows
  // `section` in linear code but not inside hoisted function declarations).
  const activeSection = section;

  const isDraft = draftSectionId === section.id && draftSection !== null;
  const eff = isDraft && draftSection ? draftSection : section;
  const mode = modeOf(eff);
  const outline = eff.drumMeterOutline;
  // Default length 8 (eighths) for non-outline sections — it has more than
  // one valid density (3 or 4), so the always-on Euclid sliders are usable
  // the moment a section is picked instead of a locked default.
  const n = outline ? outlineNumerator(outline) : 8;
  const validCounts = twoThreeCellCounts(n);
  const k = outline ? outline.cells.length : (validCounts[0] ?? 3);
  const rotation = outline ? inferRotation(outline, n, k) : 0;
  const baseDenom = outline ? Math.round(4 / outline.cellBeats) : DEFAULT_DENOM;

  const variation = eff.drumVariationOutline;
  const vDenom = variation ? Math.round(4 / variation.cellBeats) : DEFAULT_DENOM;
  const vN = variation ? outlineNumerator(variation) : 7;
  const vValid = twoThreeCellCounts(vN);
  const vK = variation ? variation.cells.length : (vValid[0] ?? 3);
  const vRot = variation ? inferRotation(variation, vN, vK) : 0;

  const necklace = resolveSectionVoiceNecklaces(eff, song.concept);
  const outlineNecklaces = outline ? resolveOutlineVoiceNecklaces(outline) : null;
  const variantTotal = variantCount(eff.drumPattern);

  // Per-voice override editing — pick ANY voice (not just ones already in
  // the base). Giving rim / crash / toms their own pattern adds them to the
  // timeline, layered on top of the section's base groove.
  const voiceChoices: KitVoice[] = VOICE_ORDER;
  const activeVoice =
    voice && voiceChoices.includes(voice)
      ? voice
      : (voiceChoices.find((v) => eff.drumVoicePatterns?.[v]) ??
         (necklace ? voiceChoices.find((v) => necklace.some((n) => n.voice === v)) : undefined) ??
         voiceChoices[0]);
  const voicePat = activeVoice && eff.drumVoicePatterns ? eff.drumVoicePatterns[activeVoice] : undefined;
  const voiceN = voicePat?.n ?? 7;
  const voiceK = voicePat?.k ?? Math.min(3, voiceN);
  const voiceRot = voicePat?.rotation ?? 0;
  const voiceHasBase = necklace ? necklace.some((n) => n.voice === activeVoice) : false;

  function draftWith(updater: (sec: BlueprintSection) => BlueprintSection) {
    setDraft(activeSection.id, updater({ ...eff }));
  }

  function apply() {
    if (!isDraft || !draftSection) return;
    updateCurrentSong((s) => updateSection(s, activeSection.id, () => draftSection));
    clearDraft();
  }

  /** Auto toggles: on → let the engine pick the groove; clicking it again
   *  turns it off and restores the last explicit preset (or "standard"). */
  function toggleAuto() {
    if (mode === "auto") {
      const restore = lastPresetRef.current ?? "standard";
      draftWith((sec) => ({
        ...sec,
        drumPattern: restore,
        drumVariantIndex: sec.drumVariantIndex ?? 0,
      }));
    } else {
      if (eff.drumPattern) lastPresetRef.current = eff.drumPattern;
      draftWith((sec) => ({ ...sec, drumPattern: undefined, drumVariantIndex: undefined }));
    }
  }

  function setPreset(val: string) {
    draftWith((sec) => ({
      ...sec,
      drumPattern: val ? (val as DrumPattern) : undefined,
      drumVariantIndex: val ? 0 : undefined,
      drumMeterOutline: undefined,
    }));
  }

  function stepVariant(delta: number) {
    const total = variantCount(eff.drumPattern);
    if (total <= 1) return;
    draftWith((sec) => {
      const cur = sec.drumVariantIndex ?? 0;
      return { ...sec, drumVariantIndex: Math.max(0, Math.min(total - 1, cur + delta)) };
    });
  }

  /** Regenerate the whole section's rhythm as a free-form Euclidean meter
   *  outline (odd meters / hand-edited pulses) — shown right away with the
   *  Euclid sliders. Mirrors the export priority: outline beats preset. */
  function setOutline(nv: number, kv: number, rv: number) {
    draftWith((sec) => ({
      ...sec,
      drumMeterOutline: buildEuclideanOutline(nv, baseDenom, kv, rv),
    }));
  }


  function setVariation(nv: number, kv: number, rv: number) {
    draftWith((sec) => ({
      ...sec,
      drumVariationOutline: buildEuclideanOutline(nv, vDenom, kv, rv),
      drumVariationBars: sec.drumVariationBars ?? 1,
    }));
  }

  function clearVariation() {
    draftWith((sec) => ({ ...sec, drumVariationOutline: undefined, drumVariationBars: undefined }));
  }

  function setVariationBars(bars: number) {
    draftWith((sec) => ({ ...sec, drumVariationBars: Math.max(1, bars) }));
  }

  function setTransitionModel(model: DrumTransitionModel | null) {
    draftWith((sec) => ({
      ...sec,
      drumTransitionModel: model ?? undefined,
      drumTransitionBars: model ? (sec.drumTransitionBars ?? 1) : undefined,
    }));
  }

  function setTransitionBars(bars: number) {
    draftWith((sec) => ({ ...sec, drumTransitionBars: Math.max(1, bars) }));
  }

  function setVoicePattern(v: KitVoice, nv: number, kv: number, rv: number) {
    draftWith((sec) => ({
      ...sec,
      drumVoicePatterns: { ...sec.drumVoicePatterns, [v]: { k: kv, n: nv, rotation: rv } },
    }));
  }

  function clearVoicePattern(v: KitVoice) {
    draftWith((sec) => {
      const o = { ...(sec.drumVoicePatterns ?? {}) };
      delete o[v];
      return { ...sec, drumVoicePatterns: o };
    });
  }

  return (
    <div className="p-2.5 space-y-2.5">
      <div className="flex items-center justify-between">
        <span className="font-mono text-3xs uppercase tracking-wider text-inkMuted">Pattern · {section.name}</span>
        {isDraft && (
          <span className="font-mono text-3xs uppercase tracking-wider text-[#E8B54A]">● preview</span>
        )}
      </div>

      <div className="flex items-center gap-1.5">
        <div className="flex gap-1 flex-1 min-w-0">
          {(["pattern", "variation", "transition"] as ToolTab[]).map((t) => (
            <button key={t} className={tab === t ? TAB_ON : TAB} onClick={() => setTab(t)}>
              {t === "variation" ? "Detour" : t === "pattern" ? "Pattern" : "Transition"}
            </button>
          ))}
        </div>
        <button
          className={mode === "auto" ? CHIP_ON : CHIP}
          onClick={toggleAuto}
          title={
            mode === "auto"
              ? "Auto is on — click to switch back to a preset groove"
              : "Let the engine pick this section's groove from role / meter / velocity"
          }
        >
          Auto
        </button>
        <select
          className="w-40 shrink-0 bg-panelAlt border border-edge rounded px-2 py-1 text-xs text-ink"
          value={mode === "preset" ? (eff.drumPattern ?? "") : ""}
          onChange={(e) => setPreset(e.target.value)}
          title="Named pattern preset for the whole section — Auto defers to the engine"
        >
          <option value="">Preset…</option>
          <optgroup label="Common">
            {["none", "kick_only", "standard", "half_time", "driving", "bridge_sparse", "intense", "dnb"].map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </optgroup>
          <optgroup label="Odd meter">
            {["78", "68", "54"].map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </optgroup>
        </select>
        {variantTotal > 1 && (
          <div className="flex items-center gap-1 shrink-0" title="Which variant of this preset to use">
            <button className={CHIP} onClick={() => stepVariant(-1)}>◀</button>
            <span className="font-mono text-2xs tabular-nums text-ink min-w-[44px] text-center">
              {(eff.drumVariantIndex ?? 0) + 1}/{variantTotal}
            </span>
            <button className={CHIP} onClick={() => stepVariant(1)}>▶</button>
          </div>
        )}
        {isDraft && (
          <div className="flex items-center gap-1 shrink-0" title="Commit or discard the working draft">
            <button
              className="font-mono text-2xs rounded px-2 py-1 border border-accent text-accent bg-accent/10 hover:bg-accent/20"
              onClick={apply}
            >
              Apply
            </button>
            <button
              className="font-mono text-2xs rounded px-2 py-1 border border-edge text-inkMuted hover:text-ink"
              onClick={clearDraft}
            >
              Revert
            </button>
          </div>
        )}
      </div>

      {tab === "pattern" && (
        <div className="space-y-2.5">
          {/* Voice by voice — the primary shape editor, always on. All voice
              chips on the left in two columns (7 / 6), the Euclidean pattern
              in the middle, the Length/Density/Offset sliders on the right. */}
          <div className="flex items-start gap-3">
            {/* Left — all 13 voice chips, two columns (7 / 6). */}
            <div className="flex gap-1.5 shrink-0">
              <div className="flex flex-col items-stretch gap-0.5">
                {voiceChoices.slice(0, 7).map((v) => (
                  <button
                    key={v}
                    className={v === activeVoice ? CHIP_ON : CHIP}
                    onClick={() => setVoice(v)}
                    title={eff.drumVoicePatterns?.[v] ? "has its own pattern" : undefined}
                  >
                    {VOICE_LABEL[v] ?? v}
                  </button>
                ))}
              </div>
              <div className="flex flex-col items-stretch gap-0.5">
                {voiceChoices.slice(7).map((v) => (
                  <button
                    key={v}
                    className={v === activeVoice ? CHIP_ON : CHIP}
                    onClick={() => setVoice(v)}
                    title={eff.drumVoicePatterns?.[v] ? "has its own pattern" : undefined}
                  >
                    {VOICE_LABEL[v] ?? v}
                  </button>
                ))}
              </div>
            </div>

            {/* Middle — large Euclidean pattern display, centered in the
                space between the chip columns and the sliders. */}
            {activeVoice && (
              <div className="flex-1 min-w-0 flex flex-col items-center gap-1.5">
                <span className="font-mono text-3xs uppercase tracking-wider text-inkMuted">
                  {VOICE_LABEL[activeVoice]} · pattern
                </span>
                <NecklaceRow large necklaces={necklace ? necklace.filter((n) => n.voice === activeVoice) : null} />
                <EuclidStepView k={voiceK} n={voiceN} rotation={voiceRot} color="#E8B54A" large />
                <p className="font-mono text-2xs text-inkMuted">
                  {voiceK} / {voiceN} · rot {voiceRot}
                </p>
                <p className="text-2xs text-inkMuted/70 text-center">
                  {voicePat
                    ? "This voice's own groove."
                    : voiceHasBase
                      ? "Uses the base pattern — drag a slider to give this voice its own."
                      : "Not in this section's base — drag a slider to add it."}
                </p>
              </div>
            )}

            {/* Right — sliders. */}
            {activeVoice && (
              <div className="w-44 shrink-0">
                <FreeSliders
                  n={voiceN}
                  k={voiceK}
                  rotation={voiceRot}
                  onChange={(nv, kv, rv) => setVoicePattern(activeVoice, nv, kv, rv)}
                />
                {voicePat ? (
                  <button
                    className="w-full font-mono text-2xs rounded px-2 py-1 border border-edge text-inkMuted hover:text-ink mt-2"
                    onClick={() => clearVoicePattern(activeVoice)}
                  >
                    Reset to base
                  </button>
                ) : (
                  <p className="text-2xs text-inkMuted/70 mt-1">Move a slider to give this voice its own pattern.</p>
                )}
              </div>
            )}
          </div>

          {/* Whole-section Euclidean — at the bottom: it's only meaningful
              for genuine outline/odd-meter sections (a named preset isn't
              one k/n). For preset/auto sections just show a compact
              overview of the resolved groove. */}
          {outline ? (
            <div className="border-t border-edge/60 pt-2.5 space-y-1.5">
              <span className="font-mono text-3xs uppercase tracking-wider text-inkMuted block">
                Euclidean · whole section
              </span>
              <div className="flex items-start gap-3">
                <div className="flex-1 min-w-0 space-y-1.5">
                  <NecklaceRow necklaces={outlineNecklaces} />
                  <StepView outline={outline} color="#E8B54A" />
                  <p className="font-mono text-2xs text-inkMuted">
                    {k} / {n} · rot {rotation} · {outline.label}
                  </p>
                </div>
                <div className="w-44 shrink-0">
                  <EuclidSliders n={n} denom={baseDenom} k={k} rotation={rotation} onChange={setOutline} />
                </div>
              </div>
            </div>
          ) : necklace ? (
            <div className="border-t border-edge/60 pt-2.5">
              <span className="font-mono text-3xs uppercase tracking-wider text-inkMuted block mb-1">
                Pattern · whole section
              </span>
              <NecklaceRow necklaces={necklace} />
            </div>
          ) : null}
        </div>
      )}

      {tab === "variation" && (
        <div className="space-y-3">
          <div>
            <span className="font-mono text-3xs uppercase tracking-wider text-inkMuted block mb-1">
              Detour · this section's ending rhythm detour
            </span>
            {variation ? (
              <div className="space-y-2">
                <div className="space-y-1.5">
                  <NecklaceRow necklaces={resolveOutlineVoiceNecklaces(variation)} />
                  <StepView outline={variation} color="#D9954A" />
                  <p className="font-mono text-2xs text-inkMuted">{vK} / {vN} · rot {vRot} · {variation.label}</p>
                </div>
                <EuclidSliders n={vN} denom={vDenom} k={vK} rotation={vRot} onChange={setVariation} />
                <div className="flex items-center justify-between">
                  <span className="font-mono text-2xs uppercase tracking-wider text-inkMuted">Bars</span>
                  <div className="flex items-center gap-2">
                    <button className={CHIP} onClick={() => setVariationBars((eff.drumVariationBars ?? 1) - 1)}>−</button>
                    <span className="font-mono text-2xs tabular-nums text-ink">{eff.drumVariationBars ?? 1}</span>
                    <button className={CHIP} onClick={() => setVariationBars((eff.drumVariationBars ?? 1) + 1)}>+</button>
                  </div>
                </div>
                <button className="w-full font-mono text-2xs rounded px-2 py-1 border border-edge text-inkMuted hover:text-ink" onClick={clearVariation}>
                  Clear variation
                </button>
              </div>
            ) : (
              <div className="flex items-center justify-between">
                <p className="text-2xs text-inkMuted">No variation set.</p>
                <button className={CHIP_ON} onClick={() => setVariation(vN, vK, 0)}>
                  Add detour
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {tab === "transition" && (
        <div className="space-y-3">
          <div>
            <span className="font-mono text-3xs uppercase tracking-wider text-inkMuted block mb-1">
              Transition · this section's ending
            </span>
            <p className="text-2xs text-inkMuted/70 italic mb-2">
              ⚠ TODO — the models share one preview today; the build/break/cut/drop
              difference is only applied at export, not shown here yet.
            </p>
            <div className="flex flex-wrap gap-1 mb-2">
              <button className={!eff.drumTransitionModel ? CHIP_ON : CHIP} onClick={() => setTransitionModel(null)}>
                none
              </button>
              {TRANSITION_MODELS.map((m) => {
                const active = eff.drumTransitionModel === m;
                const color = TRANSITION_COLOR[m];
                return (
                  <button
                    key={m}
                    className={CHIP}
                    style={
                      active
                        ? { color, borderColor: color, backgroundColor: `${color}1a` }
                        : undefined
                    }
                    onClick={() => setTransitionModel(m)}
                  >
                    {TRANSITION_LABEL[m]}
                  </button>
                );
              })}
            </div>
            {eff.drumTransitionModel && (
              <div className="flex items-center justify-between mb-2">
                <span className="font-mono text-2xs uppercase tracking-wider text-inkMuted">Bars</span>
                <div className="flex items-center gap-2">
                  <button className={CHIP} onClick={() => setTransitionBars((eff.drumTransitionBars ?? 1) - 1)}>−</button>
                  <span className="font-mono text-2xs tabular-nums text-ink">{eff.drumTransitionBars ?? 1}</span>
                  <button className={CHIP} onClick={() => setTransitionBars((eff.drumTransitionBars ?? 1) + 1)}>+</button>
                </div>
              </div>
            )}
          </div>

          <div>
            <span className="font-mono text-3xs uppercase tracking-wider text-inkMuted block mb-1">
              Pattern at this section
            </span>
            {outline ? (
              <div className="space-y-1.5">
                <NecklaceRow necklaces={outlineNecklaces} />
                <StepView outline={outline} color="#E8B54A" />
              </div>
            ) : necklace ? (
              <NecklaceRow necklaces={necklace} />
            ) : (
              <p className="text-3xs text-inkMuted italic">No resolvable hits.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
