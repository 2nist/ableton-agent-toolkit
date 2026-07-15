# Chord Assistant

The platform's first real deliverable — no UI in v1, per the plan's "fastest path to something actually usable" phasing.

Right-click a MIDI track's Arrangement View selection → **Insert Chord Progression**. Creates one MIDI clip per selected MIDI track/take-lane, starting at the selection's start point, filled with a block-chord voicing of `@music-theory/core`'s default preset progression ("Pop Progression", I-V-vi-IV, in C).

## v1 behavior, stated plainly

- **Clip length is the progression's natural length** (sum of each chord's beat duration), not clamped or stretched to fit the width of the original selection. A 16-beat progression starting at beat 8 always produces a 16-beat clip, regardless of whether the user's selection was 4 beats or 40.
- **Every note is a sustained block chord** for its chord's full duration — no arpeggiation, no inversions, no voice leading between chords. The simplest useful voicing, not the final one.
- **Octave 5** in `@music-theory/core`'s numbering (= MIDI 60, "middle C" as Ableton displays it) is the default register — see that package's README for why octave 4 would be wrong here.
- Two grouped transactions per invocation (create clips, then fill them) — not one. The SDK's own docs are explicit that you cannot create a clip and set its properties within the same transaction, since you need the created instance first. See `src/extension.ts`'s comment and `test/extension.test.ts`'s assertion of exactly 2 `transaction.begin` log entries.

## Programmatic use beyond the context menu

The registered command accepts optional `presetKey`, `key`, and `octave` arguments beyond what a context-menu trigger can supply — only reachable via `context.commands.executeCommand` or (in tests) `ctx.invokeCommand`. The context-menu-triggered path always uses the defaults (`pop_progression`, `C`, octave 5).

## Testing

`test/build-progression.test.ts` — pure logic, no SDK/test-harness dependency at all.
`test/extension.test.ts` — full `activate()` flow via `@platform/test-harness`, verifying the real registered scope, the two-transaction grouping, and that non-MIDI lanes are skipped.

Both verified logically; real-Live manual QA (does a right-click in an actual Live 12 Beta Arrangement View produce the expected clip) is still outstanding — see the root README's Phase 3 status.
