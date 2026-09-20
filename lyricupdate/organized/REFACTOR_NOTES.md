# Lyric component — extraction & refactor notes

Organized from `lyricupdate/` on 2026-09-20.

## Sources

- `lyricBrief.ts`, `lyricBrief.test.ts`, `melodyPhrases.ts`, `melodyPhrases.test.ts` → from `files (5).zip`
- `phonetics.ts`, `phonetics.test.ts` → from `files (6).zip`
- `seed.ts`, `sparkBank.ts`, `spark.ts`, `spark.test.ts` → recovered verbatim from the heredocs inside `lyriccode.ts`
- `lyriccode.transcript.txt` → the raw agent-session transcript (NOT source; kept for reference)

## ⚠️ Unfinished refactor (transcript ends mid-flight)

The zip version of `lyricBrief.ts` is the **pre-refactor** code. The transcript then documents
an incomplete refactor on top of it:

1. Extract the seeded helpers into `seed.ts` and change `lyricBrief.ts` to `import { deal } from "./seed"`.
2. Replace `pick(...)` with `deal(pool, seed, input.reroll ?? 0)`.
3. Add `energy?: number` / `prevEnergy?: number` to `BriefInput`, plus an `energyOfVelocity()` helper
   mapping `ppp…fff` → `1…10`.
4. Add `"energy"` to `BriefPrompt.kind` and an energy prompt block in `buildBrief`.
5. Remove `"constraint"` from `BriefPrompt.kind`, delete `CONSTRAINTS_ANY` / `CONSTRAINTS_BY_ROLE`,
   and stop pushing a `constraint` prompt.

**Blocking error left in the transcript** (still unfixed):

```
src/components/lyrics/LyricsBriefPanel.tsx(13,58): error TS2353:
Object literal may only specify known properties, and 'constraint' does not exist in type
'Record<"job" | "structure" | "cadence" | "feel" | "density" | "energy" | "melody" | "rhyme", string>'.
```

The prompt-kind → label map in `LyricsBriefPanel.tsx` was never updated to drop `constraint` / add `energy`.
That file is **not present** in this kit (it lives in the app). To finish the refactor, update that map.

## Integration status

None of these files exist in `apps/trackdraft/src/lib/lyrics/` yet — the app still has its own older
lyric implementation (`sectionize.ts`, `rhymes.ts`, `syllables.ts`).

- Overlap: `syllables.ts` (`syllable` npm pkg) vs `phonetics.ts` `guessSyllables`; `rhymes.ts`
  (Datamuse `rel_rhy` + crude `localRhymeGuess`) vs `phonetics.ts` ARPAbet `rhymeKey`/`rhymeRelation`/`rhymeScheme`.
- `phonetics.ts` declares a `Pronouncer` interface but ships only a test fixture (`fromRecord`).
  No real CMU dictionary or Datamuse `md=r` fetcher is wired up, so in-app everything falls back to
  the `guessSyllables` heuristic and is reported `unknown`.
- `hashSeed` is duplicated in the zip's `lyricBrief.ts` **and** `seed.ts` (the refactor was meant to dedupe it).

## Test-runner mismatch

Tests import from `vitest`, but the transcript ran them with `tsx --test` (Node's built-in runner),
and the app's test script is `vitest run`. The single failing shuffle test
(`is a permutation and is stable for a seed`) is most likely a runner artifact — the RNG/Fisher–Yates
logic is sound on inspection. **Re-verify with `vitest run`.**

## Known issues in the code

- `guessSyllables` mis-syllabifies some words (e.g. `people` → 3, should be 2; the `-le` rule keeps the silent `e`).
- Unknown words get a trochaic fallback (`[1,0,…]`), wrong for iambic words like `guitar`.
- `FUNCTION_WORDS` set is small; missing function words with dictionary stress 1 are counted stressed.
- `prosodyIssues` ignores secondary stress (2) when flagging `stressed-on-weak`.
- `deal()`/`composeSpark` don't guard empty pools (`n % 0` → `NaN` → `undefined` → `.text` throws).
- `segmentPhrases` uses `Math.max(...g.map(...))` (argument-spread; fine for real melodies, latent).
- `metricWeight` maps a beat just before the bar line (e.g. `-0.001`) up to downbeat weight `1`.

## Couldn't verify at runtime

This machine has no `node`/`npm`/`vitest`/`tsx`/`tsc` on `PATH`, so tests/types could not be run here.
Re-run under the app's toolchain (`npm run test` / `npm run typecheck`).
