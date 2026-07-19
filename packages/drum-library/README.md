# @drum/library

Groove library built from [E-GMD](https://magenta.tensorflow.org/datasets/e-gmd) (Magenta's Expanded
Groove MIDI Dataset — 45,537 real human drummer performances), indexed by **measured feel** rather
than genre.

## Why not the pre-built pattern libraries

A set of derived pattern libraries already existed (`pattern_library_CORE/FULL/REFINED/fixed.json`).
They are unusable: every pattern's notes are crammed into the first fraction of a beat of a declared
16-beat loop — 438/438 kick and 481/481 snare patterns, across all four files. Played back, every hit
stacks into one blip at bar 1. No rescaling recovers them (post-conversion span vs. declared length
runs p10 0.026 to p90 1.178, a 45× spread). Their `quality_issues.json` reported `{}`.

So this package extracts from the source MIDI, and `validateTake` asserts physical plausibility on
every take — a pipeline reporting itself clean is not evidence that it is.

## Design

**Feel, not genre.** Genre reads as prescriptive ("play me a rock beat"); these axes read as
description. Genre is retained on each take purely as a hidden retrieval signal.

| Axis | Meaning |
|---|---|
| `push` | signed timing offset from the grid — negative is behind the beat, positive ahead |
| `looseness` | spread of that offset: machine-tight vs. human |
| `dynamics` | velocity spread — ghost notes and accents |
| `density` | hits per bar |
| `syncopation` | share of energy on metrically weak positions |
| `swing` | where the offbeat sits: 0.5 straight, ~0.667 shuffled |
| `weight` | how hard hits on the pulse land |
| `brightness` | open/crash share of cymbal hits |
| `motion` | bar-to-bar variation: hypnotic vs. through-composed |

**Limbs are the unit.** Voices are grouped by the limb that plays them (`feet`, `snare`, `cymbals`,
`toms`), so parts can be recombined across drummers — a rock player's foot under a jazz player's
cymbal hand. 90% of takes carry all three core limbs. The pedal hi-hat groups with the *feet*, not
the cymbals, because a left foot plays it.

Recombination needs compatibility constraints to stay musical: match swing, keep tempos close, align
downbeat phase, match meter. A triplet-feel ride over a straight-16th kick is mush.

**Segments are views.** Indexing every candidate loop as its own note array would mean ~8.1M objects.
Instead notes live once per take, and a `Segment` is `(takeId, limb, startBar, lengthBars)` plus its
measured features. `resolveSegment` materialises notes on demand.

**Two levels.** `rhythmKey` identifies a pattern with feel stripped out, so segments sharing a key are
the same rhythm played differently. That gives a browsable vocabulary of rhythms, each with real human
variants underneath — and lets feel controls move *between variants of one rhythm* instead of jumping
to an unrelated groove.

**Fills and beats are different objects.** Measured corpus-wide, fills run a median of 3.5 beats
(198/231 are ≤1 bar) while beats run a median of 77 and up to 1294. So fills are taken whole and beats
are windowed. Bar length always comes from the take's time signature — ~1.1% of the corpus is 6/8,
3/4, 5/4 or 5/8, and assuming 4 would misalign every bar in them.

**Corpus and synthesis are complementary, not rivals.** The corpus supplies what only humans can:
pocket, ghost notes, real microtiming. `synthesize.ts` supplies what humans *don't* play: house
four-on-the-floor, trap hat grids, dnb two-step, breakbeat chops — genres that were born programmed
and should be grid-tight — plus 7/8 (zero corpus takes) and extra 5/4 / 6/8 variants (corpus is
thin there). The merge policy lives in `presetData.ts`: machine idioms are synth-only, odd meters
mix both, acoustic staples stay corpus-only.

**Selection is heuristic, on purpose.** TrackDraft's per-section drum dropdown is gone. `infer.ts`
maps section role + dynamics + meter + song tempo + the song's own self-description (concept /
instrumentation text decides acoustic vs. electronic) to an engine pattern. Users who want
different drums edit the generated clip in Live — the right tool for beat editing.

**Provenance is part of the format.** Every baked variant records where it came from: per-limb
`SegmentRef`s into specific corpus takes for `egmd` variants, a generator name for `synth` ones,
plus corpus id and bake timestamp in `meta`. The predecessor library shipped corrupt data that
reported itself clean; traceability is the antidote.

**Runtime helpers.** `vary.ts` tiles a groove with seeded per-bar micro-variation (velocity breath,
occasional dropped hat — never the first tile, never kick/snare). `groove.ts` extracts a variant's
timing/velocity pocket as a `GrooveMap` and applies it to other parts (bass, comping) so the whole
arrangement sits together. Fills come from E-GMD's own `beatType: "fill"` takes (acoustic family)
and `synthesize.ts` (electronic family), keyed by bar length; `trackdraft-bridge` swaps the last
bar of a section for one at every handoff and opens the next section on a crash.

## Usage

```bash
npm run extract -- --limit 200      # subset, for review
npm run extract -- --all            # full corpus
npx tsx scripts/build-presets.ts    # bake presets-data.json (format 2, with provenance)
npx tsx scripts/inspect.ts --style funk --bars 2
```

`inspect.ts` renders a groove as a text grid (`#` accent, `+` hit, `.` ghost). Look at grooves before
trusting them — summary statistics did not catch the last corruption.

Set `EGMD_ROOT` if the dataset lives somewhere other than the default path.

## Auditioning

Grooves can be rendered to audio through the one-shot drum-machine kits in `/Users/Matthew/drums`
(override with `DRUM_KITS`):

```bash
npx tsx scripts/audition.ts --list-kits
npx tsx scripts/audition.ts --style funk --kit "Roland TR-909" --bars 2
npx tsx scripts/audition.ts --style jazz --kit "Linn LinnDrum" --limbs feet,snare
```

Onsets are placed at fractional sample positions rather than snapped, so microtiming survives into
the audio — a laid-back take must not render identically to a quantised one.

Voice→sample mapping is by scored token search, because every machine names its files differently
(`909BDA 01`, `808Oh25`, `Hat C 01`, `PACBD`). The chosen sample for each voice is always printed:
a wrong kick is harder to notice by ear than a missing one. Hits with no sample are reported rather
than silently dropped, since that would make a groove seem sparser than it is.

Of 199 kits, ~112 map all three core voices, including every well-known machine (TR-909/808/707/606,
LinnDrum, MPC60, DMX, RX11, CR-78). The rest fail for two reasons that filename matching cannot fix:
some kits name samples numerically only (`01.wav`, `MD16B001.wav`), and some vintage machines
genuinely lack a voice — the Boss DR-220A has no closed hat at all. Mapping those would need audio
classification rather than better patterns.
