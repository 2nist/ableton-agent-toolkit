/**
 * The material graph (§P2.1) — the couplings a section ALREADY has, made visible.
 *
 * The polymorphic brief asked the question the canvas could not answer: *"if a
 * chord progression card is dragged next to a different drum pattern, how do
 * they influence each other?"* The answer was already in the blueprint — this
 * module only stops hiding it:
 *
 * - `chords` derive the bass and the colour voice, unless the section carries its
 *   own `bassNotes`, in which case the chord stream takes a back seat.
 * - `grooveGlue` makes the DRUMS re-time the bass and the comping. That is a
 *   genuine cross-material influence that has been shipping for phases and has
 *   never been drawn anywhere.
 * - `harmonyFollowsDrums` lets the drums' meter drive when the chords change.
 * - `timeDomain` (the clock) re-times the material that carries its own time.
 *
 * Everything here is a READ. There is no new field, no new semantics, and no way
 * for this module to change a song — which is the point: a graph that turns out
 * to look like noise costs a render, not a migration.
 */

import type { PolyLaneId } from "./layout";

/** The kinds of material a section node can carry. */
export type MaterialId =
  "chords" | "bass" | "colour" | "drums" | "melody" | "lyrics" | "clock";

/** How one material reaches another. */
export type MaterialEdgeKind =
  /** The target is computed FROM the source (chords → bass, chords → colour). */
  | "derives"
  /** The target has its own notes; the source only anchors key/register. */
  | "authored"
  /** The drums impose their measured feel on the target (§grooveGlue). */
  | "glues"
  /** The drums' meter decides WHEN the target changes. */
  | "drives"
  /** The clock re-times the target. */
  | "conducts";

export interface MaterialEdge {
  from: MaterialId;
  to: MaterialId;
  kind: MaterialEdgeKind;
  /** Why the edge exists, in the section's own terms. This is the tooltip, and
   *  the thing that makes the graph falsifiable: an edge with no reason visible
   *  in the data is a bug in this module, not a mystery in the song. */
  reason: string;
}

export interface MaterialGraph {
  /** The material this section actually carries, in lane order. */
  present: MaterialId[];
  edges: MaterialEdge[];
}

/** The lane a material id draws on — `clock` has no lane of its own. Typed as
 *  the layout's own ids so a rename in either place fails to compile. */
export const MATERIAL_LANE: Partial<Record<MaterialId, PolyLaneId>> = {
  chords: "chords",
  bass: "bass",
  colour: "color",
  drums: "drums",
  melody: "melody",
  lyrics: "lyric",
};

export interface MaterialOptions {
  /** Whether the section has any drums to show. The canvas already knows (its
   *  drum rows come from the same resolver), and deriving it here would mean
   *  re-running the planner inside a pure projection. */
  hasDrums?: boolean;
}

const LABEL: Record<MaterialId, string> = {
  chords: "Chords",
  bass: "Bass",
  colour: "Colour",
  drums: "Drums",
  melody: "Melody",
  lyrics: "Lyrics",
  clock: "Clock",
};

/** A material's name, for a tooltip or a chip. */
export function materialLabel(id: MaterialId): string {
  return LABEL[id];
}

type SectionLike = {
  chords?: readonly unknown[];
  bassNotes?: readonly unknown[];
  melody?: { notes?: readonly unknown[] };
  lyrics?: string;
  lyricsTimeline?: readonly unknown[];
  drumPattern?: unknown;
  drumVariantIndex?: unknown;
  drumMeterOutline?: unknown;
  drumBlocks?: readonly unknown[];
  drumVoicePatterns?: Record<string, unknown>;
  grooveGlue?: { bass?: boolean; chords?: boolean };
  harmonyFollowsDrums?: boolean;
  timeDomain?: unknown;
};

/** True when the section has any authored or chosen drum material at all. */
function declaresDrums(section: SectionLike): boolean {
  return Boolean(
    section.drumPattern ||
    section.drumVariantIndex !== undefined ||
    section.drumMeterOutline ||
    (section.drumBlocks?.length ?? 0) > 0 ||
    Object.keys(section.drumVoicePatterns ?? {}).length > 0,
  );
}

/**
 * What this section is made of, and what feeds what.
 *
 * Order is lane order, so a caller can draw the nodes without sorting, and the
 * clock comes last because it is not a lane — it is a modifier over the others.
 */
export function sectionMaterial(
  section: SectionLike,
  options: MaterialOptions = {},
): MaterialGraph {
  const present: MaterialId[] = [];
  const edges: MaterialEdge[] = [];

  const hasChords = (section.chords?.length ?? 0) > 0;
  const hasAuthoredBass = (section.bassNotes?.length ?? 0) > 0;
  const hasMelody = (section.melody?.notes?.length ?? 0) > 0;
  const hasLyrics =
    Boolean(section.lyrics?.trim()) ||
    (section.lyricsTimeline?.length ?? 0) > 0;
  const hasDrums = options.hasDrums ?? declaresDrums(section);
  const clocked =
    section.timeDomain !== undefined && section.timeDomain !== null;

  if (hasChords) present.push("chords");
  // A bass with no chords and no notes is not a lane, it is a silence: there is
  // nothing to derive it from. Found by reading a real chordless intro, which
  // the first version of this module confidently reported as bass-bearing.
  if (hasChords || hasAuthoredBass) present.push("bass");
  // The colour voice is always derivable from the chords — its flavour has a
  // default, so there is no "no colour" case to detect.
  if (hasChords) present.push("colour");
  if (hasDrums) present.push("drums");
  if (hasMelody) present.push("melody");
  if (hasLyrics) present.push("lyrics");
  if (clocked) present.push("clock");

  if (hasChords) {
    edges.push({
      from: "chords",
      to: "bass",
      kind: hasAuthoredBass ? "authored" : "derives",
      reason: hasAuthoredBass
        ? "the authored bass line replaces the generated one; the chords only anchor key and register"
        : "the bass line is generated from this chord stream",
    });
    edges.push({
      from: "chords",
      to: "colour",
      kind: "derives",
      reason: "the colour voice is voiced from this chord stream",
    });
  }

  if (hasDrums && hasChords) {
    if (section.harmonyFollowsDrums) {
      edges.push({
        from: "drums",
        to: "chords",
        kind: "drives",
        reason:
          "harmony follows the drums' meter, so the chord changes land on its grid",
      });
    }
    if (section.grooveGlue?.chords) {
      edges.push({
        from: "drums",
        to: "chords",
        kind: "glues",
        reason: "groove glue — the comping sits in the drums' pocket",
      });
    }
  }

  if (hasDrums) {
    if (section.grooveGlue?.bass) {
      edges.push({
        from: "drums",
        to: "bass",
        kind: "glues",
        reason: "groove glue — the bass sits in the drums' pocket",
      });
    }
  }

  if (clocked) {
    // §P3.5: the clock conducts material that carries its own time. Derived
    // material (bass from chords, colour from chords) follows the CONDUCTED
    // chord stream instead, which is why it is not an edge from the clock.
    if (hasDrums) {
      edges.push({
        from: "clock",
        to: "drums",
        kind: "conducts",
        reason: "the section's clock re-times the drum pattern",
      });
    }
    if (hasMelody) {
      edges.push({
        from: "clock",
        to: "melody",
        kind: "conducts",
        reason: "the section's clock re-times the melody",
      });
    }
    if (hasAuthoredBass) {
      edges.push({
        from: "clock",
        to: "bass",
        kind: "conducts",
        reason: "the section's clock re-times the authored bass",
      });
    }
  }

  return { present, edges };
}

/** One wire, in world coordinates: the geometry is the caller's, the mapping is
 *  this module's. */
export interface MaterialCable {
  from: MaterialId;
  to: MaterialId;
  kind: MaterialEdgeKind;
  /** The gutter x the cable runs down (world units). */
  x: number;
  /** Source lane centre, world y. */
  y1: number;
  /** Target lane centre, world y. */
  y2: number;
  reason: string;
}

/** The lane rectangles a cable needs — `y` and `h` in world units. */
export type LaneRects = ReadonlyMap<string, { y: number; h: number }>;

/**
 * The graph as drawable cables.
 *
 * Kept out of the component because this is the part that can be WRONG in a way
 * nobody notices: an edge whose lane is missing, a lane id that drifted, a cable
 * drawn to the wrong row. Here it is a list a test can compare.
 */
export function materialCables(
  graph: MaterialGraph,
  lanes: LaneRects,
  gutterX: number,
): MaterialCable[] {
  const cables: MaterialCable[] = [];
  for (const edge of wireEdges(graph)) {
    const from = MATERIAL_LANE[edge.from];
    const to = MATERIAL_LANE[edge.to];
    if (!from || !to) continue;
    const a = lanes.get(from);
    const b = lanes.get(to);
    if (!a || !b) continue;
    cables.push({
      from: edge.from,
      to: edge.to,
      kind: edge.kind,
      x: gutterX,
      y1: a.y + a.h / 2,
      y2: b.y + b.h / 2,
      reason: edge.reason,
    });
  }
  return cables;
}

/** The edges that can be drawn as a wire between two lanes. */
export function wireEdges(graph: MaterialGraph): MaterialEdge[] {
  return graph.edges.filter(
    (edge) => MATERIAL_LANE[edge.from] && MATERIAL_LANE[edge.to],
  );
}

/** One line describing what feeds a material, for a hover or a chip. Absent
 *  when nothing feeds it — a root. */
export function feedsText(graph: MaterialGraph, id: MaterialId): string | null {
  const incoming = graph.edges.filter((edge) => edge.to === id);
  if (incoming.length === 0) return null;
  return incoming
    .map((edge) => `${materialLabel(edge.from)} → ${edge.kind}`)
    .join(" · ");
}
