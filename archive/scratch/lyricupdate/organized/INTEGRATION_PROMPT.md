# Task: Wire the deterministic lyric engine into TrackDraft

You are integrating a set of **pure, deterministic lyric-analysis and prompt-generation modules**
into the TrackDraft app (`apps/trackdraft`). The code is finished and tested in isolation; your job
is to **wire it to the app's real data and UI**. It lives in
`/Users/Matthew/ableton-agent-toolkit/lyricupdate/organized/`.

## Operating principles

- These modules are **pure functions**. They do no I/O, no React, no state. Do not add side effects.
- **Determinism is a feature**: same section + same roll → same output. Never replace the seeded
  picks with `Math.random()`.
- **Do not break the existing lyric features** — the app already has `sectionize.ts`, `rhymes.ts`,
  `syllables.ts` and the Lyrics components. You are **adding** a layer, then reconciling overlap
  deliberately (see "Decisions" below). When in doubt, prefer consolidating on the new engine.
- Match existing code style (2-space indent, ESM, `import type` for types, doc comments).

## Source of truth (read these first, in this order)

1. `REFACTOR_NOTES.md` — status, pending work, known issues. **Read this first.**
2. `INTEGRATION_PROMPT.md` — this file.

## Files to copy into `apps/trackdraft/src/lib/lyrics/`

| File | Role |
|---|---|
| `melodyPhrases.ts` | melody notes → phrases, metric weight, syllable slots, prosody check |
| `phonetics.ts` | syllables/stress/rhyme-key/rhyme-scheme/foot from ARPAbet (`Pronouncer` injected) |
| `seed.ts` | `hashSeed`, `mulberry32`, `shuffled`, `deal` (shared seeded picking) |
| `sparkBank.ts` | tagged subject/perspective/rule/challenge banks |
| `spark.ts` | `composeSpark` — the creative-nudge composer |
| `lyricBrief.refactored.ts` | **use THIS one** as the new `lyricBrief.ts` (renamed) |
| `*.test.ts` | colocated vitest suites (`lyricBrief.refactored.test.ts` → `lyricBrief.test.ts`) |

**Important:** `lyricBrief.ts` in this folder is the **old, pre-refactor** version kept for reference.
Use **`lyricBrief.refactored.ts`** (rename to `lyricBrief.ts`) and its matching test. It already
imports `./seed` and has no `constraint` prompt kind.

## Module dependency graph

```
seed.ts        (no deps)
melodyPhrases  (no deps)
phonetics.ts   → melodyPhrases (imports type Stress)
sparkBank.ts   → lyricBrief (imports type SectionRole)
spark.ts       → lyricBrief (type SectionRole), seed (deal), sparkBank
lyricBrief.ts  → melodyPhrases (type Phrase), seed (deal)
```

## Step-by-step wiring

### 1. Install + baseline
- Copy the files above into `src/lib/lyrics/` (rename `lyricBrief.refactored.ts` → `lyricBrief.ts`,
  `lyricBrief.refactored.test.ts` → `lyricBrief.test.ts`).
- Run `npm run typecheck` and `npm run test`. The lib suites must pass **before** any UI work.
  (Run with **vitest**, the app's test runner — these tests import from `vitest`. An earlier session
  ran them under Node's `tsx --test`, which produced a spurious failure in the `seeded shuffle`
  suite. If that single test fails under vitest, investigate; the RNG/Fisher–Yates logic is sound
  on inspection.)

### 2. Feed real section data into `buildBrief`
- `BriefInput` mirrors `MapSlot` / `BlueprintSection` **structurally** — it works on a template
  before it's applied and on a live section after. Find the app's section/slot type
  (see `src/types/blueprint.ts`) and build a thin adapter mapping:
  `id`, `role` (→ `SectionRole`), `bars`, `beatsPerBar` (use `beatsPerBarFor(numerator, denPower)`),
  `beatsPerChord`, `progression` (roman numerals), `purpose` (the `FEEL:` sentence is lifted by
  `feelOf`), `swing`, `optional`, `lyric` (slot vocal/density/job hints), `priorScheme`, `reroll`.
- Optional melody: if the section has recorded melody notes, run `segmentPhrases(notes)` and pass
  the result as `phrases`. Skip it when there's no melody.
- Optional energy: `energy` / `prevEnergy` (1–10). Use `energyOfVelocity(preset)` from the section's
  velocity preset; `prevEnergy` = the previous section's value.

### 3. Wire `composeSpark` (optional, complements the brief)
- Inputs: `songId`, `sectionId`, `role`, `roll`, `subjectRoll`, `existingSubject` (the song's own
  lyrical subject if already written — used instead of a random one), `level` (`"section" | "song"`).
- The subject is **song-level and sticky** (keyed by `songId`, not section). Persist `roll` and
  `subjectRoll` as integers so reopening shows the same spark.

### 4. Provide a real `Pronouncer`
- `phonetics.ts` takes a `Pronouncer = (word) => ARPAbet string | null`. Right now only a test
  fixture (`fromRecord`) exists. Without a real source, every word falls back to the `guessSyllables`
  heuristic and is reported `unknown`.
- Choose one and inject it at the app boundary:
  - **Offline:** bundle a CMU dictionary subset (words the app actually uses) → `fromRecord(dict)`.
  - **Network:** Datamuse `md=r` per word (cache aggressively). Keep the app's existing
    `rhymes.ts` (`rel_rhy`) working in parallel or fold it into the same lookup layer.
- Surface `LineAnalysis.unknown` in the UI so users see which words were guessed.

### 5. UI: fix the prompt-kind label map (the known blocker)
- The prior session left a compile error: a `LyricsBriefPanel.tsx` maps prompt kinds to labels and
  still references the removed `constraint` kind (TS2353).
- If/when you create or update that panel, its label map must cover the **new** union and **omit
  `constraint`**:

```ts
import type { BriefPrompt } from "../../lib/lyrics/lyricBrief";
const LABELS: Record<BriefPrompt["kind"], string> = {
  job: "Job", structure: "Structure", cadence: "Cadence", feel: "Feel",
  density: "Density", energy: "Energy", melody: "Melody", rhyme: "Rhyme",
};
```

- Render `buildBrief(input).prompts` as a list; add a **Reroll** control that increments `reroll`.
- If you surface `prosodyIssues(stress, syllableSlots(phrase, meter))`, get `stress` from
  `analyzeLine(line, pronouncer).stress` and `slots` from the section's melody phrases.

## Decisions to make (call them out in your PR)

1. **Syllable counting** — the app has `syllables.ts` (npm `syllable`) AND `phonetics.ts`
   `guessSyllables`. Consolidate on `phonetics.ts` (it also gives stress), or keep `syllables.ts`
   for plain counting. Don't leave both as the "official" counter.
2. **Rhyme** — `rhymes.ts` (Datamuse `rel_rhy` + crude `localRhymeGuess`) vs `phonetics.ts`
   `rhymeKey`/`rhymeRelation`/`rhymeScheme`. The phonetics engine is strictly better than
   `localRhymeGuess`; prefer it for analysis, keep Datamuse for suggestion lists if desired.
3. **Where the brief lives** — template-time (on `MapSlot`) vs live (on a `BlueprintSection`).
   The design supports both; pick the one that matches how TrackDraft instantiates sections.

## Known issues (from REFACTOR_NOTES.md — verify, fix or document)

- `guessSyllables("people")` → 3 (should be 2); `-le` keeps the silent `e`.
- Unknown words get a trochaic fallback `[1,0,…]` — wrong for iambic words (e.g. `guitar`).
- `FUNCTION_WORDS` set is small; function words missing from it that have dictionary stress 1
  are counted as stressed.
- `prosodyIssues` ignores secondary stress (2) for `stressed-on-weak`.
- `deal()` / `composeSpark` don't guard empty pools (`n % 0` → `NaN` → `undefined` → `.text` throws).
  With the current bank this can't happen, but a future edit could empty a pool — add a guard.
- `metricWeight` maps a beat just before the bar line up to downbeat weight (deliberate, confirm).
- `hashSeed` still exists in the OLD `lyricBrief.ts` — you're not shipping that file, so no action.

## Acceptance criteria

- [ ] All `src/lib/lyrics/*.test.ts` pass under `npm run test` (vitest).
- [ ] `npm run typecheck` is clean.
- [ ] `buildBrief` renders in the UI from a real section's data; Reroll changes the seeded prompts.
- [ ] A real `Pronouncer` is wired (offline dict or Datamuse), and `unknown` words are visible.
- [ ] Existing lyric features (sectionize/rhymes/syllables) still work; overlaps are resolved per
      the decisions above and noted in the PR.
- [ ] The `constraint` prompt kind is gone everywhere; label map uses the new union.

## Do NOT

- Don't ship the old `lyricBrief.ts` (it's the pre-refactor reference copy).
- Don't compile `lyriccode.transcript.txt` (it's a session transcript, not source).
- Don't introduce randomness or network calls into the pure modules.

