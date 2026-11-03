import type { NoteName, ScaleType } from "@music-theory/core";
import type { PolyRect } from "./camera";
import type { SectionSpan } from "../arrangement";
import type { SectionRole } from "../../types/blueprint";

/**
 * Arrange-mode geometry: the time plane projected into world space.
 *
 * The arrangement is a HORIZONTAL SPINE across the middle of the world, and
 * each element is a lane stacked away from it — melody, colour and chords
 * below, drums, bass and lyric above — so a section is a vertical band that
 * crosses every lane, and the ear reads outward from the beat.
 *
 * ```
 *   lyric   ───────────────
 *   bass    ───────────────
 *   drums   ───────────────
 *  ═════════ TIME SPINE ═════════
 *   chords  ───────────────
 *   color   ───────────────
 *   melody  ───────────────
 * ```
 *
 * This module is the whole of the layout: a pure function from
 * `sectionSpans()` to rectangles, deliberately the seed of the future
 * `conduct()`. Width encodes DURATION (a 16-bar chorus is visibly twice an
 * 8-bar verse); position encodes order. Nothing here is authored.
 */

/** World units per bar. */
export const POLY_BAR_W = 96;
/** A 1-bar section still has to be clickable. */
export const POLY_MIN_COL_W = 176;
export const POLY_COL_GAP = 22;

/** Width of the frozen lane gutter over the canvas's left edge. Programmatic
 *  camera moves keep content clear of it, or the first bar of a song hides
 *  under the scrim at the standard zoom. */
export const POLY_GUTTER_W = 56;

/** Height of the identity band sitting ON the spine — the only part of a
 *  column that carries text at every zoom. */
export const POLY_SPINE_H = 40;

export type PolyLaneId =
  "lyric" | "bass" | "drums" | "chords" | "color" | "melody";

export interface PolyLaneSpec {
  id: PolyLaneId;
  label: string;
  side: "above" | "below";
  /** 1 = nearest the spine. */
  offset: number;
  /** Lane height in world units. */
  height: number;
}

/** The lane order is a musical statement, not a layout accident: what you
 *  hear as a floor (melody furthest below, lyric furthest above) frames the
 *  beat, which sits on the spine with the harmony and the groove. */
export const POLY_LANES: readonly PolyLaneSpec[] = [
  { id: "lyric", label: "Lyric", side: "above", offset: 3, height: 114 },
  { id: "bass", label: "Bass", side: "above", offset: 2, height: 130 },
  { id: "drums", label: "Drums", side: "above", offset: 1, height: 120 },
  { id: "chords", label: "Chords", side: "below", offset: 1, height: 124 },
  { id: "color", label: "Color", side: "below", offset: 2, height: 76 },
  { id: "melody", label: "Melody", side: "below", offset: 3, height: 146 },
];

export interface PolyLaneRect {
  id: PolyLaneId;
  y: number;
  h: number;
}

/**
 * Which lane sits where — the one part of the layout the user owns.
 *
 * Order is remembered **within each side**, never across the spine. That is a
 * real constraint, not a limitation of the UI: the lanes above sum to the same
 * units in any order (and so do the lanes below), so within-side order cannot
 * move `POLY_TOP`, `POLY_HEIGHT` or the shelf. Crossing the spine would change
 * all three, and with them every placement already saved.
 */
export interface PolyLaneOrder {
  /** Offset 1 (nearest the spine) first. */
  above: PolyLaneId[];
  /** Offset 1 (nearest the spine) first. */
  below: PolyLaneId[];
}

/** The default reading order, and the one the canvas was designed around:
 *  what you hear as a floor (melody furthest below, lyric furthest above)
 *  frames the beat, which sits on the spine with harmony and groove. */
export const DEFAULT_LANE_ORDER: PolyLaneOrder = {
  above: ["drums", "bass", "lyric"],
  below: ["chords", "color", "melody"],
};

const LANE_SPEC_BY_ID: ReadonlyMap<PolyLaneId, PolyLaneSpec> = new Map(
  POLY_LANES.map((lane) => [lane.id, lane]),
);

/** The lanes that belong on a side, nearest the spine first. */
export function lanesOnSide(side: "above" | "below"): PolyLaneId[] {
  return [...POLY_LANES]
    .filter((lane) => lane.side === side)
    .sort((a, b) => a.offset - b.offset)
    .map((lane) => lane.id);
}

/**
 * Every value that reaches `laneGeometry` comes through here: unknown ids are
 * dropped, duplicates keep their first position, a lane listed on the wrong
 * side is ignored, and anything missing is appended in its default place. A
 * stored order can therefore be junk and still produce a total order.
 */
export function normaliseLaneOrder(raw: unknown): PolyLaneOrder {
  const read = (value: unknown, side: "above" | "below"): PolyLaneId[] => {
    const own = lanesOnSide(side);
    const out: PolyLaneId[] = [];
    if (Array.isArray(value)) {
      for (const entry of value) {
        if (typeof entry !== "string") continue;
        if (!own.includes(entry as PolyLaneId)) continue;
        if (out.includes(entry as PolyLaneId)) continue;
        out.push(entry as PolyLaneId);
      }
    }
    for (const id of own) if (!out.includes(id)) out.push(id);
    return out;
  };
  const order = (raw ?? {}) as Partial<PolyLaneOrder>;
  return {
    above: read(order.above, "above"),
    below: read(order.below, "below"),
  };
}

export interface PolyLaneGeometry {
  rects: PolyLaneRect[];
  byId: ReadonlyMap<PolyLaneId, PolyLaneRect>;
}

/**
 * Lane positions in world space for a given order, spine at y = 0.
 *
 * The heights come from the lane, not from its position, so permuting a side
 * permutes the offsets and nothing else.
 */
export function laneGeometry(
  order: PolyLaneOrder = DEFAULT_LANE_ORDER,
): PolyLaneGeometry {
  const normal = normaliseLaneOrder(order);
  const rects: PolyLaneRect[] = [];
  const half = POLY_SPINE_H / 2;

  let cursor = half;
  for (const id of normal.above) {
    const height = LANE_SPEC_BY_ID.get(id)?.height ?? 0;
    rects.push({ id, y: -(cursor + height), h: height });
    cursor += height;
  }
  cursor = half;
  for (const id of normal.below) {
    const height = LANE_SPEC_BY_ID.get(id)?.height ?? 0;
    rects.push({ id, y: cursor, h: height });
    cursor += height;
  }

  return {
    rects,
    byId: new Map(rects.map((rect) => [rect.id, rect])),
  };
}

/** Lane positions in world space for the DEFAULT order, spine at y = 0. */
export const POLY_LANE_RECTS: readonly PolyLaneRect[] =
  laneGeometry(DEFAULT_LANE_ORDER).rects;

export const POLY_LANE_BY_ID: ReadonlyMap<PolyLaneId, PolyLaneRect> =
  laneGeometry(DEFAULT_LANE_ORDER).byId;

/** The world's vertical extent: every lane, plus the spine band. */
export const POLY_TOP = Math.min(...POLY_LANE_RECTS.map((rect) => rect.y));
export const POLY_BOTTOM = Math.max(
  ...POLY_LANE_RECTS.map((rect) => rect.y + rect.h),
);
export const POLY_HEIGHT = POLY_BOTTOM - POLY_TOP;

/**
 * The offset the world-space shelf used to sit at.
 *
 * §0.12 reserved a band of canvas below the lanes and parked columns in it;
 * §0.16 made the shelf *chrome* instead, so nothing lives there any more. A
 * saved stage from before that change is migrated on read: any placement at or
 * beyond this offset was a shelf placement, and becomes "parked" (§`polyStore`).
 */
export const LEGACY_SHELF_DY = POLY_HEIGHT + 64;

/**
 * Room below the lanes for a section to be set aside *within* the canvas.
 *
 * Not a shelf: this is the space a lift needs so that "move it out of the way"
 * is a gesture rather than a menu, and it is a couple of lane-heights, not a
 * second canvas. Anything that should leave the arrangement entirely goes to
 * the docked shelf (§0.16), which is chrome and costs the world nothing.
 */
export const PLACEMENT_ROOM = 240;

/**
 * The canvas is a DOCUMENT, not a plane: its extent is the song.
 *
 * Width comes from `arrangeSections`, so adding a section or a repeat is the
 * only thing that lengthens the canvas; height is the lane stack alone, because
 * the shelf is no longer a place in the world — parked sections live in a docked
 * strip and are not drawn on the canvas at all (§0.16).
 */
export function worldBounds(layout: { bounds: PolyRect }): PolyRect {
  return {
    x: layout.bounds.x,
    y: POLY_TOP,
    w: layout.bounds.w,
    h: POLY_HEIGHT + PLACEMENT_ROOM,
  };
}

/**
 * Lane content is authored in screen pixels (`u = 1/zoom`), so on its own it
 * would keep the same size no matter how tall a row got — taller rows would be
 * pure padding. This lets it grow into the space, and stops.
 *
 * The rule is monotone in zoom, which matters: below the standard view content
 * eases back to its base size so that zooming out DROPS content (the LOD
 * ladder) instead of shrinking it into mush, and crossing any threshold is a
 * small change rather than a jump.
 */
export const CONTENT_BASE_PX = 280;
export const CONTENT_SCALE_MAX = 1.35;

export function polyContentScale(columnScreenH: number): number {
  if (!Number.isFinite(columnScreenH) || columnScreenH <= 0) return 1;
  return Math.min(
    CONTENT_SCALE_MAX,
    Math.max(1, columnScreenH / CONTENT_BASE_PX),
  );
}

export interface PolyNodeFacts {
  chords: number;
  drums: boolean;
  melody: boolean;
  lyrics: boolean;
  meter: string;
}

export interface PolyNode {
  /** Stable across reorders and edits — `sectionId` alone is not unique
   *  because a repeated section plays several times. */
  key: string;
  sectionId: string;
  occurrenceIndex: number;
  name: string;
  role: SectionRole;
  /** 1-based position in the play order ("the third thing you hear"). */
  ordinal: number;
  startBeat: number;
  durationBeats: number;
  startBar: number;
  bars: number;
  /** The column: one section's full height, spine included. */
  x: number;
  y: number;
  w: number;
  h: number;
  facts: PolyNodeFacts;
  /** Present only when a tempo was supplied. */
  startSeconds?: number;
  /** Which key this section is read in, and whether that is the song's own.
   *  Absent when no song key was supplied. */
  tonality?: PolyTonality;
}

/** The home a section is read in. A section may override the song's key or
 *  mode, and it may modulate inside itself — both are invisible in the
 *  numerals, which are resolved against these. */
export interface PolyTonality {
  key: NoteName;
  scale: ScaleType;
  /** The section overrides the song's key or scale. */
  own: boolean;
  /** Mid-section key changes (runs that start after the first beat). */
  modulations: number;
}

export interface PolyLayout {
  nodes: PolyNode[];
  bounds: { x: number; y: number; w: number; h: number };
  totalBars: number;
  /** Bar lines, per column (columns have gaps, so this is not one ruler). */
  barTicks: { bar: number; x: number }[];
  /** World x of a beat position, clamped to the arrangement's ends. */
  beatToX: (beat: number) => number;
}

export interface ArrangeOptions {
  barWidth?: number;
  minColumnWidth?: number;
  gap?: number;
  /** Song tempo, for the `m:ss` label on each node. */
  bpm?: number;
  /** The song's key and mode — what a section falls back to when it has no
   *  override of its own. Omit and no node carries a tonality. */
  key?: NoteName;
  scale?: ScaleType;
}

export function meterLabel(span: Pick<SectionSpan, "section">): string {
  const { timeSignatureNumerator: num, timeSignatureDenPower: den } =
    span.section;
  return `${num}/${2 ** den}`;
}

function factsFor(span: SectionSpan): PolyNodeFacts {
  const section = span.section;
  return {
    chords: section.chords.length,
    drums: (section.drumBlocks?.length ?? 0) > 0 || section.drumPattern != null,
    melody: (section.melody?.notes?.length ?? 0) > 0,
    lyrics: Boolean(section.lyrics?.trim()),
    meter: meterLabel(span),
  };
}

export function arrangeSections(
  spans: readonly SectionSpan[],
  options: ArrangeOptions = {},
): PolyLayout {
  const barWidth = options.barWidth ?? POLY_BAR_W;
  const minColumnWidth = options.minColumnWidth ?? POLY_MIN_COL_W;
  const gap = options.gap ?? POLY_COL_GAP;
  const bpm = options.bpm;
  const songKey = options.key;
  const songScale = options.scale;

  const nodes: PolyNode[] = [];
  const barTicks: { bar: number; x: number }[] = [];
  let cursor = 0;

  spans.forEach((span, index) => {
    const bars = Math.max(0, span.bars);
    const w = Math.max(minColumnWidth, bars * barWidth);
    const node: PolyNode = {
      key: `${span.sectionId}#${span.occurrenceIndex}`,
      sectionId: span.sectionId,
      occurrenceIndex: span.occurrenceIndex,
      name: span.section.name,
      role: span.section.role,
      ordinal: index + 1,
      startBeat: span.startBeat,
      durationBeats: span.durationBeats,
      startBar: span.startBar,
      bars,
      x: cursor,
      y: POLY_TOP,
      w,
      h: POLY_HEIGHT,
      facts: factsFor(span),
    };
    if (bpm && bpm > 0) node.startSeconds = (span.startBeat / bpm) * 60;
    if (songKey && songScale) {
      const key = (span.section.key ?? songKey) as NoteName;
      const scale = (span.section.scale ?? songScale) as ScaleType;
      node.tonality = {
        key,
        scale,
        own: key !== songKey || scale !== songScale,
        modulations: (span.section.tonicRegions ?? []).filter(
          (region) => region.startBeat > 0,
        ).length,
      };
    }
    nodes.push(node);

    const wholeBars = Math.floor(bars);
    for (let bar = 0; bar < wholeBars; bar += 1) {
      barTicks.push({ bar: span.startBar + bar, x: cursor + (bar / bars) * w });
    }

    cursor += w + gap;
  });

  const width = nodes.length > 0 ? cursor - gap : 0;
  const last = nodes[nodes.length - 1];
  const totalBars = last ? last.startBar + last.bars : 0;

  return {
    nodes,
    bounds: { x: 0, y: POLY_TOP, w: width, h: POLY_HEIGHT },
    totalBars,
    barTicks,
    beatToX: (beat: number) => beatToX(nodes, beat),
  };
}

/** Where a beat lands. Gaps between columns have no beat of their own, so a
 *  beat that falls in one resolves to the end of the column it left. */
export function beatToX(nodes: readonly PolyNode[], beat: number): number {
  if (nodes.length === 0) return 0;
  const first = nodes[0];
  const last = nodes[nodes.length - 1];
  if (beat <= first.startBeat) return first.x;
  const lastEnd = last.startBeat + last.durationBeats;
  if (beat >= lastEnd) return last.x + last.w;

  for (const node of nodes) {
    const end = node.startBeat + node.durationBeats;
    if (beat < node.startBeat) return node.x;
    if (beat < end) {
      const fraction =
        node.durationBeats > 0
          ? (beat - node.startBeat) / node.durationBeats
          : 0;
      return node.x + fraction * node.w;
    }
  }
  return last.x + last.w;
}

/** The node sounding at `beat`, or null outside every span. Mirrors
 *  `spanIndexForTick` but by beat, which is what the canvas has. */
export function nodeAtBeat(
  nodes: readonly PolyNode[],
  beat: number,
): PolyNode | null {
  for (const node of nodes) {
    if (beat >= node.startBeat && beat < node.startBeat + node.durationBeats)
      return node;
  }
  return null;
}

/** Bar count from a horizontal drag on a column's right edge. Snapped to
 *  whole bars, clamped so a section can never vanish or run away. */
export function resizeToBars(
  startBars: number,
  deltaPixels: number,
  zoom: number,
  options: { barWidth?: number; min?: number; max?: number } = {},
): number {
  const barWidth = options.barWidth ?? POLY_BAR_W;
  const min = options.min ?? 1;
  const max = options.max ?? 128;
  if (!Number.isFinite(deltaPixels) || zoom <= 0)
    return Math.max(min, Math.min(max, Math.round(startBars)));
  const delta = Math.round(deltaPixels / zoom / barWidth);
  return Math.max(min, Math.min(max, Math.round(startBars) + delta));
}

/**
 * Only the sections near the window are mounted. A forty-section song is a
 * forty-column DOM if you let it be, and every one of those columns re-derives
 * its chords and drum grid on each edit — so the renderer's first job is to
 * decide what NOT to draw.
 *
 * `marginPx` is screen pixels (not world units): the point of the margin is
 * that a column just off-screen must already be mounted when you pan to it.
 */
export function nodesInView(
  nodes: readonly PolyNode[],
  visible: PolyRect,
  zoom: number,
  marginPx = 240,
): PolyNode[] {
  const margin = marginPx / Math.max(zoom, 0.0001);
  const padded = {
    x: visible.x - margin,
    y: visible.y - margin,
    w: visible.w + margin * 2,
    h: visible.h + margin * 2,
  };
  return nodes.filter(
    (node) =>
      node.x < padded.x + padded.w &&
      node.x + node.w > padded.x &&
      node.y < padded.y + padded.h &&
      node.y + node.h > padded.y,
  );
}
