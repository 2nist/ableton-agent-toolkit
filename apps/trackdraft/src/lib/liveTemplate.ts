/** The Live set template's track order — verified against
 *  `temp template Project/temp template.als` (the same source the
 *  apc-mk1-utility's own copy was checked against).
 *
 *  This is a *preset*, not the app's stem vocabulary: TrackDraft is
 *  DAW-agnostic now (see `lib/stems.ts` for the generic labels and routing
 *  profiles), and only the Live target and the Live setup guide need to know
 *  the template's actual track names. Keeping the list here — rather than
 *  importing the apc-mk1-utility app's constant — lets the web app stay
 *  dependency-free of the hardware apps; if these lists drift, the single
 *  source of truth to reconcile against is the .als itself.
 *
 *  The first five are the ones TrackDraft's MIDI out drives, one channel
 *  each: 1 `kit` (drums), 2 `crave` (bass), 3 `chord`, 4 `color`,
 *  5 `melody`. */
export const LIVE_TEMPLATE_TRACK_NAMES = [
  "kit",
  "crave",
  "chord",
  "color",
  "melody",
  "piano",
  "import",
  "sample pad",
] as const;

export type LiveTemplateTrackName = (typeof LIVE_TEMPLATE_TRACK_NAMES)[number];

/** Template track at a given index (0-based), or undefined past the end. */
export function liveTemplateTrackName(index: number): LiveTemplateTrackName | undefined {
  return LIVE_TEMPLATE_TRACK_NAMES[index];
}
