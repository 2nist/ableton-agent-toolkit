# @music-theory/song-structure

Ported verbatim from `/Users/Matthew/unified-music-platform/packages/song-structure` (based on lalo-chezia's `S()` format and Sketch Mode architecture). Zero runtime dependencies.

## Deliberately does NOT depend on @music-theory/core

`music-theory-types.ts` re-declares `ScaleType`/`NoteName`/`ChordQuality` locally rather than importing them from `@music-theory/core` — this is intentional in the source (its own comment: "without cross-package dependency"), not an oversight, and was preserved as-is in this port. Don't "fix" this by adding a dependency on core without checking whether that decoupling still matters to how this package is consumed.

## `buildSong`'s duration math uses the song's own time signature, not per-section ones

`totalDurationSeconds` is computed from `buildSong`'s top-level `timeSignatureNumerator` (default 4/4), not each section's own `timeSignatureNumerator`/`timeSignatureDenPower`. A section built with a different time signature still contributes its `bars` count to the total using the *song's* beats-per-bar for the duration calculation. See `test/song-structure.test.ts` for the worked example.

## No test suite existed upstream

Same situation as `@music-theory/core` — `vitest` was a devDependency, no `*.test.ts` files existed. `test/song-structure.test.ts` is a baseline suite written during the port.
