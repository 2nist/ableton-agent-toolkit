import { useEffect, useState } from "react";
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

/** Narrow step-sequencer strip for a free-form Euclidean pattern. */
function EuclidStepView({ k, n, rotation, color }: { k: number; n: number; rotation: number; color: string }) {
  const onsets = euclidOnsetSteps({ k, n, rotation });
  return (
    <div className="flex gap-px">
      {Array.from({ length: n }).map((_, i) => (
        <div
          key={i}
          className="h-3 w-3 rounded-[2px]"
          style={{ background: onsets.includes(i) ? color : "rgba(255,255,255,0.08)" }}
        />
      ))}
    </div>
  );
}

/** The Drum tab's dock editor — a single "Pattern" tool replacing the old
 *  dock. Clicking a section on the timeline loads it here; every edit is
 *  written to a working draft that the timeline previews live (necklaces,
 *  step view, domes), and only committed to the song with Apply (undoable)
 *  or thrown away with Revert. Three sub-tabs — Pattern, Variation,
 *  Transition — each shows the Euclidean pattern display (necklace + step
 *  view) alongside its controls, labelled with intuitive names. */
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

  // Switching sections throws away any uncommitted draft — a draft is a
  // "this section, right now" working surface, not song data.
  useEffect(() => {
    clearDraft();
    setVoice(null);
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
  const n = outline ? outlineNumerator(outline) : 7;
  const validCounts = twoThreeCellCounts(n);
  const k = outline ? outline.cells.length : (validCounts[0] ?? 3);
  const rotation = outline ? inferRotation(outline, n, k) : 0;

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

  function setMode(next: DrumMode) {
    draftWith((sec) => {
      if (next === "auto") return { ...sec, drumPattern: undefined, drumVariantIndex: undefined };
      return { ...sec, drumPattern: sec.drumPattern ?? "standard", drumVariantIndex: sec.drumPattern ? sec.drumVariantIndex : 0 };
    });
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
    <div className="p-3 space-y-3">
      <div className="flex items-center justify-between">
        <span className="font-mono text-3xs uppercase tracking-wider text-inkMuted">Pattern · {section.name}</span>
        {isDraft && (
          <span className="font-mono text-3xs uppercase tracking-wider text-[#E8B54A]">● preview</span>
        )}
      </div>

      <div className="flex gap-1">
        {(["pattern", "variation", "transition"] as ToolTab[]).map((t) => (
          <button key={t} className={tab === t ? TAB_ON : TAB} onClick={() => setTab(t)}>
            {t}
          </button>
        ))}
      </div>

      {isDraft && (
        <div className="flex gap-1">
          <button
            className="flex-1 font-mono text-2xs rounded px-2 py-1 border border-accent text-accent bg-accent/10 hover:bg-accent/20"
            onClick={apply}
          >
            Apply
          </button>
          <button
            className="flex-1 font-mono text-2xs rounded px-2 py-1 border border-edge text-inkMuted hover:text-ink"
            onClick={clearDraft}
          >
            Revert
          </button>
        </div>
      )}

      {tab === "pattern" && (
        <div className="space-y-3">
          <div>
            <span className="font-mono text-3xs uppercase tracking-wider text-inkMuted block mb-1">Pattern</span>
            {outline ? (
              <div className="space-y-1.5">
                <NecklaceRow necklaces={outlineNecklaces} />
                <StepView outline={outline} color="#E8B54A" />
                <p className="font-mono text-2xs text-inkMuted">{k} / {n} · rot {rotation} · {outline.label}</p>
              </div>
            ) : necklace ? (
              <NecklaceRow necklaces={necklace} />
            ) : (
              <p className="text-3xs text-inkMuted italic">No resolvable hits.</p>
            )}
          </div>

          <div className="flex gap-1">
            {(["auto", "preset"] as DrumMode[]).map((m) => (
              <button key={m} className={mode === m ? CHIP_ON : CHIP} onClick={() => setMode(m)}>
                {m}
              </button>
            ))}
          </div>

          {mode === "preset" && (
            <>
              <div className="flex flex-wrap gap-1">
                {DRUM_PATTERN_OPTIONS.map((p) => (
                  <button key={p} className={eff.drumPattern === p ? CHIP_ON : CHIP} onClick={() => setPreset(p)}>
                    {p}
                  </button>
                ))}
              </div>
              {variantTotal > 1 && (
                <div className="flex items-center justify-between">
                  <span className="font-mono text-2xs uppercase tracking-wider text-inkMuted">Variant</span>
                  <div className="flex items-center gap-2">
                    <button className={CHIP} onClick={() => stepVariant(-1)}>−</button>
                    <span className="font-mono text-2xs tabular-nums text-ink">{(eff.drumVariantIndex ?? 0) + 1} / {variantTotal}</span>
                    <button className={CHIP} onClick={() => stepVariant(1)}>+</button>
                  </div>
                </div>
              )}
            </>
          )}

          {mode === "auto" && (
            <p className="text-2xs text-inkMuted leading-relaxed">
              Voices without their own pattern use the engine's pick (role, meter, velocity).
            </p>
          )}

          <div>
            <span className="font-mono text-3xs uppercase tracking-wider text-inkMuted block mb-1">Voice by voice</span>
            <div className="flex flex-wrap gap-1 mb-2">
              {voiceChoices.map((v) => (
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
            {activeVoice &&
              (voicePat ? (
                <>
                  <div className="space-y-1.5 mb-2">
                    <NecklaceRow necklaces={necklace ? necklace.filter((n) => n.voice === activeVoice) : null} />
                    <EuclidStepView k={voiceK} n={voiceN} rotation={voiceRot} color="#E8B54A" />
                    <p className="font-mono text-2xs text-inkMuted">
                      {voiceK} / {voiceN} · rot {voiceRot}
                    </p>
                  </div>
                  <FreeSliders n={voiceN} k={voiceK} rotation={voiceRot} onChange={(nv, kv, rv) => setVoicePattern(activeVoice, nv, kv, rv)} />
                  <button
                    className="w-full font-mono text-2xs rounded px-2 py-1 border border-edge text-inkMuted hover:text-ink mt-2"
                    onClick={() => clearVoicePattern(activeVoice)}
                  >
                    Reset to base
                  </button>
                </>
              ) : (
                <div className="flex items-center justify-between">
                  <p className="text-2xs text-inkMuted">
                    {voiceHasBase ? "Uses the base pattern." : "Not in this section's base — give it its own."}
                  </p>
                  <button className={CHIP_ON} onClick={() => setVoicePattern(activeVoice, voiceN, voiceK, 0)}>
                    Set custom
                  </button>
                </div>
              ))}
          </div>
        </div>
      )}

      {tab === "variation" && (
        <div className="space-y-3">
          <div>
            <span className="font-mono text-3xs uppercase tracking-wider text-inkMuted block mb-1">
              Variation · this section's ending detour
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
