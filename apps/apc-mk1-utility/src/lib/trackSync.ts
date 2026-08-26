/**
 * Track selection + Arrangement sync — the piece that closes the "how do I
 * see what I'm controlling" loop without building any separate display.
 * Confirmed against AbletonOSC's real source this session:
 *
 *   - `/live/view/set/selected_track [track]` — fire-and-forget (no reply),
 *     `abletonosc/view.py`. Shared between Session and Arrangement; Live
 *     has one selected-track concept, so this highlights the track
 *     regardless of which view is open.
 *   - `/live/track/get/arrangement_clips/start_time [track]` — HAS a reply,
 *     `abletonosc/track.py`. Start times (in beats) of every arrangement
 *     clip on that track, in order.
 *   - `/live/song/set/current_song_time [beats]` — fire-and-forget,
 *     `abletonosc/song.py`. Moves the Arrangement playhead.
 *
 * There is no dedicated "scroll Arrangement to this clip" call in
 * AbletonOSC. Moving the playhead via `current_song_time` only visually
 * scrolls the Arrangement view if Live's "Follow" playhead-follow toggle is
 * on — that's Live's own behavior, not something this app controls. Worth
 * stating plainly rather than overclaiming automatic scrolling.
 *
 * v1 clip-selection rule: jump to the FIRST arrangement clip on the track
 * (index 0). Simple, predictable, documented — refine later (e.g. "nearest
 * the current playhead") if a track ends up with multiple relevant clips.
 */
import type { OscBridgeClient } from "./osc";

/**
 * The template's fixed track order, 1:1 with `song.tracks` index — verified
 * directly against `temp template Project/temp template.als`. Used only for
 * readable logging; selection itself works by index regardless of name.
 */
export const TEMPLATE_TRACK_NAMES = [
  "kit",
  "crave",
  "chord",
  "color",
  "melody",
  "piano",
  "import",
  "sample pad",
] as const;

export function templateTrackName(trackIndex: number): string {
  return TEMPLATE_TRACK_NAMES[trackIndex] ?? `track ${trackIndex}`;
}

/**
 * Select a track and, if it has an Arrangement clip, move the playhead to
 * its start. Selecting the track always happens; failing to find/reach an
 * arrangement clip is a soft failure (logged by the caller), not fatal —
 * plenty of tracks (piano, import) have none by design.
 */
export async function selectTrack(osc: OscBridgeClient, trackIndex: number): Promise<void> {
  osc.send("/live/view/set/selected_track", [trackIndex]);

  const startTimes = await osc.request("/live/track/get/arrangement_clips/start_time", [trackIndex]);
  const firstStart = startTimes.find((v): v is number => typeof v === "number");
  if (firstStart !== undefined) {
    osc.send("/live/song/set/current_song_time", [firstStart]);
  }
}
