# @music-theory/song-taxonomy

Evolving, editable **narrative-form** classification for songs — mined empirically from annotated
corpora, then grown by human-confirmed proposals rather than a fixed enum. Genre/subgenre is a
later phase of the same package; this first cut covers narrative form end to end.

## Why not a fixed list of forms

A category set that's supposed to keep growing can't be a closed TypeScript union (the
`SectionRole` pattern elsewhere in this monorepo) — every existing vocabulary in the repo is
either that, or free text mined by ad hoc regex. Narrative-form ids here are plain `string`s, and
`src/data/narrative-forms.json` is the live registry: `scripts/mine-corpora.ts` derives it, and a
future taxonomy UI edits it directly.

## The empirical findings that shaped this design

Measured directly on 739 McGill Billboard/SALAMI songs, 179 TrackDraft Beatles-catalog songs, and
192 Rock Corpus songs — not assumed:

- **Exact-match section signatures are dead on arrival**: 469 distinct raw signatures from 739
  McGill songs alone.
- **McGill's `Intro` label is a catch-all**, not "the song's opening" — 423/739 songs (57%) have a
  mid-song `Intro`. Verified against aligned LRCLIB lyrics (Rare Earth, "Get Ready"): those
  mid-song `Intro` sections carried 12–13 sung lyric lines each. They're verses.
- **`sectionFunction` adds nothing** — it's a lossless deterministic collapse of `sectionType`.
- **Skeleton reduction is the unlock**: keeping only the load-bearing roles (verse, chorus,
  pre-chorus, bridge, solo) and collapsing consecutive repeats cuts 469 raw signatures to 157, with
  the top 20 covering 71% of the corpus (vs. 23% for raw signatures).
- **Greedy leader clustering** (weighted Levenshtein, normalized by length, clustering threshold
  0.34) turns that into ~20 musically sane canonical forms across all three corpora pooled — see
  `src/data/narrative-forms.json` for the current set.
- **Corpora disagree, and that's a feature, not noise.** Beatles skews AABA
  (`verse-bridge-verse-bridge-verse`, one of the largest clusters); Billboard skews
  verse-chorus. Pooling both, with per-corpus support tracked on every form's provenance, is what
  keeps the taxonomy from being pop-radio-shaped only.
- **Timestamped lyrics exist for the research corpora too** — `lyrics_from_lrclib/` directories
  ship alongside both McGill and Rock Corpus (LRCLIB records, same `[mm:ss.xx]` format TrackDraft's
  own catalog ingestion already parses). Fuzzy title/artist matching covers ~94% of McGill. This is
  what makes the `Intro`-mislabeling repair evidence-based instead of a positional guess.

## Design

- **Zero runtime dependencies.** Adapters (`src/adapters.ts`) take plain structural interfaces
  (`{role?, name?, chords?}`), not imports from `@music-theory/song-structure` — that's what lets
  McGill JSON, Rock Corpus `.jcrd`, the Beatles catalog, and any `BlueprintSong` all feed the same
  classifier, and lets other packages depend on this one without a cycle.
- **Assistive, not authoritative.** `classifyNarrative` returns `formId: null` below its
  confidence threshold rather than force-fitting a song to the nearest form — the "propose new
  class, human confirms" contract lives in `src/candidates.ts`.
- **Copyright posture:** the taxonomy stores exemplar **song ids and titles only** — never lyrics,
  never chords, never audio. `src/data/*.json` is safely committable; the corpora themselves
  (McGill, Rock Corpus, Beatles audio) stay local, referenced only by absolute path defaults that
  can be overridden with `MCGILL_ROOT` / `ROCK_CORPUS_ROOT` / `CATALOG_ROOT`.

## Usage

```bash
npm run mine                # derive/update narrative-forms.json + candidates.json from the corpora
npx tsx scripts/classify-corpora.ts   # report classification coverage across all three corpora
```

Both scripts skip any corpus that isn't present at its configured path — this package builds and
tests without any of the three corpora available, using only the small fixture taxonomy in
`test/classify.test.ts`. `test/corpus-golden.test.ts` gates its regression assertions on the McGill
corpus actually being present (`describe.skipIf`), so CI without the corpus stays green.

## Package layout

| File | Role |
|---|---|
| `src/types.ts` | `CanonicalRole`, `NarrativeForm`, `FormMatch` |
| `src/roles.ts` | `normalizeRole` — the one shared synonym map from raw labels to `CanonicalRole` |
| `src/skeleton.ts` | Intro-repair + load-bearing-only reduction to a narrative skeleton |
| `src/distance.ts` | Weighted, length-normalized Levenshtein over skeletons |
| `src/adapters.ts` | McGill / Rock Corpus / BlueprintSong → `SectionToken[]` |
| `src/lyricAlign.ts` | LRC parsing, fuzzy song matching, lyric-line-to-section bucketing |
| `src/classify.ts` | `classifyNarrative` — score a song against the current taxonomy |
| `src/candidates.ts` | Propose-and-confirm bookkeeping for new forms |
| `src/registry.ts` | Build-time bundled taxonomy snapshot (for the webview) |
| `scripts/mine-corpora.ts` | Derive/update the taxonomy from all three corpora |
| `scripts/classify-corpora.ts` | Coverage report |
