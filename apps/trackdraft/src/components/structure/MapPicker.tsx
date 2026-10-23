import { useState, useMemo, useEffect } from "react";
import { Link } from "react-router-dom";
import { SONG_MAPS } from "../../data/songMaps";
import { GENRE_CATALOG } from "../../data/genre-catalog/index";
import type { ApplySongMapOptions } from "../../lib/sections";
import { askConfirm } from "../../lib/confirm";
import type { MapSlot, SongMap } from "../../data/songMaps";
import { ArcSparkline, SectionStrip } from "./mapPreview";

type MapSource = "narrative" | "genre";

interface MapPickerProps {
  onApply: (mapId: string, options?: ApplySongMapOptions) => void;
  /** Put the template's ARC onto the sections that already exist, without
   *  replacing them. Only offered when the selected map carries an arc. */
  onApplyArc: (mapId: string, options?: ApplySongMapOptions) => void;
  hasSections: boolean;
}

const PRIMARY_FORM = ""; // sentinel for "map.slots" in the variant <select>, vs. a real variant name

function slotsFor(map: SongMap | undefined, variantName: string, excludeOptional: boolean): MapSlot[] {
  if (!map) return [];
  const base = variantName ? (map.variants?.find((v) => v.name === variantName)?.slots ?? map.slots) : map.slots;
  return excludeOptional ? base.filter((slot) => !slot.optional) : base;
}

export default function MapPicker({ onApply, onApplyArc, hasSections }: MapPickerProps) {
  const [source, setSource] = useState<MapSource>("narrative");
  const maps = useMemo(() => (source === "narrative" ? SONG_MAPS : GENRE_CATALOG), [source]);
  const [selected, setSelected] = useState(maps[0]?.id ?? "");
  const [variantName, setVariantName] = useState<string>(PRIMARY_FORM);
  const [excludeOptional, setExcludeOptional] = useState(false);
  const [seedStyleRecipe, setSeedStyleRecipe] = useState(false);
  const [seedNarrative, setSeedNarrative] = useState(false);

  const map = maps.find((m) => m.id === selected) ?? maps[0];
  const effectiveId = map?.id ?? "";
  const activeSlots = slotsFor(map, variantName, excludeOptional);

  // A map's variants (and which of its slots are optional) only make sense
  // for the map currently selected — reset both whenever the selection
  // changes underneath them, so a stale choice can't carry over.
  useEffect(() => {
    setVariantName(PRIMARY_FORM);
    setExcludeOptional(false);
    setSeedStyleRecipe(false);
    setSeedNarrative(false);
  }, [effectiveId]);

  const hasOptionalSlots = (map?.variants?.find((v) => v.name === variantName)?.slots ?? map?.slots ?? []).some(
    (slot) => slot.optional,
  );
  const narrativeSlotCount = activeSlots.filter((slot) => slot.narrative).length;
  const totalBars = activeSlots.reduce((sum, slot) => sum + (slot.bars ?? 8), 0);

  function switchSource(newSource: MapSource) {
    setSource(newSource);
    const next = newSource === "narrative" ? SONG_MAPS : GENRE_CATALOG;
    if (next.length > 0) setSelected(next[0].id);
  }

  const genreWorkbenchLink = (
    <Link to="/genre-workbench" target="_blank" rel="noopener noreferrer" className="text-xs text-accent hover:underline whitespace-nowrap">
      Genre Workbench →
    </Link>
  );

  const options = { variantName: variantName || undefined, excludeOptional, seedStyleRecipe, seedNarrative };

  return (
    <div className="border border-edge rounded bg-panel">
      {/* Which catalogue, and the way out to research more */}
      <div className="flex items-center justify-between gap-2 px-3 pt-2.5 pb-2 border-b border-edge/40">
        <div className="flex items-center gap-1.5">
          <button
            className={`text-xs px-2 py-0.5 rounded whitespace-nowrap transition-colors ${source === "narrative" ? "bg-accent text-accentInk" : "border border-edge text-inkMuted hover:text-ink"}`}
            onClick={() => switchSource("narrative")}
          >
            Forms &amp; arcs
          </button>
          <button
            className={`text-xs px-2 py-0.5 rounded whitespace-nowrap transition-colors ${source === "genre" ? "bg-accent text-accentInk" : "border border-edge text-inkMuted hover:text-ink"}`}
            onClick={() => switchSource("genre")}
          >
            Genres
            {GENRE_CATALOG.length > 0 && <span className="ml-1 opacity-60">({GENRE_CATALOG.length})</span>}
          </button>
        </div>
        {source === "genre" && genreWorkbenchLink}
      </div>

      {maps.length === 0 ? (
        <p className="p-3 text-xs text-inkMuted">
          No genre maps cataloged yet — visit the {genreWorkbenchLink} to generate some.
        </p>
      ) : (
        <div className="flex flex-col sm:flex-row gap-3 p-3">
          {/* The catalogue, visible at once: a select hid everything but one */}
          <ul className="sm:w-40 shrink-0 flex sm:flex-col gap-1 overflow-x-auto sm:overflow-x-visible sm:max-h-60 sm:overflow-y-auto">
            {maps.map((m) => {
              const carriesArc = (m.slots ?? []).some((slot) => slot.narrative);
              const isSelected = m.id === effectiveId;
              return (
                <li key={m.id}>
                  <button
                    onClick={() => setSelected(m.id)}
                    /* truncate, not nowrap: "PEC (Problem / Explore / Change)"
                       is wider than the column, and a name running over its
                       neighbour reads as a layout bug */
                    className={`sm:w-full max-w-full text-left text-xs rounded px-2 py-1 border truncate ${
                      isSelected ? "border-accent text-ink bg-accent/10" : "border-transparent text-inkMuted hover:text-ink hover:bg-panelAlt"
                    }`}
                    title={m.description}
                  >
                    {carriesArc && <span className="mr-1 opacity-60" title="carries a narrative arc">◆</span>}
                    {m.name}
                  </button>
                </li>
              );
            })}
          </ul>

          {/* What you'd get */}
          <div className="flex-1 min-w-0 space-y-2">
            {map && (
              <>
                <div>
                  <h3 className="text-sm font-medium text-ink">{map.name}</h3>
                  <p className="text-xs text-inkMuted">{map.description}</p>
                </div>
                {narrativeSlotCount > 0 && <ArcSparkline slots={activeSlots} />}
                <SectionStrip slots={activeSlots} />
                <p className="text-2xs font-mono text-inkMuted/70 tabular-nums">
                  {activeSlots.length} sections · {totalBars} bars
                  {narrativeSlotCount > 0 && ` · ${narrativeSlotCount} with an arc`}
                </p>
              </>
            )}

            {/* Form variants and the two opt-ins — options, not actions */}
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 pt-1">
              {map && map.variants && map.variants.length > 0 && (
                <label className="flex items-center gap-1 text-xs text-inkMuted">
                  Form
                  <select
                    className="bg-panelAlt border border-edge rounded text-xs px-1.5 py-0.5"
                    value={variantName}
                    onChange={(e) => setVariantName(e.target.value)}
                  >
                    <option value={PRIMARY_FORM}>{map.name} (default)</option>
                    {map.variants.map((v) => (
                      <option key={v.name} value={v.name}>{v.name}</option>
                    ))}
                  </select>
                </label>
              )}
              {hasOptionalSlots && (
                <label className="flex items-center gap-1.5 text-xs text-inkMuted" title="Drop the sections a template marks optional">
                  <input type="checkbox" checked={excludeOptional} onChange={(e) => setExcludeOptional(e.target.checked)} />
                  Shorter edit
                </label>
              )}
              {map?.defaults?.genre && (
                <label className="flex items-center gap-1.5 text-xs text-inkMuted" title="Copy the genre's style recipe into the Bend sliders — tempo excluded, the template's BPM wins">
                  <input type="checkbox" checked={seedStyleRecipe} onChange={(e) => setSeedStyleRecipe(e.target.checked)} />
                  Seed Bend sliders
                  <span className="text-inkMuted/50">· {map.defaults.genre}</span>
                </label>
              )}
              {narrativeSlotCount > 0 && (
                <label className="flex items-center gap-1.5 text-xs text-inkMuted" title="Carry the template's tension/energy/warp arcs onto the sections it creates">
                  <input type="checkbox" checked={seedNarrative} onChange={(e) => setSeedNarrative(e.target.checked)} />
                  Seed the arc
                </label>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Two scopes, stated as buttons rather than implied by a checkbox:
          build the song from this form, or shape the one you already have */}
      {map && maps.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 px-3 py-2 border-t border-edge/40 bg-panelAlt/30">
          <button
            className="bg-accent text-accentInk text-xs font-medium px-2.5 py-1 rounded"
            title={hasSections ? "Replace every section with this form" : "Build the song from this form"}
            onClick={async () => {
              if (hasSections && !(await askConfirm({ title: "Replace sections", message: `Replace all sections with the "${map.name}" template?`, confirmLabel: "Replace", danger: true }))) return;
              onApply(effectiveId, options);
            }}
          >
            {hasSections ? "Replace sections with this form" : "Use this form"}
          </button>
          {hasSections && narrativeSlotCount > 0 && (
            <button
              className="text-xs border border-edge rounded px-2.5 py-1 text-inkMuted hover:text-ink hover:bg-panelAlt"
              title="Read this template's arc across your own sections — same tension/energy/warp shape, none of your structure, chords, meters or drums replaced"
              onClick={() => onApplyArc(effectiveId, { variantName: variantName || undefined, excludeOptional })}
            >
              Shape my sections only
            </button>
          )}
          <span className="text-2xs text-inkMuted/60">
            {hasSections
              ? "Replacing rebuilds the arrangement; shaping only re-inks its arc"
              : "A new song starts from this form"}
          </span>
        </div>
      )}
    </div>
  );
}
