# TrackDraft catalogue pipeline

How the song library is **built**, **graded**, and **decided about**.

The library is not authored in the app and it is not committed as source. It is
an artifact of the pipeline below, and every song in it traces back to a corpus
with a licence class. That matters for two reasons: the library has to be
rebuildable on demand, and most of it must never ship.

> **Shipping rule:** a release ships only songs whose licence class is
> `cleared` — or which are explicitly attested in
> [`catalog/starter-allowlist.json`](./catalog/starter-allowlist.json).
> `npm run catalog:pack:starter` enforces this and refuses otherwise.
>
> Early test builds may include the whole library via a separate, stamped
> profile: `--profile internal --acknowledge-restricted` (see §5).

---

## 1. Corpus roots (environment)

Nothing is hard-coded to one machine any more. Every root is an env var; the
historical path is used only as a fallback when it exists, and the run says so.

| Variable | Corpus | Used by |
|---|---|---|
| `BEATLES_CHORDS_DIR` | Beatles chord charts (`.jcrd.json`) | `catalog:ingest:beatles`, `catalog:audit` |
| `BEATLES_LYRICS_DIR` | Beatles lyrics cache | `catalog:ingest:beatles` |
| `BEATLES_AUDIO_DIR` | Beatles audio archive | `batch-fix-drums.ts` |
| `MCGILL_ROOT` | McGill Billboard / SALAMI | `catalog:ingest:mcgill` |
| `ROCK_CORPUS_ROOT` | Rock Corpus (TDC) | `catalog:ingest:rock` |
| `LALO_CHEZIA_ROOT` | Lalo Chezia source docs | `catalog:ingest:lalo` |

Output locations (optional overrides):

| Variable | Default |
|---|---|
| `CATALOG_OUTPUT_DIR` | `scripts/output/catalog` |
| `BEATLES_OUTPUT_DIR` | `scripts/output/catalog` |
| `MCGILL_OUTPUT_DIR` | `scripts/output/mcgill-catalog` |
| `ROCK_CORPUS_OUTPUT_DIR` | `scripts/output/rock-catalog` |
| `LALO_OUTPUT_DIR` | `scripts/output` |

Resolution lives in [`lib/catalogPaths.ts`](./lib/catalogPaths.ts). A missing
required corpus produces an error that names the variable to set, not an empty
catalogue.

Corpus **directories stay separate** on purpose. A merged folder loses the
ability to tell a Beatles chart from a McGill one, and that provenance is the
only thing standing between the library and a licence problem.

## 2. Order of operations

```
  corpora ──▶ ingest ──▶ repair ──▶ triage ──▶ audit ──▶ manifest ──▶ pack:starter
                                                              │            │
                                                        (what/where)  (what ships)
```

```bash
export BEATLES_CHORDS_DIR=/path/to/Beatles-Chords
export BEATLES_LYRICS_DIR=/path/to/lyrics_from_lrclib
export MCGILL_ROOT=/path/to/mcgill_jcrd_salami_Billboard
export ROCK_CORPUS_ROOT=/path/to/Rock\ Corpus-TDC

npm run catalog:ingest:beatles      #  write scripts/output/catalog
npm run catalog:ingest:mcgill       #  write scripts/output/mcgill-catalog
npm run catalog:ingest:rock         #  write scripts/output/rock-catalog
npm run catalog:ingest:lalo         #  write scripts/output

npm run catalog:repair -- --dir scripts/output/catalog --dry-run   # then without --dry-run
npm run catalog:triage -- --dir scripts/output/mcgill-catalog      # then --apply

npm run catalog:audit               #  grade every song → scripts/output/catalog-audit.json
npm run catalog:manifest            #  record provenance + licences → scripts/output/catalog.manifest.json
npm run catalog:pack:starter -- --dry
```

Each stage is independently runnable and takes `--dir`. The newer ingests also
take `--only <ids>`, `--limit <n>`, `--out`, `--report`, `--dry`, `--list`.

## 3. What each stage produces

| Stage | Script | Output |
|---|---|---|
| ingest | `ingest-*-catalog.ts`, `ingest-lalo-chezia.ts` | `*.trackdraft.json` per song |
| repair | [`repair-catalog.ts`](./repair-catalog.ts) | rewritten songs + `*ingest-report.json` |
| triage | [`triage-catalog.ts`](./triage-catalog.ts) | `<dir>-triage/` + `*-triage-report.json` |
| audit | [`audit-catalog.ts`](./audit-catalog.ts) | `catalog-audit.json` — per-song `confidence` (0–1), `tier`, per-dimension scores (sections, chords, timing, lyrics, honeycomb, **drums**) and named issues |
| drum health | [`audit-patterns.ts`](./audit-patterns.ts) | which pattern/variant each section resolves to, kick/snare/hat density per bar, ghost-note share, beat-pool utilisation |
| drum repair | [`rederive-drum-patterns.ts`](./rederive-drum-patterns.ts) | clears ingest-stamped `drumPattern`/`velocity` back to derived values and stamps a corpus genre (dry run by default; `--apply`, `--velocity`, `--unmute`, `--genre`) |
| manifest | [`build-catalog-manifest.ts`](./build-catalog-manifest.ts) | `catalog.manifest.json` — per song: corpus, licence class, sha256, counts, rebuild instructions; per run: git sha, resolved corpus roots |
| pack | [`pack-starter-catalog.ts`](./pack-starter-catalog.ts) | the shippable subset + `MANIFEST.json` + `README.txt` |
| bundle | [`bundle-catalog.ts`](./bundle-catalog.ts) | copies a pack into `dist/catalog` for a test build |
| package | [`package-mac.mjs`](./package-mac.mjs) | `release/TrackDraft-<arch>/TrackDraft.app` |
| icon | [`make-icon.cjs`](./make-icon.cjs) | `build/icon.png` + `build/icon.icns` (`npm run icon`) |

## 4. Licence classes

Defined in [`catalog/sources.ts`](./catalog/sources.ts) — the only place the
policy lives. Songs are attributed to a corpus by **id prefix** (then by
directory), because the per-file `provenance.source` is `"catalog-lookup"` for
every corpus and cannot distinguish them.

| Class | Ships? | Meaning |
|---|---|---|
| `cleared` | **yes** | Authored by you, or rights held. Id prefix `local-`. |
| `copyrighted` | no | Derivative of a copyrighted work (chords/lyrics). |
| `research-only` | no | Academic corpus with research-use terms. |
| `unknown` | no | Origin unrecorded — not shippable until identified. |

Current library: **953 songs, 0 clearable** — 182 Beatles (copyrighted), 12
Lalo Chezia (copyrighted), 610 McGill (research-only), 149 Rock Corpus
(research-only). That is the expected state; the library is for local use.

To ship a song you hold rights to, either give it a `local-` id prefix, or add
it to the allowlist with an explicit attestation:

```json
{ "format": 1,
  "songs": [
    { "songId": "local-layla-demo", "attested": true, "note": "written by me, 2026" }
  ] }
```

An entry without `"attested": true` is a hard error, not a warning.

## 5. Build profiles

| Profile | Ships | Output dir | Distributable |
|---|---|---|---|
| `release` (default) | `cleared` + attested only | `scripts/output/catalog-starter` | **yes** |
| `internal` | **everything** in the library | `scripts/output/catalog-internal` | **no** |

```bash
npm run catalog:pack:starter                                   # release, summary only
npm run catalog:pack:starter -- --profile internal --acknowledge-restricted
```

The `internal` profile exists so early builds can be exercised against real
material. It is deliberately awkward and it stamps everything it writes:

- `MANIFEST.json` → `"distribution": "internal-test-only"`, `"notForDistribution": true`
- `DO-NOT-DISTRIBUTE.txt` beside the songs
- a banner at the top of `README.txt`
- a different output directory, so an internal pack can never overwrite — or be
  mistaken for — a release pack

It refuses to run without `--acknowledge-restricted`, and its result is never
reported as distributable, even when every song happens to be cleared.

**Distribution is still your call, not the tool's.** The flag records that you
asked for it; it does not make the material legal to publish.

## 6. Guarantees the packer checks

- **Default output is empty.** Empty allowlist + restricted library ⇒ nothing packs. That is success, not failure.
- **Nothing is selected by class it doesn't have.** Restricted + unattested ⇒ exit 1, naming the song.
- **Stale manifests cannot ship.** Each copied file's sha256 must match the manifest; if it doesn't, the packer tells you to regenerate.
- **Unreadable files never ship** — they are excluded from the manifest with a count.
- **An internal pack is never reported as distributable**, whatever it contains.

## 6b. Drums

`drumPattern` on a section is the **user's** override. Ingest used to stamp
`"standard"` on everything it produced, which does not just set a default — it
wins over `inferDrumPattern` forever, because the resolver reads
`section.drumPattern ?? infer(...)`. The audit found the whole catalogue on one
groove for that reason. Ingest no longer writes the field; see
`rederive-drum-patterns.ts` to clear an older pack.

Measuring a groove:

```bash
npx tsx scripts/audit-patterns.ts      # pool depth, density, ghost share
npx tsx scripts/rederive-drum-patterns.ts [--apply] [--unmute] [--dir …]
```

Two numbers to watch, both from `audit-patterns.ts`:

- **beat pool** — `(pattern·variant)` pairs in use out of the 265 baked. Before
  the repair this was 24; a catalogue stamped `standard` can only ever use
  that one pattern's variants.
- **variants baked** — `VARIANTS_PER_PRESET` (48) × 9 corpus patterns, minus
  anything the musicality filter rejects, plus the synth idioms and the
  Zappa-minted odd meters. A re-bake MUST be followed by `mint-zappa.ts`,
  which is what supplies `78` and most of `54`/`68`.
- **style match** — how many playing sections drew a variant from the song's
  own corpus family or its neighbours. Genre is what unlocks it; a catalogue
  with no `genre` field reports "no recognisable genre" for every song and
  silently gets the undifferentiated pool.
- **ghost share** — snare hits below velocity 45. E-GMD takes carry 40–46% of
  them in the denser patterns. They are real playing, but drawn at full weight
  they read as a backbeat twice as busy as the kick, so the UI draws them dim
  and short. The audit reports `snare:kick` twice: raw, and ignoring ghosts —
  the bracketed figure is the backbeat a listener hears.

## 7. Notes / known limits

- `ingest-lalo-chezia` writes loose files into `scripts/output/` (not a
  subdirectory); `LALO_OUTPUT_DIR` moves it. The manifest includes that
  directory by default.
- The audit's reference-chart comparison needs `BEATLES_CHORDS_DIR`; without
  it the audit still runs, just without JCRD cross-checking.
- `MCGILL_ROOT` / `ROCK_CORPUS_ROOT` are also read by
  `refresh-lrclib-lyrics.ts`.
- Song ids are the packer's identity key. Two corpora minting the same id are
  reported as `duplicateSongIds` in the manifest.
