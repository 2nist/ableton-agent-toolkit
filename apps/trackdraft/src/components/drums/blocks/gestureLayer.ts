import { audibleLanes, DRUM_LANE_VOICES, voiceOf, type DrumLaneId } from "@drum/library";
import { planDrumStem } from "../../../lib/midiExport";
import { resolveSectionLaneHits } from "../../../lib/timeline/drumLaneHits";
import { resolveSectionVariant } from "../../../lib/playback/drumPreview";
import { sectionDurationBeats, type BlueprintSection, type BlueprintSong } from "../../../types/blueprint";
import type { SectionSpan } from "../../../lib/arrangement";
import { sectionMarkers } from "./transitionMarkers";
import { grooveOf } from "../../../lib/drums/grooveModel";

/**
 * Notes this close together are the same hit. The export planner applies the
 * corpus's seeded micro-variation (~1/32 beat) and the canvas deliberately
 * draws a plain tiling, so an exact beat-for-beat diff would call every
 * jittered note "replaced" — the first cut of this layer struck almost every
 * cell in a section with no gesture at all.
 */
const TOL = 0.08;

/**
 * GESTURE LAYER — what the export plays in a section versus what the canvas
 * draws, so a detour / transition / handoff fill stops being invisible.
 *
 * The two sides are not "extra" and "base": a detour REPLACES the groove. In
 * a 4-bar section with a sparse 1-bar detour the export plays 4 notes where
 * the canvas draws 24, so drawing the additions on top would claim 24 hits
 * are sounding. Hence two deltas:
 *
 *   ghosts     — planned − resolved: what will play that the grid can't show
 *   suppressed — resolved − planned: base hits the gesture takes over
 *
 * Both come from the SAME planners the export and the canvas already use
 * (`planDrumStem` / `resolveSectionLaneHits`), so this can't invent a rhythm
 * neither of them plays. Computing the plan costs ~6 ms per section, so the
 * result is cached on the section object — a drag writes nothing until
 * release, so it never recomputes mid-gesture.
 */

export interface GestureGhost {
  /** Section-relative beat. */
  beat: number;
  velocity: number;
  /** True inside an AUTHORED gesture window (solid), false for the planner's
   *  own gestures — an auto transition, a handoff fill, the post-fill crash
   *  (dashed). */
  authored: boolean;
}

export interface LaneGesture {
  ghosts: GestureGhost[];
  /** Step beats whose base hit the gesture replaces. */
  suppressed: number[];
}

export type GestureLayer = Map<DrumLaneId, LaneGesture>;

const LANE_OF_VOICE = new Map<string, DrumLaneId>();
for (const lane of Object.keys(DRUM_LANE_VOICES) as DrumLaneId[]) {
  for (const voice of DRUM_LANE_VOICES[lane]) LANE_OF_VOICE.set(voice, lane);
}

/**
 * Content-addressed cache, because the draft mutates the section the view is
 * already holding: an identity-keyed cache (WeakMap on the section) served the
 * PRE-edit `null` for the whole preview, so a freshly authored detour showed
 * its rail chip but nothing in the lanes. The key carries every field that can
 * change the window or the plan, so any edit — applied or previewed — misses.
 * `useMemo` in the view cannot cover this alone: `spans` is rebuilt per render.
 */
function signature(section: BlueprintSection, start: number): string {
  const groove = grooveOf(section);
  const grooveKey =
    groove.kind === "outline"
      ? `outline:${JSON.stringify(groove.outline)}`
      : groove.kind === "preset"
        ? `preset:${groove.pattern}:${groove.variant ?? ""}`
        : groove.kind;
  return [
    start,
    sectionDurationBeats(section),
    grooveKey,
    section.drumVariationStartBeat ?? "",
    section.drumVariationBars ?? "",
    section.drumVariationOutline ? JSON.stringify(section.drumVariationOutline) : "",
    section.drumTransitionModel ?? "",
    section.drumTransitionBars ?? "",
    (section.drumLaneMute ?? []).join(","),
    (section.drumLaneSolo ?? []).join(","),
  ].join("|");
}

const CACHE = new WeakMap<BlueprintSong, Map<string, GestureLayer | null>>();
const CACHE_MAX = 24;

export function gestureLayerFor(
  song: BlueprintSong,
  spans: SectionSpan[],
  anchor: SectionSpan,
): GestureLayer | null {
  let bySong = CACHE.get(song);
  if (!bySong) {
    bySong = new Map();
    CACHE.set(song, bySong);
  }
  const key = signature(anchor.section, anchor.startBeat);
  if (bySong.has(key)) return bySong.get(key) ?? null;

  const result = compute(song, spans, anchor);
  if (bySong.size >= CACHE_MAX) bySong.delete(bySong.keys().next().value as string);
  bySong.set(key, result);
  return result;
}

function compute(song: BlueprintSong, spans: SectionSpan[], anchor: SectionSpan): GestureLayer | null {
  const duration = sectionDurationBeats(anchor.section);
  const start = anchor.startBeat;
  const end = start + duration;

  // WHERE a gesture is: the same windows the marker rail draws (the authored
  // detour, the authored-or-planned transition). Outside them the plan is just
  // the base groove with the corpus's micro-variation, which the canvas
  // already draws plainly — not a gesture, and not this layer's business.
  const markers = sectionMarkers(
    spans.map((sp) => ({
      sectionId: sp.sectionId,
      occurrenceIndex: sp.occurrenceIndex,
      section: sp.section,
      durationBeats: sp.durationBeats,
      hasVariant: !!resolveSectionVariant(sp.section, song, sp.occurrenceIndex),
    })),
  )[spans.findIndex((sp) => sp.sectionId === anchor.sectionId && sp.occurrenceIndex === anchor.occurrenceIndex)];

  const windows: { startBeat: number; endBeat: number; authored: boolean }[] = [];
  if (markers?.detour) windows.push({ ...markers.detour, authored: true });
  if (markers?.transition) windows.push({ ...markers.transition, authored: markers.transition.manual });
  if (windows.length === 0) return null;

  const near = (beat: number, w: { startBeat: number; endBeat: number }) =>
    beat >= w.startBeat - TOL && beat < w.endBeat + TOL;
  const inWindow = (beat: number) => windows.some((w) => near(beat, w));
  const authoredAt = (beat: number) => windows.some((w) => w.authored && near(beat, w));

  // What will play, inside the windows.
  const planned = planDrumStem([...spans], song)
    .filter((n) => n.startTime >= start - 1e-9 && n.startTime < end - 1e-9)
    .map((n) => ({ beat: n.startTime - start, pitch: n.pitch, velocity: n.velocity, voice: voiceOf(n.pitch) }))
    .filter((n) => inWindow(n.beat));

  const plannedByLane = new Map<DrumLaneId, number[]>();
  for (const n of planned) {
    const lane = n.voice ? LANE_OF_VOICE.get(n.voice) : undefined;
    if (!lane) continue;
    const list = plannedByLane.get(lane) ?? [];
    list.push(n.beat);
    plannedByLane.set(lane, list);
  }

  // What the canvas draws, in the same windows.
  const resolved = resolveSectionLaneHits(anchor.section, song, anchor.occurrenceIndex);
  const matches = (list: number[] | undefined, beat: number) =>
    (list ?? []).some((b) => Math.abs(b - beat) <= TOL);

  // A silenced lane shows nothing to explain: the canvas already dims it, and
  // the planner drops its hits, so every cell would read as "taken over".
  const silent = new Set<DrumLaneId>();
  const play = audibleLanes(anchor.section.drumLaneMute, anchor.section.drumLaneSolo);
  for (const lane of Object.keys(DRUM_LANE_VOICES) as DrumLaneId[]) {
    if (!play.has(lane)) silent.add(lane);
  }

  const layer: GestureLayer = new Map();
  let changed = false;

  for (const [lane, hits] of resolved) {
    if (silent.has(lane)) continue;
    const suppressed = hits
      .filter((h) => inWindow(h.beat) && !matches(plannedByLane.get(lane), h.beat))
      .map((h) => h.beat);
    if (suppressed.length > 0) changed = true;
    layer.set(lane, { ghosts: [], suppressed });
  }

  const resolvedByLane = new Map<DrumLaneId, number[]>();
  for (const [lane, hits] of resolved) resolvedByLane.set(lane, hits.map((h) => h.beat));

  for (const n of planned) {
    const lane = n.voice ? LANE_OF_VOICE.get(n.voice) : undefined;
    if (!lane || silent.has(lane)) continue;
    if (matches(resolvedByLane.get(lane), n.beat)) continue;
    const entry = layer.get(lane) ?? { ghosts: [], suppressed: [] };
    entry.ghosts.push({ beat: n.beat, velocity: n.velocity, authored: authoredAt(n.beat) });
    layer.set(lane, entry);
    changed = true;
  }

  if (!changed) return null;
  for (const entry of layer.values()) entry.ghosts.sort((a, b) => a.beat - b.beat);
  return layer;
}
