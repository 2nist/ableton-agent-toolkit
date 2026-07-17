# @groove/capture

Ported verbatim from `/Users/Matthew/unified-music-platform/packages/groove-capture` (source: BirdBird Global Sampler + DMGE 600-bar ring buffer patterns). Zero runtime dependencies, pure TS.

A time-windowed ring buffer for MIDI events plus a `CaptureEngine` that wraps it with trigger logic ("give me the last 4 bars", "everything since this marker"), for retroactive/backwards-looking capture rather than pre-arming a fixed-length recording.

## Recording is gated by `startRecording()`/`stopRecording()`

`CaptureEngine.recordEvent()`/`recordBatch()` are no-ops until `startRecording()` has been called — events sent before that are silently dropped, not queued. Caught by `test/groove-capture.test.ts`.

## Trim uses a binary search over an assumed-sorted event array

`MidiRingBuffer.trim()` assumes `events` is time-ordered and binary-searches for the eviction cutoff. Recording events out of temporal order (e.g. two sources merged without sorting) will make eviction behave unpredictably — this wasn't a bug introduced by the port, just a constraint worth knowing about before wiring in multiple simultaneous MIDI sources.

## No test suite existed upstream

Same situation as `@music-theory/core` — `vitest` was a devDependency, no `*.test.ts` files existed. `test/groove-capture.test.ts` is a baseline suite written during the port.
