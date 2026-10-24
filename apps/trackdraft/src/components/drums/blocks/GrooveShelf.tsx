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
  for (const voice of DRUM_LANE_VOICES[lane.key as keyof typeof DRUM_LANE_VOICES] ?? []) LANE_OF_VOICE.set(voice, li);
});

const COLS = 16;

interface Card {
  pattern: DrumPattern;
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
};

function buildCard(pattern: DrumPattern, beatsPerBar: number): Card | null {
  const variant = PRESET_DATA[pattern]?.variants?.[0];
  if (!variant || variant.notes.length === 0) return null;
  const grid = DRUM_LANES.map(() => new Array<number>(COLS).fill(0));
  for (const [beat, pitch, velocity] of variant.notes) {
    if (beat >= beatsPerBar) continue;
    const voice = voiceOf(pitch);
    const li = voice ? LANE_OF_VOICE.get(voice) : undefined;
    if (li === undefined) continue;
    const col = Math.max(0, Math.min(COLS - 1, Math.floor((beat / beatsPerBar) * COLS)));
    grid[li][col] = Math.max(grid[li][col], velocity);
  }
  const notes: DrumNote[] = variant.notes.map(([beat, pitch, velocity]) => ({ beat, pitch, velocity }));
  const feel = measureFeel(notes, Math.max(1, variant.lengthBeats / beatsPerBar), beatsPerBar);
  return { pattern, label: LABELS[pattern] ?? pattern, grid, feel };
}

/** Min/max per axis across the shelf — the lens compares normalised values,
 *  so "busy" means busy FOR THIS MENU, not an absolute count. */
function axisRange(cards: Card[]): Record<AxisKey, { min: number; max: number }> {
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
  onPick: (pattern: DrumPattern) => void;
}

export default function GrooveShelf(props: GrooveShelfProps) {
  const P = usePalette();
  const { span, section, current, onPick } = props;
  const [lens, setLens] = useState<Partial<Record<AxisKey, number>>>({});
  // The three tiers don't always fit the panel's height, so the shelf can
  // fold down to its name — the canvas gets the room instead.
  const [open, setOpen] = useState<boolean>(() => {
    try { return localStorage.getItem("trackdraft-drums-shelf-open") !== "0"; } catch { return true; }
  });
  const toggle = () => {
    setOpen((o) => {
      try { localStorage.setItem("trackdraft-drums-shelf-open", o ? "0" : "1"); } catch { /* ignore */ }
      return !o;
    });
  };

  const bpb = span ? beatsPerBarOf(span) : 4;

  const cards = useMemo(() => {
    const out: Card[] = [];
    for (const pattern of Object.keys(PRESET_DATA) as DrumPattern[]) {
      const card = buildCard(pattern, bpb);
      if (card) out.push(card);
    }
    return out;
  }, [bpb]);

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
        <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-inkMuted">groove shelf</span>
        <span className="font-mono text-2xs text-track uppercase">{current ?? "auto"}</span>
        <span className="flex-1" />
        <span className="font-mono text-2xs text-inkMuted/70">click to pick a groove by its shape</span>
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
        <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-inkMuted shrink-0 mt-1.5">feel lens</span>
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

      {/* the shelf */}
      <div className="flex gap-1.5 px-2 pb-2 overflow-x-auto">
        {ranked.map((card, i) => {
          const active = current === card.pattern;
          return (
            <button
              key={card.pattern}
              onClick={() => onPick(card.pattern)}
              title={`${card.label}${touched.length > 0 ? ` · match ${i + 1}/${ranked.length}` : ""}`}
              className="shrink-0 rounded-sm border px-1 pt-1 pb-0.5"
              style={{
                borderColor: active ? P.track : P.grid,
                background: active ? "rgba(232,181,74,0.10)" : "transparent",
              }}
            >
              <svg width={COLS * 4 + 2} height={DRUM_LANES.length * 4 + 2} aria-hidden>
                {card.grid.map((row, li) =>
                  row.map((velocity, q) => {
                    if (velocity <= 0) {
                      return (
                        <rect
                          key={`${li}-${q}`}
                          x={q * 4 + 1} y={li * 4 + 1} width={2.5} height={2}
                          fill={P.grid} opacity={0.25}
                        />
                      );
                    }
                    const h = 1 + (velocity / 127) * 2.6;
                    return (
                      <rect
                        key={`${li}-${q}`}
                        x={q * 4 + 1} y={li * 4 + 1 + (3.6 - h)}
                        width={2.5} height={h}
                        fill={laneColor(DRUM_LANES[li], P)}
                        opacity={0.95}
                      />
                    );
                  }),
                )}
              </svg>
              <span
                className="block truncate text-center font-mono uppercase"
                style={{ fontSize: 7, letterSpacing: "0.05em", color: active ? P.track : P.label, maxWidth: 66 }}
              >
                {card.label}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** One lens axis: name, a bipolar-looking track and the musical end-words. */
function LensSlider({ axis, value, onChange }: {
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
        <span className="font-mono" style={{ fontSize: 6.5, letterSpacing: "0.06em", color: engaged ? P.track : P.label, opacity: engaged ? 1 : 0.7 }}>
          {axis.label.toUpperCase()}
        </span>
        <div
          className="relative flex-1 rounded-sm cursor-ew-resize touch-none"
          style={{ height: 9, background: P.well, border: `1px solid ${P.grid}` }}
          onPointerDown={(e) => {
            if (e.button !== 0) return;
            e.stopPropagation();
            try { (e.currentTarget as Element).setPointerCapture(e.pointerId); } catch { /* fine */ }
            const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
            onChange(Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)));
          }}
          onPointerMove={(e) => {
            if (e.buttons !== 1) return;
            const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
            onChange(Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)));
          }}
        >
          <div
            className="absolute inset-y-0"
            style={{ left: `${frac * 100}%`, width: 3, marginLeft: -1.5, background: engaged ? P.track : P.grid }}
          />
        </div>
      </div>
      <div className="flex justify-between" style={{ fontSize: 6, lineHeight: "8px", color: P.label, opacity: hover || engaged ? 0.75 : 0 }}>
        <span>{axis.lo}</span>
        <span>{axis.hi}</span>
      </div>
    </div>
  );
}
