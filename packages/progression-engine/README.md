# @platform/progression-engine

Data-driven chord progression engine — the "brain" for the **Progression Studio**
(Chord Assistant v2). Form-agnostic pure TS: works in the extension host, a webview
modal, an M4L `jweb` shell, or a standalone web app.

## What it does

- **Markov transition model** over a progression corpus (key-invariant degree
  sequences, e.g. `I V vi IV`):
  - `buildTransitionModel(sequences)` — first + second order, starts/ends, totals.
  - `suggestNext(model, tail)` — ranked most-likely next chords (second-order →
    first-order → start fallback).
  - `rankPaths(model, start, length, topK)` — beam search = **"rankings of paths
    by chord"**: the top-K most likely continuations of any length.
- **Hybrid diatonic tension**:
  - *functional*: tonic `I` = 0.0 … leading tone `vii°` = 0.9; borrowed chords boosted.
  - *empirical*: learned from the corpus (entropy of successor distribution +
    section-finality), so tension is data-driven and scales as the corpus grows.
  - `tension(model, degree)` blends both (default 50/50, weights configurable).
  - `tensionColor(t)` — diverging blue→red ramp for UI coloring while building.

## Usage

```ts
import { buildTransitionModel, suggestNext, rankPaths, tension, tensionColor } from "@platform/progression-engine";

const model = buildTransitionModel(corpus);          // corpus: Degree[][]
const next = suggestNext(model, ["I", "V"]);          // top next chords
const paths = rankPaths(model, ["I"], 4, 5);          // top-5 continuations
const t = tension(model, "V");                        // { tension, functional, empirical, entropy, finality }
const c = tensionColor(t.tension);                    // { hue, hsl, hex }
```

## Data pipeline

1. `python3 scripts/extract_lead_sheet_sequences.py` — scan the lead-sheet MIDI
   corpus (`/Users/Matthew/ableton-midi/lead-sheets`) → `data/lead_sheet_degree_sequences.json`.
2. `npm run build:model` — build the transition model + tension table →
   `data/transition_model.json` + `data/tension.json` (with a top-transition sanity print).

The engine is corpus-agnostic — feed it a larger/filtered corpus (e.g. a cleaned
slice of the 1.25M Los-Angeles `pitches_chords_progressions.jsonl`) and re-run step 2.

## Tests

`npm test` (vitest): transition counts, second-order fallback, beam-search ranking,
functional + hybrid tension, tension curve, color ramp.
