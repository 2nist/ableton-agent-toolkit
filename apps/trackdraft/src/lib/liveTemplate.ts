/** The Live set template's track order — verified against
 *  `temp template Project/temp template.als` (the same source the
 *  apc-mk1-utility's `TEMPLATE_TRACK_NAMES` was checked against). The
 *  first four are the ones TrackDraft's MIDI out drives, one channel
 *  each: 1 `kit` (drums), 2 `crave` (bass), 3 `chord`, 4 `color`.
 *
 *  Keeping a copy here (rather than importing the apc-mk1-utility app's
 *  constant) lets the web app stay dependency-free of the hardware apps;
 *  if these lists drift, the single source of truth to reconcile against
 *  is the .als itself. */
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

export type TemplateTrackName = (typeof TEMPLATE_TRACK_NAMES)[number];

/** Template track at a given index (0-based), or undefined past the end. */
export function templateTrackName(index: number): TemplateTrackName | undefined {
  return TEMPLATE_TRACK_NAMES[index];
}
