/**
 * Tempo → time, in one place.
 *
 * `60 / bpm` was written out in six modules — the transport, the live MIDI
 * scheduler, the MIDI clock, the melody recorder, the REAPER exporter and the
 * JCRD parser. They all agreed, which is exactly why nobody noticed; the sixth
 * one wouldn't have.
 *
 * Deliberately unclamped: this is the plain arithmetic the audio path was
 * already doing, so moving a call site here cannot change a single sample.
 * Callers that guard against a nonsense tempo clamp at their own boundary.
 */
export function secondsPerBeat(bpm: number): number {
  return 60 / bpm;
}
