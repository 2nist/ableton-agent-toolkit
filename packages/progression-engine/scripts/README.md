# Data pipeline

Builds the transition model + tension table from the lead-sheet corpus.

```
extract_lead_sheet_sequences.py   (Python)  ->  ../data/lead_sheet_degree_sequences.json
build-model.ts                    (tsx)     ->  ../data/transition_model.json + ../data/tension.json
```

## Steps

```sh
# 1. extract degree sequences from /Users/Matthew/ableton-midi/lead-sheets
python3 scripts/extract_lead_sheet_sequences.py

# 2. build the model + tension table
npm run build:model
```

## Notes

- Degree sequences are key-invariant (relative to each section's tonic), so the
  model transfers across all keys.
- To grow the corpus later (decision C: a filtered slice of the 1.25M
  `pitches_chords_progressions.jsonl`), produce another sequences JSON and either
  merge it here or pass it to `buildTransitionModel` with `minCount`.
- `buildTransitionModel` in `src/transition.ts` is the only ingestion point; the
  engine itself never reads files.
