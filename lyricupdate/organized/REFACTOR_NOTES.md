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

---

# Integration status (2026-09-20) — DONE

Shipped into `apps/trackdraft/src/lib/lyrics/` exactly as the prompt specified
(`lyricBrief.refactored.ts` → `lyricBrief.ts`; its test renamed to match; old
`lyricBrief.ts` NOT shipped). Verified under the app's real toolchain:
**53 test files / 593 tests pass, `tsc --noEmit` clean**, and the UI was
exercised live in the dev app (below).

## Decisions (the ones the prompt asked to call out)

1. **Syllable counting** — the official *analysis* counter is `phonetics.ts`
   (syllables + stress from ARPAbet; it is what the brief/line-check use).
   `syllables.ts` (npm `syllable`) is kept as the plain per-line counter in the
   **LyricsEditor gutter only** (sync, no pronouncer, count-only display).
   Not two "official" counters: analysis = phonetics, gutter = syllables.ts.
2. **Rhyme** — analysis (`rhymeKey`/`rhymeRelation`/`rhymeScheme`, `priorScheme`)
   is phonetics-only now. Datamuse `rel_rhy` (`rhymes.ts`) is kept for the
   *suggestion list* box; `localRhymeGuess` remains its offline fallback and is
   never used for analysis. The phonetic engine replaced `localRhymeGuess` as
   the analysis path everywhere.
3. **Where the brief lives** — **live on `BlueprintSection`** (TrackDraft
   instantiates sections from templates and discards the slots, so the live
   section is the only durable source). `briefInput.ts` maps both shapes
   structurally (`SectionLike`/`SlotLike`); the slot adapter is for pre-apply
   preview. Reroll/roll/subjectRoll persist as integers in the new
   `store/lyricsSparkStore.ts` (localStorage) — the engines stay deterministic.
4. **Pronouncer** — network path chosen: Datamuse `md=r` with an aggressive
   cache (`lib/lyrics/pronouncer.ts`): in-memory + localStorage cache, negative
   caching for dictionary-confirmed misses, failures never cached (retry).
   `components/lyrics/usePronouncer.ts` primes it; unknown words are shown
   dotted + summarized in the panel's Line check.

## Known issues — resolution

- `guessSyllables("people")` → **verified 2** in this version (regression test
  `engineRegression.test.ts`); no fix needed.
- Unknown-word trochaic fallback (e.g. `guitar`) — **documented**: still
  trochaic (the conventional English default) *for genuinely unknown words*;
  the real fix is the injected dictionary, and Datamuse resolves `guitar`
  correctly. Guessed words are surfaced in the UI, so the guess is visible.
- `FUNCTION_WORDS` small — **extended** (pronouns/auxiliaries/modals; "we",
  "are", "the" etc. demote correctly; see regression test).
- `prosodyIssues` ignored secondary stress — **fixed** (`stress !== 0`);
  secondary stress on a weak slot now flags.
- `deal()` empty-pool guard — **fixed**: `deal([])` now throws; `composeSpark`
  falls back to its unfiltered banks so filtered pools can never be empty.
- `segmentPhrases` spread (`Math.max(...g.map(...))`) — **fixed** with a loop.
- `metricWeight` pre-bar-line = downbeat — **confirmed deliberate**, documented
  in the code comment.
- `hashSeed` duplication — moot (old file not shipped).

## Shuffle test under vitest

The `seeded shuffle` failure was indeed a runner artifact: it is green under
`vitest run`, no logic changes needed.

## Live UI verification (dev app, 2026-09-20)

- `buildBrief` renders from a real catalog section (chord cycle, cadence,
  energy step 6→4, FEEL lifted from the slot purpose).
- **Reroll**: scheme suggestion walked ABAB → ABCB → AABB → ABAB (deck rotation,
  deterministic; counters persisted as integers).
- Spark **Roll** changed rule/POV/challenge; **subject** stayed sticky across
  sections of the song; `existingSubject` used the song's own notes when set.
- Pronouncer live: real ARPAbet stress on "Drive My Car" lyrics; unknown words
  ("somethin", "beep") marked dotted + listed as guessed.
- Template (`Neo-Psychedelia`) applied on a throwaway song for the reroll test;
  the test song was deleted afterwards and the throwaway counters cleared.
