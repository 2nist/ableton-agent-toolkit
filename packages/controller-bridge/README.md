# @hardware/controller-bridge

Ported verbatim from `/Users/Matthew/unified-music-platform/packages/controller-bridge`. Zero runtime dependencies. Implements the Elements → Mappings → Modes architecture pattern used by Ableton's own MIDI Remote Scripts (element definitions ported from `AbletonLive11_MIDIRemoteScripts` `APC_mini_mk2`/`ATOMSQ`), plus a ReaLearn-compatible preset exporter for Helgobox/REAPER integration.

## `getMidi()` (and therefore `validate()`) doesn't resolve whole-matrix references

`getMidi(name)` resolves a direct control by name, or a single indexed matrix cell via `"matrixName[index]"` — it does **not** resolve a bare matrix name like `"faders"` or `"track_buttons"` to anything (there's no single MIDI number for an entire matrix). The shipped `APC_MINI_MK2_MAPPINGS` and `ATOMSQ_MAPPINGS` presets map several properties directly to a whole matrix (e.g. `mixer.volume_controls: "faders"`), so calling `.validate()` on the bridge built from the shipped presets **returns `valid: false`** with errors for every whole-matrix reference. This is not a bug the port introduced — it's how the shipped mapping data and `getMidi` already related to each other upstream. Confirmed and pinned down in `test/controller-bridge.test.ts`.

If you're consuming `validate()`, treat it as diagnostic output about resolvable single-element mappings, not a pass/fail gate — or extend `getMidi`/`validate` to understand whole-matrix targets (e.g. by resolving to the matrix's per-cell MIDI list) before relying on `valid === true` for controllers that map whole matrices.

**Confirmed against the real source**: this isn't a porting mistake. `reference/scripts/APC_mini_mk2/mappings.py` maps properties to whole matrices the same way (e.g. `volume_controls="faders"`) — Ableton's actual `ableton.v3.control_surface` framework resolves that to a whole `ButtonMatrixElement` object and hands it to the target component, which is written to accept either a single element or a matrix. `getMidi()`'s single-MIDI-number return type has no way to represent that. See `reference/README.md` for the full writeup.

## `toReaLearnPreset()` silently drops anything `getMidi` can't resolve

Because of the above, `toReaLearnPreset()` also silently skips any mapping entry whose element resolves to `null` (the whole-matrix cases) — the exported ReaLearn preset today only contains the subset of mappings that reference direct controls or indexed matrix cells, not full matrices. Exported presets for APC mini mk2 / ATOM SQ are therefore currently incomplete relative to what the mapping tables describe.

## No test suite existed upstream

Same situation as `@music-theory/core` — `vitest` was a devDependency, no `*.test.ts` files existed. `test/controller-bridge.test.ts` is a baseline suite written during the port, including the whole-matrix-resolution gap documented above.
