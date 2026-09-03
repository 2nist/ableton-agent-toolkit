import { useSongStore } from "../../store/songStore";
import { useStudioSelectionStore } from "../../store/studioSelectionStore";
import { STYLE_RECIPES, resolveStyleProfile } from "../../lib/style/bend";
import type { BlueprintSection } from "../../types/blueprint";

/**
 * Mix/Bend — the whole-song style station (Phase D).
 *
 * A set of macro sliders that deterministically tint the song (master) and
 * any single section (override). Each drag writes `song.bend`/`section.bend`
 * through the normal song-store path, so: it's undoable, it persists, and
 * while playing the layout's existing live-refresh subscription replans at
 * the next bar — you HEAR the change as you move the slider ("controls, not
 * dice"; the engine turns the vector into a deterministic seed).
 *
 * Genres are recipes that just SET the sliders. Neutral (all at the mid) ==
 * the engine's current behavior — nothing is bent until you move something.
 */

type AxisKey = "energy" | "density" | "backbeat" | "feel" | "kit" | "harmony";

const STYLE_AXES: { key: AxisKey; label: string; lo: string; hi: string }[] = [
  { key: "energy", label: "Energy", lo: "delicate", hi: "driving" },
  { key: "density", label: "Density", lo: "sparse", hi: "busy" },
  { key: "backbeat", label: "Backbeat", lo: "soft", hi: "locked 2&4" },
  { key: "feel", label: "Feel", lo: "straight", hi: "swung" },
  { key: "kit", label: "Kit", lo: "acoustic", hi: "machine" },
  { key: "harmony", label: "Harmony", lo: "triads", hi: "lush" },
];

const pct = (v: number): string => `${Math.round(v * 100)}%`;

function AxisSlider({ label, lo, hi, value, onChange }: {
  label: string; lo: string; hi: string; value: number; onChange: (v: number) => void;
}) {
  return (
    <label className="block" title={`${lo} → ${hi}`}>
      <span className="flex items-center justify-between font-mono text-2xs uppercase tracking-wider text-inkMuted mb-0.5">
        <span>{label}</span>
        <span className="text-ink tabular-nums">{pct(value)}</span>
      </span>
      <input
        type="range"
        min={0}
        max={1}
        step={0.01}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full h-1.5 accent-[#E8B54A] cursor-pointer"
      />
      <span className="flex justify-between text-[9px] text-inkMuted/50 font-mono leading-none mt-px select-none">
        <span>{lo}</span>
        <span>{hi}</span>
      </span>
    </label>
  );
}

function Block({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="border-t border-edge/50 pt-2">
      <div className="flex items-baseline justify-between mb-1.5">
        <span className="font-mono text-2xs uppercase tracking-wider text-accent">{title}</span>
        {hint && <span className="text-[9px] text-inkMuted/60 font-mono">{hint}</span>}
      </div>
      {children}
    </div>
  );
}

export default function BendPanel() {
  const currentSong = useSongStore((s) => s.currentSong());
  const updateCurrentSong = useSongStore((s) => s.updateCurrentSong);
  const selectedSectionId = useStudioSelectionStore((s) => s.selectedSectionId);

  if (!currentSong) return null;
  const song = currentSong;
  const master = song.bend ?? {};

  const activeSection: BlueprintSection | null =
    song.sections.find((s) => s.id === selectedSectionId) ?? null;
  const sectionHasBend = !!activeSection?.bend && Object.keys(activeSection.bend).length > 0;

  const setMasterAxis = (key: AxisKey, v: number) =>
    updateCurrentSong((s) => ({ ...s, bend: { ...s.bend, [key]: v } }));

  const clearMaster = () =>
    updateCurrentSong((s) => {
      const next = { ...s };
      delete next.bend;
      return next;
    });

  const applyRecipe = (name: string) => {
    const recipe = STYLE_RECIPES[name];
    if (!recipe) return;
    const { tempo, ...axes } = recipe;
    // A recipe is its genre: it sets the tint (bend + tempo) AND the groove
    // DNA (song.genre drives which drum families the sections reach for).
    updateCurrentSong((s) => ({ ...s, genre: name, bend: axes, bpm: tempo }));
  };

  const clearGenre = () =>
    updateCurrentSong((s) => {
      const next = { ...s };
      delete next.genre;
      return next;
    });

  const setSectionOverride = (on: boolean) => {
    if (!activeSection) return;
    const resolved = resolveStyleProfile(activeSection, song);
    const bend = on
      ? {
          energy: resolved.energy,
          density: resolved.density,
          backbeat: resolved.backbeat,
          feel: resolved.feel,
          kit: resolved.kit,
          harmony: resolved.harmony,
        }
      : undefined;
    updateCurrentSong((s) => ({
      ...s,
      sections: s.sections.map((sec) => (sec.id === activeSection.id ? { ...sec, bend } : sec)),
    }));
  };

  const setSectionAxis = (key: AxisKey, v: number) => {
    if (!activeSection) return;
    updateCurrentSong((s) => ({
      ...s,
      sections: s.sections.map((sec) =>
        sec.id === activeSection.id ? { ...sec, bend: { ...(sec.bend ?? {}), [key]: v } } : sec,
      ),
    }));
  };

  const resolved = activeSection ? resolveStyleProfile(activeSection, song) : null;

  return (
    <div className="border border-edge rounded-lg bg-panel p-3 h-full overflow-y-auto">
      <div className="flex items-center justify-between">
        <p className="text-[11px] text-inkMuted uppercase tracking-wide">Mix / Bend</p>
        <span className="font-mono text-[9px] text-inkMuted/60">
          {song.bend ? "bent" : "neutral"}
        </span>
      </div>

      {/* Song master */}
      <Block title="Song" hint={song.bend ? "whole-song mix" : "neutral = today's sound"}>
        <div className="flex items-center gap-1.5 mb-1.5">
          <select
            className="flex-1 bg-panelAlt border border-edge rounded px-1.5 py-0.5 text-xs text-ink font-mono"
            value=""
            onChange={(e) => e.target.value && applyRecipe(e.target.value)}
            title="A genre recipe sets the groove family + the sliders — then bend from there"
          >
            <option value="" disabled>Style…</option>
            {Object.keys(STYLE_RECIPES).map((name) => (
              <option key={name} value={name}>{name}</option>
            ))}
          </select>
          {song.bend && (
            <button
              className="text-[10px] px-1.5 py-0.5 rounded border border-edge text-inkMuted hover:text-ink font-mono"
              onClick={clearMaster}
              title="Reset the whole-song mix to neutral (keeps the genre)"
            >
              reset
            </button>
          )}
        </div>
        {song.genre && (
          <p className="flex items-center gap-1.5 text-[10px] font-mono mb-2">
            <span className="text-accent uppercase tracking-wide">{song.genre}</span>
            <span className="text-inkMuted/40">groove DNA</span>
            <button
              className="text-inkMuted/60 hover:text-ink"
              onClick={clearGenre}
              title="Clear the genre — drums fall back to role/velocity picking"
            >
              ✕
            </button>
          </p>
        )}
        <div className="space-y-2">
          {STYLE_AXES.map((axis) => (
            <AxisSlider
              key={axis.key}
              label={axis.label}
              lo={axis.lo}
              hi={axis.hi}
              value={master[axis.key] ?? 0.5}
              onChange={(v) => setMasterAxis(axis.key, v)}
            />
          ))}
        </div>
        {/* Tempo is a song-level value (the transport reads song.bpm), not a
            per-section one — surfaced here so the recipe sets it too. */}
        <label className="block mt-2">
          <span className="flex items-center justify-between font-mono text-2xs uppercase tracking-wider text-inkMuted mb-0.5">
            <span>Tempo</span>
            <span className="text-ink tabular-nums">{song.bpm} bpm</span>
          </span>
          <input
            type="range"
            min={40}
            max={220}
            step={1}
            value={song.bpm}
            onChange={(e) => updateCurrentSong((s) => ({ ...s, bpm: Number(e.target.value) }))}
            className="w-full h-1.5 accent-[#E8B54A] cursor-pointer"
          />
        </label>
      </Block>

      {/* This section — per-section override */}
      <Block title="This section" hint={activeSection ? activeSection.name : "none selected"}>
        {!activeSection ? (
          <p className="text-[10.5px] text-inkMuted/70 italic">
            Click a section in the arrangement to give it its own mix.
          </p>
        ) : (
          <div className="space-y-2">
            <label className="flex items-center gap-1.5 text-[11px] text-ink select-none cursor-pointer">
              <input
                type="checkbox"
                checked={sectionHasBend}
                onChange={(e) => setSectionOverride(e.target.checked)}
                className="accent-[#E8B54A]"
              />
              Override this section
            </label>
            {sectionHasBend && resolved && (
              <div className="space-y-2">
                {STYLE_AXES.map((axis) => (
                  <AxisSlider
                    key={axis.key}
                    label={axis.label}
                    lo={axis.lo}
                    hi={axis.hi}
                    value={activeSection.bend?.[axis.key] ?? resolved[axis.key]}
                    onChange={(v) => setSectionAxis(axis.key, v)}
                  />
                ))}
              </div>
            )}
            {!sectionHasBend && (
              <p className="text-[10px] text-inkMuted/60 italic">
                Follows the song mix. Enable to bend this section away from it.
              </p>
            )}
          </div>
        )}
      </Block>
    </div>
  );
}
