import type { NarrativeProfile } from "../types/blueprint";
import type { BlueprintSong } from "../types/blueprint";
import type { MapSlot, SongMap } from "../data/songMaps";
import { resolveMapSlots, type ApplySongMapOptions } from "./sections";

/**
 * Putting an archetype's SHAPE onto a song that already exists.
 *
 * Applying a template is destructive by design — it replaces the sections.
 * That is the wrong tool once someone has written a song: they want the
 * dramatic shape of "Inverted Matrix" over the sections they already have.
 *
 * So the arc is sampled as a CONTINUOUS shape rather than copied slot-to-slot:
 * each template slot is a control point at its own normalized position in the
 * form, and a song with a different number of sections reads the same curve at
 * its own positions. When the counts do match, every reading lands exactly on
 * a control point, so the result is the authored arc — no resampling drift.
 */

const AXES = ["tension_profile", "rhythmic_energy", "transition_delta", "structural_warp"] as const;

/** Three decimals: the axes are 0–1 (or -1–1) sliders; more precision than
 *  that is float noise from the interpolation, not a musical quantity. */
function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function lerp(from: number, to: number, t: number): number {
  return from + (to - from) * t;
}

/**
 * Read `count` profiles off the arc the given slots describe.
 * Returns undefined for every position when the slots carry no arc at all.
 */
export function sampleNarrativeArc(
  slots: MapSlot[],
  count: number,
): (NarrativeProfile | undefined)[] {
  if (count <= 0) return [];

  // Control points: only the slots that actually authored an arc. A slot
  // without one is a gap in the curve, not a zero.
  const nodes = slots
    .map((slot, index) => ({ slot, index }))
    .filter(({ slot }) => slot.narrative)
    .map(({ slot, index }) => ({
      // position in the form, 0..1; a one-slot form sits at 0
      t: slots.length > 1 ? index / (slots.length - 1) : 0,
      profile: slot.narrative as NarrativeProfile,
    }));

  if (nodes.length === 0) return Array.from({ length: count }, () => undefined);
  if (nodes.length === 1) return Array.from({ length: count }, () => ({ ...nodes[0].profile }));

  return Array.from({ length: count }, (_, i) => {
    const t = count > 1 ? i / (count - 1) : 0;
    // exact hit on a control point — copy it verbatim so equal-length songs
    // get the authored numbers, not 0.6999999
    const exact = nodes.find((node) => Math.abs(node.t - t) < 1e-9);
    if (exact) return { ...exact.profile };

    const after = nodes.findIndex((node) => node.t > t);
    if (after === -1) return { ...nodes[nodes.length - 1].profile };
    const hi = nodes[after];
    const lo = nodes[after - 1];
    const span = hi.t - lo.t;
    const local = span > 0 ? (t - lo.t) / span : 0;

    const sampled = {} as NarrativeProfile;
    for (const axis of AXES) {
      sampled[axis] = round(lerp(lo.profile[axis], hi.profile[axis], local));
    }
    return sampled;
  });
}

/**
 * Re-shape an existing song's narrative to a template's arc — sections,
 * chords, meters and drums are untouched, so nothing authored is lost.
 *
 * The song-level master comes from the map's `defaults.narrative` when it has
 * one, and is otherwise left alone (a template with no master has no opinion
 * about the master).
 */
export function applyNarrativeArc(
  song: BlueprintSong,
  map: SongMap,
  options?: ApplySongMapOptions,
): BlueprintSong {
  const slots = resolveMapSlots(map, options);
  const sampled = sampleNarrativeArc(slots, song.sections.length);
  return {
    ...song,
    narrative: map.defaults?.narrative ?? song.narrative,
    sections: song.sections.map((section, i) => ({ ...section, narrative: sampled[i] })),
  };
}
