/**
 * Fitting a section's planned hits into its own span.
 *
 * Both drum exporters — the app's `.mid` stem and the Ableton bridge's clips —
 * map the same planned notes onto the same section, and they used to do it with
 * two copies of the same five lines. The copies drifted: the app clipped a hit to
 * the room left in its section and dropped one that landed exactly on the
 * boundary, the bridge did neither, and a closed hat on the last 16th rang into
 * the next section in Ableton while the `.mid` was cut. The parity test caught
 * it only after the app changed.
 *
 * A drum hit may not outlive the section it belongs to. That rule lives here, in
 * one place, so the two exports cannot disagree about it again.
 */

export interface PlannedHit {
  /** Section-relative beat. */
  beat: number;
  pitch: number;
  velocity: number;
  /** The hit's own gate, when something authored one. */
  duration?: number;
}

export interface FittedHit {
  /** Section-relative beat — the caller adds its own span offset. */
  beat: number;
  pitch: number;
  velocity: number;
  duration: number;
}

/**
 * Clip each hit to the room left in the section, and drop the ones that start on
 * the boundary.
 *
 * A hit exactly on the boundary belongs to the NEXT section, which plans its own
 * downbeat; keeping it (even at a token length) double-triggers the seam.
 */
export function fitHitsToSection(
  hits: readonly PlannedHit[],
  durationBeats: number,
  defaultDuration: number,
): FittedHit[] {
  const out: FittedHit[] = [];
  for (const hit of hits) {
    const room = durationBeats - hit.beat;
    if (room <= 1e-6) continue;
    out.push({
      beat: hit.beat,
      pitch: hit.pitch,
      velocity: hit.velocity,
      duration: Math.min(hit.duration ?? defaultDuration, room),
    });
  }
  return out;
}
