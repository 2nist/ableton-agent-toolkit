/**
 * The MIDI wire format, in one place.
 *
 * MIDI bytes have hard ranges — pitch 0–127, velocity 1–127, channel 0–15 on
 * the wire (1–16 in the app's own model). Every sender used to do this inline
 * and they disagreed: the file export and the live stream **clamped**, while
 * the audition paths and the port self-test **masked** with `& 0x7f`. So a
 * voicing whose top note reached 130 auditioned as note **2** and exported as
 * note **127** — the same chord, two different notes, depending on whether you
 * were listening or looking at the file.
 *
 * Masking is never right for a value that is out of range by accident: `-1`
 * becomes 127 and `128` becomes 0, both of which are valid notes, so a bug
 * arrives as music rather than as an error. Clamp instead, in one place, and
 * let the tests point at a single implementation.
 */

/** MIDI note number on the wire: 0–127, rounded. Anything non-finite is 0. */
export function pitchToWire(pitch: number): number {
  if (!Number.isFinite(pitch)) return 0;
  return Math.max(0, Math.min(127, Math.round(pitch)));
}

/** MIDI velocity on the wire: 1–127, rounded. 0 would be a note-off, so the
 *  floor is 1 — a note asked to sound silently still sounds, which is what
 *  every caller here means by "velocity". */
export function velocityToWire(velocity: number): number {
  if (!Number.isFinite(velocity)) return 1;
  return Math.max(1, Math.min(127, Math.round(velocity)));
}

/** The app's **1-based** channel → the wire's 0-based nibble (0–15).
 *
 *  Use this where the value comes from the routing map or a UI field, i.e.
 *  anywhere the app says "channel 10". Passing an already-0-based index here
 *  silently shifts every note down a channel — the two spaces are named apart
 *  (`channelToIndex` vs `clampChannelIndex`) so that mistake reads wrong at
 *  the call site. */
export function channelToIndex(channel: number): number {
  if (!Number.isFinite(channel)) return 0;
  return Math.max(0, Math.min(15, Math.round(channel) - 1));
}

/** Clamp a value that is ALREADY a 0-based wire channel (0–15). */
export function clampChannelIndex(index: number): number {
  if (!Number.isFinite(index)) return 0;
  return Math.max(0, Math.min(15, Math.round(index)));
}
