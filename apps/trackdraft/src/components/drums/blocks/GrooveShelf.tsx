import { useMemo, useState } from "react";
import {
  DRUM_LANE_VOICES,
  PRESET_DATA,
  measureFeel,
  voiceOf,
  type DrumNote,
  type DrumPattern,
  type FeelFeatures,
  type KitVoice,
} from "@drum/library";
import type { SectionSpan } from "../../../lib/arrangement";
import type { DrumLaneId, SavedBeat } from "../../../types/blueprint";
import { savedBeatVariant } from "../../../lib/drums/savedBeats";
import type { BlueprintSection } from "../../../types/blueprint";
import { DRUM_LANES, laneColor } from "../laneStyle";
import { usePalette } from "../../../theme/palette";
import { beatsPerBarOf } from "../../../lib/timeline/beatMap";

/**
 * The GROOVE SHELF — pick a groove by SEEING its rhythm.
 *
 * Every card is drawn from the engine's own `PRESET_DATA` (the resolved
 * corpus variant the code will actually play), reduced to a six-surface ×
 * sixteen-step picture with the hit's height carrying its velocity. No
 * names to interpret, no form to fill: the shape you like is the groove
 * you get.
 *
 * The FEEL LENS above the cards is the second half of the idea. The nine
 * measured axes (the engine's `measureFeel`) are surfaced as tactile
 * sliders with musical end-labels — on top ↔ laid back, tight ↔ loose —
 * and moving one RE-RANKS the shelf toward grooves that measure that way.
 * The lens selects; it never edits the pattern. (The Bend dials stay the
 * separate performance tint: energy/density/backbeat/feel/kit.)
 */

type AxisKey = keyof FeelFeatures;

interface AxisDef {
  id: AxisKey;
  label: string;
  lo: string;
  hi: string;
}

/** Nine axes, in the order they read on the strip. The end-labels are the
 *  musical vocabulary — the engine units stay internal. */
const AXES: AxisDef[] = [
  { id: "push", label: "push", lo: "on top", hi: "laid back" },
  { id: "looseness", label: "loose", lo: "tight", hi: "loose" },
  { id: "dynamics", label: "dyn", lo: "flat", hi: "alive" },
  { id: "density", label: "dense", lo: "sparse", hi: "busy" },
  { id: "syncopation", label: "sync", lo: "grounded", hi: "off-kilter" },
  { id: "swing", label: "swing", lo: "straight", hi: "shuffle" },
  { id: "weight", label: "weight", lo: "light", hi: "heavy" },
  { id: "brightness", label: "bright", lo: "dark", hi: "bright" },
  { id: "motion", label: "motion", lo: "static", hi: "rolling" },
];

const LANE_OF_VOICE = new Map<KitVoice, number>();
DRUM_LANES.forEach((lane, li) => {
  for (const voice of DRUM_LANE_VOICES[
    lane.key as keyof typeof DRUM_LANE_VOICES
  ] ?? [])
    LANE_OF_VOICE.set(voice, li);
});

const COLS = 16;
/** In lane scope a pattern may contribute several distinct figures, but not
 *  dozens: the shelf is a menu you scan, not an archive. */
const MAX_LANE_CARDS_PER_PATTERN = 3;

interface Card {
  pattern: DrumPattern;
  /** Which baked variant this card is — the pattern alone is not enough once
   *  one pattern contributes several cards. */
  variant: number;
  label: string;
  /** 6 surfaces × 16 steps of peak velocity (0 = empty). */
  grid: number[][];
  feel: FeelFeatures | null;
}

/** Pretty names for the engine's preset ids. */
const LABELS: Partial<Record<DrumPattern, string>> = {
  standard: "standard",
  driving: "driving",
  half_time: "half-time",
  bridge_sparse: "sparse",
  intense: "intense",
  kick_only: "kick only",
  dnb: "dnb",
  four_on_floor: "four floor",
  trap: "trap",
  breakbeat: "breakbeat",
  motown: "motown",
  boom_bap: "boom bap",
  train_beat: "train",
  bossa: "bossa",
  reggae: "reggae",
  disco: "disco",
  afrobeat: "afrobeat",
  punk: "punk",
  ballad: "ballad",
  second_line: "2nd line",
  "54": "5/4",
  "68": "6/8",
  "78": "7/8",
};

/** `null` = the whole kit; a lane index = "show me every KICK figure". */
type Scope = number | null;

/**
 * One card per (pattern, variant) — and, in lane scope, one per distinct
 * figure for that lane.
 *
 * `scope` does two jobs. It zeroes every other row, so the card IS that
 * drum's pattern rather than a full groove with one row highlighted; and it
 * measures the feel from that lane's notes alone, which is what makes
 * "rank the kick patterns by syncopation" mean something — the whole-kit
 * number is dominated by the hats.
 */
function buildCard(
  pattern: DrumPattern,
  variantIndex: number,
  beatsPerBar: number,
  scope: Scope,
): Card | null {
  const variant = PRESET_DATA[pattern]?.variants?.[variantIndex];
  if (!variant || variant.notes.length === 0) return null;
  const grid = DRUM_LANES.map(() => new Array<number>(COLS).fill(0));
  const scoped: DrumNote[] = [];
  for (const [beat, pitch, velocity] of variant.notes) {
    const voice = voiceOf(pitch);
    const li = voice ? LANE_OF_VOICE.get(voice) : undefined;
    if (li === undefined) continue;
    if (scope !== null && li !== scope) continue;
    scoped.push({ beat, pitch, velocity });
    if (beat >= beatsPerBar) continue;
    const col = Math.max(
      0,
      Math.min(COLS - 1, Math.floor((beat / beatsPerBar) * COLS)),
    );
    grid[li][col] = Math.max(grid[li][col], velocity);
  }
  if (scoped.length === 0) return null;
  const feel = measureFeel(
    scoped,
    Math.max(1, variant.lengthBeats / beatsPerBar),
    beatsPerBar,
  );
  return {
    pattern,
    variant: variantIndex,
    label: LABELS[pattern] ?? pattern,
    grid,
    feel,
  };
}

/** Min/max per axis across the shelf — the lens compares normalised values,
 *  so "busy" means busy FOR THIS MENU, not an absolute count. */
function axisRange(
  cards: Card[],
): Record<AxisKey, { min: number; max: number }> {
  const out = {} as Record<AxisKey, { min: number; max: number }>;
  for (const axis of AXES) {
    const values = cards.map((c) => c.feel?.[axis.id] ?? 0);
    out[axis.id] = { min: Math.min(...values), max: Math.max(...values) };
  }
  return out;
}

export interface GrooveShelfProps {
  span: SectionSpan | null;
  section: BlueprintSection | null;
  /** Pattern the section resolves to right now (auto included). */
  current: DrumPattern | null;
  /** `lane` is non-null when the shelf is lane-scoped: the pick then means
   *  "use this figure for THAT drum", leaving the rest of the beat alone. */
  onPick: (
    pattern: DrumPattern,
    variant: number,
    lane: DrumLaneId | null,
  ) => void;
  /** Beats saved for this song, and the ones saved for every song. */
  songBeats: readonly SavedBeat[];
  userBeats: readonly SavedBeat[];
  /** Apply a saved beat: replaces the lanes it defines. */
  onPickSaved: (beat: SavedBeat) => void;
  /** Save the section's current beat into a scope. */
  onSaveBeat: (name: string, scope: "song" | "library") => void;
  onDeleteSaved: (beat: SavedBeat, scope: "song" | "library") => void;
  /** beats.json — export the library list, or merge one in. */
  onExportBeats: () => void;
  onImportBeats: () => void;
}

export default function GrooveShelf(props: GrooveShelfProps) {
  const P = usePalette();
  const {
    span,
    section,
    current,
    onPick,
    songBeats,
    userBeats,
    onPickSaved,
    onSaveBeat,
    onDeleteSaved,
    onExportBeats,
    onImportBeats,
  } = props;
  const [lens, setLens] = useState<Partial<Record<AxisKey, number>>>({});
  /** null = the whole kit; otherwise the lane whose figures the shelf shows. */
  const [scope, setScope] = useState<Scope>(null);
  /** The saved-beat shelf: this song's saves, then the library's. */
  const [saved, setSaved] = useState<"song" | "library" | null>(null);
  const [saveName, setSaveName] = useState<string | null>(null);
  // The three tiers don't always fit the panel's height, so the shelf can
  // fold down to its name — the canvas gets the room instead.
  const [open, setOpen] = useState<boolean>(() => {
    try {
      return localStorage.getItem("trackdraft-drums-shelf-open") !== "0";
    } catch {
      return true;
    }
  });
  const toggle = () => {
    setOpen((o) => {
      try {
        localStorage.setItem("trackdraft-drums-shelf-open", o ? "0" : "1");
      } catch {
        /* ignore */
      }
      return !o;
    });
  };

  const bpb = span ? beatsPerBarOf(span) : 4;

  /**
   * The shelf's contents.
   *
   * Whole-kit: one card per pattern (its first variant — the pattern's
   * identity, not one of its performances). Lane scope: EVERY variant of every
   * pattern contributes, deduped by that lane's figure, because "all the kick
   * patterns" is a different question from "all the grooves" — four patterns
   * can share a kick and still be four different grooves.
   */
  const savedCards = useMemo(() => {
    if (saved === null) return [];
    const pool = saved === "song" ? songBeats : userBeats;
    return pool.map((beat) => {
      const variant = savedBeatVariant(beat, bpb);
      const grid = DRUM_LANES.map(() => new Array<number>(COLS).fill(0));
      for (const [beatAt, pitch, velocity] of variant.notes) {
        if (beatAt >= bpb) continue;
        const voice = voiceOf(pitch);
        const li = voice ? LANE_OF_VOICE.get(voice) : undefined;
        if (li === undefined) continue;
        const col = Math.max(
          0,
          Math.min(COLS - 1, Math.floor((beatAt / bpb) * COLS)),
        );
        grid[li][col] = Math.max(grid[li][col], velocity);
      }
      const feel = measureFeel(
        variant.notes.map(([beatAt, pitch, velocity]) => ({
          beat: beatAt,
          pitch,
          velocity,
        })),
        Math.max(1, variant.lengthBeats / bpb),
        bpb,
      );
      return {
        beat,
        card: {
          pattern: "standard" as DrumPattern,
          variant: 0,
          label: beat.name,
          grid,
          feel,
        },
      };
    });
  }, [saved, songBeats, userBeats, bpb]);

  const cards = useMemo(() => {
    if (saved !== null) return savedCards.map((entry) => entry.card);
    const out: Card[] = [];
    const seen = new Set<string>();
    const perPattern = scope === null ? 1 : MAX_LANE_CARDS_PER_PATTERN;
    for (const pattern of Object.keys(PRESET_DATA) as DrumPattern[]) {
      const variants = PRESET_DATA[pattern]?.variants ?? [];
      let kept = 0;
      for (
        let index = 0;
        index < variants.length && kept < perPattern;
        index += 1
      ) {
        const card = buildCard(pattern, index, bpb, scope);
        if (!card) continue;
        // The lane's own figure, as a signature: identical kick figures across
        // patterns collapse into one card instead of filling the shelf with
        // the same five dots under ten names.
        const signature = `${pattern}:${card.grid[scope ?? 0]?.join(",") ?? ""}:${scope === null ? index : ""}`;
        const figureOnly = card.grid.map((row) => row.join(",")).join("|");
        const key = scope === null ? signature : figureOnly;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(card);
        kept += 1;
      }
    }
    return out;
  }, [bpb, scope, saved, savedCards]);

  const range = useMemo(() => axisRange(cards), [cards]);
  const touched = AXES.filter((a) => lens[a.id] !== undefined);

  const ranked = useMemo(() => {
    if (touched.length === 0) return cards;
    const score = (c: Card): number => {
      if (!c.feel) return Number.POSITIVE_INFINITY;
      let sum = 0;
      for (const axis of touched) {
        const { min, max } = range[axis.id];
        const norm = max > min ? (c.feel[axis.id] - min) / (max - min) : 0.5;
        sum += (norm - (lens[axis.id] ?? 0.5)) ** 2;
      }
      return sum / touched.length;
    };
    return [...cards]
      .map((c) => ({ c, s: score(c) }))
      .sort((a, b) => a.s - b.s)
      .map((x) => x.c);
  }, [cards, lens, touched, range]);

  if (!section) return null;

  if (!open) {
    return (
      <div className="mb-1.5 flex items-center gap-1.5 border border-edge rounded bg-deep/40 px-2 h-6 select-none">
        <button
          onClick={toggle}
          className="font-mono text-2xs text-inkMuted hover:text-ink"
          title="Open the groove shelf"
          aria-label="Open the groove shelf"
        >
          ›
        </button>
        <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-inkMuted">
          groove shelf
        </span>
        <span className="font-mono text-2xs text-track uppercase">
          {current ?? "auto"}
        </span>
        <span className="flex-1" />
        <span className="font-mono text-2xs text-inkMuted/70">
          click to pick a groove by its shape
        </span>
      </div>
    );
  }

  return (
    <div className="mb-1.5 border border-edge rounded bg-deep/40 select-none">
      {/* the feel lens */}
      <div className="flex items-start gap-3 px-2 pt-1.5 pb-1">
        <button
          onClick={toggle}
          className="font-mono text-2xs text-inkMuted hover:text-ink shrink-0 mt-1"
          title="Fold the shelf away to give the lanes more room"
          aria-label="Fold the groove shelf"
        >
          ⌄
        </button>
        <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-inkMuted shrink-0 mt-1.5">
          feel lens
        </span>
        <div className="grid grid-cols-5 gap-x-3 gap-y-1 flex-1">
          {AXES.map((axis) => (
            <LensSlider
              key={axis.id}
              axis={axis}
              value={lens[axis.id]}
              onChange={(v) => setLens((l) => ({ ...l, [axis.id]: v }))}
            />
          ))}
        </div>
        {touched.length > 0 && (
          <button
            onClick={() => setLens({})}
            className="font-mono text-2xs text-inkMuted hover:text-ink border border-edge rounded px-1 shrink-0"
            title="Clear the lens — back to the shelf's own order"
          >
            ⟲
          </button>
        )}
      </div>

      {/* scope: the whole kit, or one drum's own figure library */}
      <div className="flex items-center gap-1 px-2 pb-1 font-mono text-[9px] uppercase tracking-[0.1em]">
        <span className="text-inkMuted/70 mr-1">show</span>
        <button
          onClick={() => setScope(null)}
          title="Whole grooves: one card per pattern"
          className="rounded px-1.5 py-0.5 border"
          style={{
            borderColor: scope === null ? P.track : P.grid,
            color: scope === null ? P.track : P.label,
          }}
        >
          full beat
        </button>
        {DRUM_LANES.map((lane, li) => (
          <button
            key={lane.key}
            onClick={() => setScope(li)}
            title={`Every ${lane.label.toLowerCase()} figure in the library, ranked by the feel lens`}
            className="rounded px-1.5 py-0.5 border"
            style={{
              borderColor: scope === li ? laneColor(lane, P) : P.grid,
              color: scope === li ? laneColor(lane, P) : P.label,
            }}
          >
            {lane.label.toLowerCase()}
          </button>
        ))}
        <span className="mx-1 text-inkMuted/40">|</span>
        <button
          onClick={() => {
            setSaved(saved === "song" ? null : "song");
            setScope(null);
          }}
          title="Beats you saved for this song"
          className="rounded px-1.5 py-0.5 border"
          style={{
            borderColor: saved === "song" ? P.track : P.grid,
            color: saved === "song" ? P.track : P.label,
          }}
        >
          this song ({songBeats.length})
        </button>
        <button
          onClick={() => {
            setSaved(saved === "library" ? null : "library");
            setScope(null);
          }}
          title="Beats saved for every song"
          className="rounded px-1.5 py-0.5 border"
          style={{
            borderColor: saved === "library" ? P.track : P.grid,
            color: saved === "library" ? P.track : P.label,
          }}
        >
          my beats ({userBeats.length})
        </button>
        <span className="ml-1 text-inkMuted/60 normal-case tracking-normal">
          {saved !== null
            ? saved === "song"
              ? "saved in this song"
              : "saved for every song"
            : scope === null
              ? "one card per groove"
              : `${ranked.length} ${DRUM_LANES[scope]?.label.toLowerCase() ?? ""} figures`}
        </span>
        <span className="flex-1" />
        <button
          onClick={onExportBeats}
          title="Export every saved beat as a beats.json file"
          className="rounded px-1.5 py-0.5 border"
          style={{ borderColor: P.grid, color: P.label }}
        >
          export
        </button>
        <button
          onClick={onImportBeats}
          title="Import a beats.json — merges by beat id"
          className="rounded px-1.5 py-0.5 border"
          style={{ borderColor: P.grid, color: P.label }}
        >
          import
        </button>
        {saveName === null ? (
          <button
            onClick={() => setSaveName("")}
            title="Save the beat that is playing right now"
            className="rounded px-1.5 py-0.5 border"
            style={{ borderColor: P.grid, color: P.label }}
          >
            + save beat
          </button>
        ) : (
          <span className="flex items-center gap-1">
            <input
              autoFocus
              value={saveName}
              placeholder="name this beat"
              onChange={(event) => setSaveName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") setSaveName(null);
              }}
              className="w-40 rounded border border-edge bg-deep/60 px-1 py-0.5 font-mono text-[10px] normal-case text-ink"
            />
            {(["song", "library"] as const).map((target) => (
              <button
                key={target}
                onClick={() => {
                  if (saveName.trim() !== "")
                    onSaveBeat(saveName.trim(), target);
                  setSaveName(null);
                }}
                title={
                  target === "song"
                    ? "Save for this song only"
                    : "Save for every song"
                }
                className="rounded px-1.5 py-0.5 border"
                style={{ borderColor: P.grid, color: P.label }}
              >
                {target === "song" ? "→ song" : "→ library"}
              </button>
            ))}
            <button
              onClick={() => setSaveName(null)}
              className="px-1 text-inkMuted hover:text-ink"
              title="Cancel"
            >
              ×
            </button>
          </span>
        )}
      </div>

      {/* the shelf */}
      <div className="flex gap-1.5 px-2 pb-2 overflow-x-auto">
        {ranked.map((card, i) => {
          const active = current === card.pattern && card.variant === 0;
          const savedEntry =
            saved !== null
              ? (savedCards.find((entry) => entry.card === card) ?? null)
              : null;
          return (
            <div
              key={`${saved ?? "pool"}-${card.label}-${card.variant}`}
              className="relative shrink-0"
            >
              {savedEntry && (
                <button
                  onClick={() => onDeleteSaved(savedEntry.beat, saved!)}
                  title={`Delete "${card.label}"`}
                  className="absolute -right-1 -top-1 z-10 rounded-full border border-edge bg-deep px-1 font-mono text-[9px] leading-none text-inkMuted hover:text-ink"
                >
                  ×
                </button>
              )}
              <button
                onClick={() => {
                  if (savedEntry) {
                    onPickSaved(savedEntry.beat);
                    return;
                  }
                  onPick(
                    card.pattern,
                    card.variant,
                    scope === null
                      ? null
                      : (DRUM_LANES[scope]!.key as DrumLaneId),
                  );
                }}
                title={`${card.label}${scope !== null ? ` · replaces the ${DRUM_LANES[scope]?.label ?? ""} only` : ""}${
                  touched.length > 0 ? ` · match ${i + 1}/${ranked.length}` : ""
                }`}
                className="shrink-0 rounded-sm border px-1 pt-1 pb-0.5"
                style={{
                  borderColor: active ? P.track : P.grid,
                  background: active ? "rgba(232,181,74,0.10)" : "transparent",
                }}
              >
                <svg
                  width={COLS * 4 + 2}
                  height={DRUM_LANES.length * 4 + 2}
                  aria-hidden
                >
                  {card.grid.map((row, li) =>
                    row.map((velocity, q) => {
                      if (velocity <= 0) {
                        return (
                          <rect
                            key={`${li}-${q}`}
                            x={q * 4 + 1}
                            y={li * 4 + 1}
                            width={2.5}
                            height={2}
                            fill={P.grid}
                            opacity={0.25}
                          />
                        );
                      }
                      const h = 1 + (velocity / 127) * 2.6;
                      return (
                        <rect
                          key={`${li}-${q}`}
                          x={q * 4 + 1}
                          y={li * 4 + 1 + (3.6 - h)}
                          width={2.5}
                          height={h}
                          fill={laneColor(DRUM_LANES[li], P)}
                          opacity={0.95}
                        />
                      );
                    }),
                  )}
                </svg>
                <span
                  className="block truncate text-center font-mono uppercase"
                  style={{
                    fontSize: 7,
                    letterSpacing: "0.05em",
                    color: active ? P.track : P.label,
                    maxWidth: 66,
                  }}
                >
                  {card.label}
                </span>
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** One lens axis: name, a bipolar-looking track and the musical end-words. */
function LensSlider({
  axis,
  value,
  onChange,
}: {
  axis: AxisDef;
  value: number | undefined;
  onChange: (v: number) => void;
}) {
  const P = usePalette();
  const [hover, setHover] = useState(false);
  const frac = value ?? 0.5;
  const engaged = value !== undefined;
  return (
    <div
      className="min-w-0"
      title={`${axis.label}: ${axis.lo} ↔ ${axis.hi}${engaged ? "" : " (drag to bias the shelf)"}`}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <div className="flex items-center gap-1">
        <span
          className="font-mono"
          style={{
            fontSize: 6.5,
            letterSpacing: "0.06em",
            color: engaged ? P.track : P.label,
            opacity: engaged ? 1 : 0.7,
          }}
        >
          {axis.label.toUpperCase()}
        </span>
        <div
          className="relative flex-1 rounded-sm cursor-ew-resize touch-none"
          style={{
            height: 9,
            background: P.well,
            border: `1px solid ${P.grid}`,
          }}
          onPointerDown={(e) => {
            if (e.button !== 0) return;
            e.stopPropagation();
            try {
              (e.currentTarget as Element).setPointerCapture(e.pointerId);
            } catch {
              /* fine */
            }
            const rect = (
              e.currentTarget as HTMLElement
            ).getBoundingClientRect();
            onChange(
              Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)),
            );
          }}
          onPointerMove={(e) => {
            if (e.buttons !== 1) return;
            const rect = (
              e.currentTarget as HTMLElement
            ).getBoundingClientRect();
            onChange(
              Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)),
            );
          }}
        >
          <div
            className="absolute inset-y-0"
            style={{
              left: `${frac * 100}%`,
              width: 3,
              marginLeft: -1.5,
              background: engaged ? P.track : P.grid,
            }}
          />
        </div>
      </div>
      <div
        className="flex justify-between"
        style={{
          fontSize: 6,
          lineHeight: "8px",
          color: P.label,
          opacity: hover || engaged ? 0.75 : 0,
        }}
      >
        <span>{axis.lo}</span>
        <span>{axis.hi}</span>
      </div>
    </div>
  );
}
