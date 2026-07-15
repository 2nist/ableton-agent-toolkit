# @music-theory/core

Ported verbatim from `/Users/Matthew/unified-music-platform/packages/music-theory` (source: APC64 chord editor, tonal.js, hexagon chord logic). Zero runtime dependencies, pure TS/JS — runs unmodified in both the Extensions Node host and any webview (Extensions modal or M4L `jweb`).

## Known gotcha: octave numbering

`chordToMidiNotes`/`buildChordMidiNotes` use `octave * 12 + pitchClass`, so **octave 4 → MIDI 48**, not the scientific-pitch-notation "C4 = 60" convention most DAWs (including Ableton) display. Octave 5 in this library's numbering is the "middle C" octave (MIDI 60). Add 1 to whatever octave this library expects if you're handing notes to `MidiClip.notes` and want them to match what Ableton's own piano roll displays.

Caught by `test/music-theory.test.ts` — see that test for the exact numbers.

## 147 substitution rules

`countSubstitutions()` returns 147 — 7 modes × 7 degrees × 3 substitution options each. `getSubstitutionsForDegree(mode, degree)` returns the group for one degree; `getSubstitutionOptions` flattens it to `{degree, explanation}[]`.

## No test suite existed upstream

The source repo had `vitest` as a devDependency but zero `*.test.ts` files. `test/music-theory.test.ts` here is a baseline suite written during the port, not a re-run of an existing one.
