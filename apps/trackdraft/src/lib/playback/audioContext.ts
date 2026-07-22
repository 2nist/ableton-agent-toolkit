/**
 * One AudioContext for the whole page, shared by every audio-producing
 * module (`audioPreview.ts`'s chord sampler, `drumPreview.ts`'s
 * DrumMachine). Before this, each maintained its own lazily-created
 * `AudioContext` — harmless for either playing alone, but meant chords
 * and drums were scheduled against two independent clocks with no
 * guaranteed relationship between their `currentTime` origins. A whole
 * song playing both together (`songTransport.ts`) had no way to keep
 * them numerically in sync as a result. One shared context makes
 * "schedule this at ctx.currentTime + offset" mean the same real moment
 * for both.
 */
let sharedContext: AudioContext | null = null;

export function getSharedAudioContext(): AudioContext {
  if (!sharedContext) {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    sharedContext = new Ctor();
  }
  if (sharedContext.state === "suspended") void sharedContext.resume();
  return sharedContext;
}
