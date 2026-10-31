# Architecture

## The one fork that matters

Not "Extensions vs. M4L" — **Node execution context vs. browser/webview execution context**.

- **Node context**: an Extension Host process running `extension.ts`. Real Node.js, has `context.*` SDK access (tracks, clips, transactions, commands), no DOM.
- **Browser context**: any UI. An Extensions modal dialog and an M4L `jweb` device page are both plain Chromium/WebKit pages running HTML/CSS/JS. They differ only in how they talk back to their host.

This is why `packages/ui-kit` can share real component code across both hosts, and why only `packages/ui-kit/src/bridge.ts` needs to know which host it's in.

## Where the song library lives

`lib/persistence/songRepository.ts` is the only thing that knows, and it picks one of three adapters once at module load, so `songStore` writes to a repository instead of branching on its host:

| Adapter | When | Shape |
|---|---|---|
| disk | desktop (host bridge present) | one JSON file per song in the library directory, written only when the object changed |
| IndexedDB | browser | one record per song (`{id, order, song}`), diffed by identity, in one transaction per batch |
| localStorage | browser without IndexedDB | the whole library as one JSON string under `trackdraft-songs` |

The browser path used to be the third row only, and that was a trap. localStorage is capped at roughly 2.5M UTF-16 characters per origin, and every autosave rewrote the entire library into it — so a corpus import (the rock catalogue alone is 149 songs / 4.4 MB) failed the write, and *every later write failed too, including deletions*, because shrinking the library was itself a save. A reload then restored the oversized library: a genuine deadlock, escaped only by the "Download backup" button on the autosave banner.

Hence IndexedDB, with two rules that matter:

- **Migration is verified before it is destructive.** A library found under `trackdraft-songs` is written to the database, `countSongRecords()` is checked, and the key is deleted only if every song landed. The legacy key is also dropped on any later load where it is fully covered, so an interrupted migration does not leak quota forever.
- **Failure falls back rather than losing data.** If `indexedDB.open` is blocked (private mode, embedded webview, another tab mid-upgrade) the adapter degrades to reading and writing the legacy key — precisely the old behaviour — instead of presenting an empty library.

Durability note: unlike a `localStorage.setItem`, an IndexedDB commit is asynchronous, so the `pagehide` flush is best-effort rather than guaranteed. That is the same trade the disk adapter has always made, and the 1.5 s autosave debounce means at most the last few keystrokes are at risk.

Settings → **Library storage** shows the footprint that made the failure invisible for so long: the serialised size, the song count, which backend is in use, and how much of the origin's quota is gone (`lib/persistence/libraryStorageInfo.ts`). It escalates at 75% of the IndexedDB quota, and — on the localStorage fallback, where the ceiling is hard — at 1.5M and 2M characters, printing the "saves are about to fail permanently" warning at the point where deleting songs would no longer be writable either.

## Verified host bridges

| Host | Detect via | Send | Receive |
|---|---|---|---|
| Extensions (macOS) | `window.webkit?.messageHandlers?.live` | `window.webkit.messageHandlers.live.postMessage(msg)` | none — one-shot only |
| Extensions (Windows) | `window.chrome?.webview` | `window.chrome.webview.postMessage(msg)` | none — one-shot only |
| M4L (`jweb`) | `window.max` | `window.max.outlet(...)` | `window.max.bindInlet(name, cb)` |

The Extensions side only supports a single `{method: "close_and_send", params: [resultString]}` call that closes the dialog and resolves a promise on the extension side — there is no ongoing push channel into an open modal. M4L's bridge is fully continuous and bidirectional. `ui-kit` components are split into two categories accordingly:

- **presentational / one-shot** — safe on both hosts (forms, pickers, confirm/cancel).
- **reactive / continuous** — only meaningful under `m4l-jweb` (live meters, realtime readouts).

## The SDK's real native boundary

Verified directly from the vendored SDK's compiled `dist/index.mjs` / `dist/index.d.mts`:

```ts
interface ActivationContext {
  initializeExtensionHost<V extends ApiVersion>(options: InitializeOptions<V>): EXTENSIONS_API[V];
}
```

`initialize(activation, apiVersion)` destructures `{commands, dataModel, environment, resources, ui}` from that one call and wraps each in a real SDK class (`Commands`, `Ui`, `Environment`, `Resources`, and the `DataModelObjectRegistry` behind `Track`/`Clip`/etc). `packages/test-harness` fakes only this one boundary and hands the fake to the SDK's own real `initialize()` — so mocked tests get real `instanceof MidiTrack` fidelity for free, with no duplicated class logic to keep in sync.

## Packages

| Package | Role |
|---|---|
| `@music-theory/core` | Chord/scale/substitution logic. Zero runtime deps, pure TS — runs unmodified in Node and any browser/webview context. |
| `@music-theory/song-structure` | Arrangement/form analysis, depends on `core`. |
| `@platform/ui-kit` | Shared components + `bridge.ts` host adapter + design tokens. |
| `@platform/test-harness` | Fakes `initializeExtensionHost`, calls the real SDK's `initialize()`. |
| `@platform/osc-bridge` | Thin wrapper over the already-installed AbletonOSC remote script, for realtime control Extensions can't do. **Implemented and running**: `bridge.ts` relays Ableton transport/beat state to WebSocket clients; `telemetry.ts` serves M4L telemetry + the blueprint command queue over REST; `cli.ts` wires both together. |
| `@platform/cli` | `create extension` / `create device` scaffolding. |

## Why AbletonOSC, not a new realtime layer

AbletonOSC is already installed and registered (`~/Music/Ableton/User Library/Remote Scripts/AbletonOSC`). Extensions are explicitly not for realtime audio/control (per the SDK's own docs) — AbletonOSC already covers that gap. `osc-bridge` wraps it; it does not reimplement it.

## The browser → Live command path

Browser actions ("set tempo", "apply this blueprint", "send to Ableton")
travel through a **directory of JSON files** that both the bridge and the
extension can reach:

```
TrackDraft app ──POST /api/command──▶ osc-bridge ──writes──▶ <queue>/*.json ──▶ extension ──▶ Live
```

The folder, rather than a socket, is historical: extensions had no network
globals, so a shared directory was the only channel. That is why the
extension used to learn about commands by scanning it every 2 s — a browser
action could sit for up to two seconds before Live did anything.

**Live 12.4.15b5** changed that: extensions now get `fetch`, `AbortSignal`,
`Headers`, `Request`, `Response`, `FormData` and `performance` (see
`extensions/trackdraft-bridge/src/commandTransport.ts`, whose
`describeRuntime()` reports which of them the running host actually has).
So the extension can long-poll instead:

| Transport | Needs | Latency |
|---|---|---|
| `GET /api/command/next?wait=…` (long-poll) | Live ≥ 12.4.15b5 | **~9 ms** (measured) |
| Directory scan every 2 s | any Live | 0–2000 ms |

Both remain, and the choice is automatic: the fast path is used when the
globals are present, and the scan takes over when they are not, when the
bridge is unreachable, or when the route 404s (an older bridge). The fast
path is re-probed every 30 s so a bridge started after Live is picked up
without a relaunch.

**Exactly-once** is the invariant that makes running both safe. A consumer
"claims" a command by **renaming** the file out of the queue — atomic on one
filesystem — so a still-running old extension, a new long-polling one, and
even two Live instances can all look at the same queue without any command
executing twice. Verified by racing the two paths over 20 commands in each
order: zero double executions.

The queue stays on disk on purpose: a command survives a bridge restart, and
the file scan keeps working if the bridge dies mid-session.

## Delivery: what actually leaves the app

Live is an **adapter**, not the app's identity. Everything a song can become
is organised as a ladder, and only the top rung needs a vendor API:

| Rung | Artifact | Needs |
|---|---|---|
| 0 | JSON blueprint | nothing |
| 1 | `.mid` (one track per stem, GM channels + programs) | nothing |
| 2 | A written setup guide for the receiving DAW | nothing |
| 3 | A native project file — currently `.rpp` | nothing |
| 4 | In-place commit (cue points, tracks, clips, pad remap) | the Live extension |

Rungs 0–3 are why "DAW-agnostic" is a fact rather than a claim: a song can be
handed to REAPER as an editable project, or to anything else as a MIDI file,
without a bridge, a plugin, or a licence. Rung 4 stays available for Live and
can be earned by another DAW later — the gap between rungs is effort, not
architecture.

### REAPER projects (rung 3)

`lib/reaper/rppProject.ts` writes a `.rpp`: five named tracks, one item per
section, the arrangement as regions, and the song's tempo. It reads the same
`sectionSpans` and stem planners as the `.mid` export and the live stream, so
all three describe one song.

Three details in that format silently corrupt a project if you get them
wrong, which is why they are spelled out here:

- **`POSITION` / `LENGTH` / `MARKER` are in seconds, not beats.** Beats put
  every item and region in the wrong place at any tempo other than 60.
- **Items carry their own MIDI resolution** (`HASDATA 1 960 QN`, REAPER's own),
  and the `E <delta> <status> <d1> <d2>` events are hex, relative to the
  previous event, and **relative to the item's start** — absolute song beats
  delay every note by the section's position.
- **The project tempo is the flat `TEMPO <bpm> <num> <den> 0` line.** A
  `<TEMPOENVEX>` point on its own does nothing: REAPER loads the project at its
  default 120 and every seconds-based item ends up off the beat ruler. (Real
  REAPER projects use one form or the other, depending on whether they have a
  tempo envelope — the flat line is the one that always applies.)

Item length is derived from the item's own last event **tick**, not from beat
arithmetic, so a note-off can never fall outside the item that holds it. A note
that rings past a section line makes its item run past the next section's
start, so consecutive items on that track overlap by exactly that tail (a
sustained pad, typically). That is deliberate — clipping at the boundary would
cut the sustain, and REAPER plays overlapping items on a track correctly. Each
note's on and off always live in the same item, so content stays disjoint and
nothing double-triggers.

**Verified against REAPER itself**, not just against our own reader: a 13-section
song exported and then loaded and re-saved by REAPER 6.82 produces the same 4
tracks, 52 items and 4,066 notes, with **zero** differences in note start times
or durations, the same tempo, regions and item overlaps. Re-saving through the
DAW's own writer is the check that proves the format, and it is what caught the
tempo line and the item-length bug — a round-trip through our own parser could
not have.

### Logic: rung 1 is the whole integration

Logic is the test of whether the ladder is real, because Logic offers almost
nothing to build against — no scripting dictionary for project content, no
OSC (verified: the installed Logic 10.7.9 ships no "Open Sound Control"
strings), and a `.logicx` bundle that is an undocumented binary container.
What it does have, read out of its own help text:

| Capability | Logic's own wording | What it buys us |
|---|---|---|
| `File → Import MIDI File` | "Import a MIDI file into your project." | rung 1 — the whole delivery path |
| MIDI clock in | Sync Mode → **Manual Sync (Tempo Interpreter)**: "receiving MIDI clock impulses that are recognized as valid beats" | our clock can drive Logic |
| MIDI clock out | Sync Mode → Internal: "Logic Pro transmitting MIDI clock", per output with a start position | Logic could drive us instead |
| MMC in | "Listen to MIDI Machine Control (MMC) input" | transport control — but MMC is SysEx, and our `requestMIDIAccess` asks for `{ sysex: false }` |

That is why the `.mid` had to learn to carry markers: for a DAW whose only
door is a file import, tempo, meter and section markers *are* the integration.
Writing `.logicx` directly is possible — `logicxkit` (Apache-2.0) adds MIDI
regions and notes to a project with Logic-confirmed writes — but it is
macOS-only, needs a template Logic itself saved, accepts only one internal
format version, and has to be a local helper. That is a rung 3 purchase we
should not make until someone is paying for it.

### MIDI clock out

`lib/playback/midiClockOut.ts` sends 24 ticks per quarter note plus
start/stop/continue and Song Position Pointer, so a DAW can follow
TrackDraft's transport with no bridge at all. It follows the *same*
`SchedulerClock` the note stream is timed from, so the DAW's grid and the
streamed parts cannot describe two timelines, and it works with no note
stream at all (clock-only sync). Ticks are queued ahead with explicit
timestamps and derived from absolute beat numbers (`tick / 24`), so a late
timer wake-up shortens the queue rather than the clock. The Live target does
not send clock: there Live is the master.

### One wire vocabulary

Every path that puts a note on a wire — preview, live out, `.mid`, `.rpp` —
goes through `lib/midi/wire.ts` for pitch/velocity clamping. Masking with
`& 0x7f` is not clamping: it turns 128 into 0 and 130 into 2, which is how an
export can sound right in a file and wrong in an audition. The same module
keeps the app's **1-based** channels separate from the **0-based** index the
wire uses (`channelToIndex` vs `clampChannelIndex`), because mixing the two
shifts a whole stem by one channel.

## MIDI import: classify the tracks, then use each for what it is

MIDI import used to treat every note as evidence of harmony — it stacked all
tracks together and ran chord detection on the result. That is right for a
full arrangement and wrong for the corpora we import most: **BiMMuDa and
CoCoPops are monophonic melody annotations**, so a single melodic line was
"detected" as chords that were never written (`D#aug, C#…` for Dancing
Queen, which has neither), while the melody itself was dropped — the importer
never populated `melody` at all.

`lib/parsers/midiTracks.ts` classifies first:

| Signal | Role |
|---|---|
| channel 9 | `drums` (GM percussion) |
| ≥ 20 % of onsets sound more than one note | `harmony` |
| monophonic, mean pitch < 52 | `bass` |
| monophonic | `melody` |

Then each track is used for what it is: harmony feeds chord detection (and
nothing else does — a melody-only file keeps an **empty** progression rather
than a fabricated one), the melody track becomes a `MelodyTrack`, and a
percussion track becomes one `steps` `DrumBlock` per lane, which stores the
notes verbatim rather than guessing a groove.

### When the file has no harmony or structure to read

A melody-only file still has to yield a usable song, so the importer **infers**
what is missing — and says so. `lib/parsers/melodyHarmony.ts`:

- **Chords** — duration- and accent-weighted pitch classes are scored against
  the seven diatonic triads plus a dominant seventh, then a transition prior
  picks the best path across the bars, so the answer reads as a progression
  (V→I, ii→V, a chord held across two bars) rather than as independent guesses.
  The key comes from the file's key signature, which is reliable in these
  corpora (Dancing Queen reads A major, Respect reads E).
- **Sections** — from repeated **harmonic** material, not the melody. A bare
  melody does not segment cleanly: pitch-class histograms are near-identical
  across a tonal song (every block collapsed to one label) while bar-level
  fingerprints were so noisy that a 76-bar song came out as 38 two-bar
  "sections". Harmonic loops are what actually repeat — a verse *is* its chord
  cycle — so block matching works on the chord sequence: 16/8/4-bar blocks,
  ≥75 % agreement to share a label, at most 4 labels, and at least a third of
  the song inside a repeat, or nothing is reported.
- **Drums** — parsed whenever the file has them (channel 9), never invented.

Everything inferred is flagged in `provenance.warnings` ("chords INFERRED from
the melody … review these"), because a guess that looks like extraction is
worse than no guess. Splitting into inferred sections **slices** the melody per
section and re-infers that stretch's harmony — cloning the full section into
each part would repeat the whole line in every one.

Measured on the real corpora:

| File | Result |
|---|---|
| ABBA – Dancing Queen (76 bars) | 1 section, 301 melody notes, inferred I/ii/IV/V/vi in A |
| Aretha – Respect (62 bars) | 1 section, 246 notes, inferred I/IV/V/vii in E |
| Big Joe Turner – Shake Rattle and Roll | **5 sections A B C B A**, melody sliced 48/96/48/48/48, harmony re-inferred per part |
| e-gmd drum groove | 3 lane blocks: kick 40, snare 32, hat 125 hits at their real beats |

When nothing repeats convincingly the importer keeps one honest `Full Song`
section rather than inventing structure.

Verified through the UI on the real corpora (ABBA – Dancing Queen, 76 bars):
0 fabricated chords, 301 melody notes imported (A4–C#5). BiMMuDa resolves the
same way. Both corpora are registered as **browse-only** dashboard
directories, each probed once against the dev server so a machine without the
datasets never sees a broken entry.

## Mozart sonatas: Roman numerals, and what the format does not contain

The choCo conversion of the Mozart piano sonatas is the mirror image of
BiMMuDa/CoCoPops: **harmony only**, no melody, no drums, and no barlines. Each
`.jcrd.json` is one sonata whose `sections[]` holds one entry per *chord span*
(730 in Sonata no. 10), labelled in DCML Roman-numeral notation.
`lib/parsers/parseMozart.ts` reads that grammar:

| Written | Means |
|---|---|
| `I`, `vi`, `viio7` | triads / sevenths by degree |
| `V65`, `V43`, `V2` | figured bass → `voicing.inversion` (1, 2, 3) |
| `ii%65` | half-diminished |
| `CI(97)` | key C, chord I — the parenthesised part is decoration, **not** figures |
| `FV(64)` | local key F (so its V is C) |
| `AV/ii` | key A, then V of ii |
| `V/V/ii` | slash chains read right to left |
| `It6`, `Fr43`, `Ger6` | augmented sixths (chromatic) |
| `Cnan` | Neapolitan (♭II) |
| `F#viio7/vi` | leading tone a semitone under the target (C#dim7 → Dm) |

Two rules the notation forces, both found by checking the corpus's own context
rather than guessing:

- **A parenthesised qualifier is not a figure.** `CI(97)` is a plain C major
  triad; reading "97" as figures turned it into a dominant seventh.
- **A leading-tone chord is a semitone below its target, whatever the scale.**
  Minor keys need this (their diatonic seventh is a whole tone down), and DCML
  writes the raised leading tone as `#viio` only when the diatonic seventh
  would be natural. `degreeRelativeTo`'s flat preference turned B in C minor
  into "♭I", a degree that does not exist, so diminished chords a semitone
  under the tonic are written `vii` instead.

All 553 distinct labels in the 17-sonata corpus now parse; none are skipped.

### What a Roman numeral cannot say

`romanNumeral` names a degree of the *section's* key, so a tonicised chord
loses its meaning: `FV65/V` collapses to "V" and the fact that it is V **of V**
— the whole point of the label — disappears. `Chord.secondaryFunction` records
it: the numeral the chord has inside its local key, the local tonic as a degree
of the section's key, and that tonic's absolute pitch class. The chord's
`root`/`quality`/`voicing` stay absolute, so every planner, export and the
Ableton bridge are untouched; the field is a *reading*, not a second model.

Two details that took checking:

- The numeral must be read **in the local key**, not the sonata key. `Cmin#viio7`
  in F is the leading tone of C minor — `♯vii°/V` — and reading it against F
  would have produced `♯iv°`, which means nothing.
- The DCML label itself goes in `Chord.annotation`, **not** `extendedSuffix`.
  That field is a *chord-symbol suffix* and `chordsToHoneycombText` appends it
  to the numeral before the hex wheel parses it, so a label there corrupted the
  harmony outright: `iv` came out as `iviv`, `I` as `ii`.

Surfaced in the UI: progression cards show `V7/VI`, `vii°/V`, `♯vii°/VI`
(60 of them in Sonata no. 12, 19 % of its chords), and the chord editor shows
`function V6/V` beside `source FV6/V`.

One more fix while looking at it: the card numeral had `uppercase`, a CSS
transform that destroys the case distinction — `vi` (minor) rendered as `VI`
(major), and every diminished chord looked major.

What the format does **not** give us, and the parser therefore refuses to
invent: **barlines** (a chord's length comes from the next onset, because the
converted spans overlap) and **section structure** (the key prefixes are
per-chord interpretations — a cadential `CV(64)` lasts 0.05 s — so treating
them as regions would produce hundreds of one-chord sections). Each sonata
imports as one `Full Sonata` section whose bar count is computed from the
chord timing, with a warning saying exactly that.

Verified through the UI: Sonata no. 14 in C minor → key C aeolian 3/4,
305 chords over 212 bars, opening `i vii° i vii° V7 …`, 82 chromatic chords
flagged.

## Chord qualities carry their intervals

`ChordQuality` used to be ten triads-and-sevenths, and `extendedSuffix` was the
escape hatch for anything richer. That escape hatch did not work: the export
path resolves a chord's *intervals* from `chord.quality`
(`styleQualityFor` → `getChordIntervals`), and `getChordIntervals` knew only
those ten. A chord authored as `C7#9` therefore displayed as `C7#9` and
**played as a plain `C7`** — the richer the symbol, the more silently wrong the
export.

The vocabulary is now 34 qualities, and every one of them is a row in
`CHORD_INTERVALS`, so a quality name *is* its interval set:

| group | qualities |
| --- | --- |
| triads | `maj` `min` `dim` `aug` `5` `sus2` `sus4` |
| sevenths & sixths | `7` `maj7` `min7` `m7b5` `dim7` `mMaj7` `6` `min6` `69` `add9` |
| altered dominants | `7b9` `7#9` `7#11` `7b13` `7b5` `7#5` `7sus4` `maj7#5` |
| extended (9·11·13) | `9` `maj9` `min9` `11` `min11` `13` `maj13` `min13` `9sus4` |

Upper extensions are stored above the octave (14 = 9, 17 = 11, 21 = 13), so the
stack stays root-anchored and `voiceChord` inverts a `maj13` the same way it
inverts a triad. The five- and six-note qualities are the point of the
exercise: `Cmaj9` exports five notes, `C13` six, and `planChordStem`'s tests
pin both.

Three rules keep this from drifting back apart:

- **`CHORD_INTERVALS`, `CHORD_QUALITY_SUFFIX` and `CHORD_QUALITY_GROUPS` are
  all `Record<ChordQuality, …>`**, so adding a quality is a compile error until
  it has intervals, a display symbol (that round-trips through
  `parseChordQuality`) and a place in the editor's chips.
- **`parseChordQuality` is the only suffix parser.** `parseChordName`,
  `honeycombTextToChords` and the importers all delegate to it, so `m7`, `min7`,
  `-7`, `Δ7`, `M7`, `ø`, `°7`, `+` and `6/9` mean one thing everywhere.
  `ChordQuality`'s `min`-prefixed keys (`min9`) versus their symbols (`m9`) are
  deliberately different strings: keys are the model, symbols are what a player
  writes. `qualityLabel` renders the second from the first.
- **`extendedSuffix` survives only for suffixes the vocabulary cannot hold**
  (e.g. `7#9b13`). Those keep the base quality's intervals on export — a
  documented limitation, not a silent one, and pinned by a test.

In the Harmony view the chips are grouped the same way: triads and sevenths are
always visible, and 9·11·13 plus the altered dominants sit behind a
`+ 9 · 11 · 13 · altered` toggle so the dock keeps its height — unless the
selected chord is already one of them, in which case that group renders so the
row never hides its own state.

## MusicXML import: iReal Pro charts

The iReal Pro *MusicXML* export — not its native `irealb://` string — is the
import path, because it carries three things the compact format makes you
reconstruct: real barlines (so a chord's length is measured, not inferred),
the exact symbol in `<kind text="7b9">`, and per-bar meter changes. The trade
is bulk and the fact that iReal writes **rests instead of notes**: an export
is a chord chart, so there is no melody to extract, only harmony and form.

Two structural facts decide the whole parser
(`lib/parsers/parseMusicXml.ts`):

- **A `<harmony>` is a label at a position, not a duration.** The rest or note
  after it advances the bar's clock, so a chord runs until the next harmony or
  the bar line. The file is therefore walked in document order — `preserveOrder`
  in fast-xml-parser exists precisely for this, since a key/value parse loses
  the interleaving of `<harmony>` and `<note>` and with it every chord length.
- **The written chart is not the played form.** iReal writes "D.S. al Coda"
  as text and expects the reader to jump. A timeline cannot leave that to the
  reader, so `planMeasureOrder` expands the marks into the order the bars
  actually sound: play to the D.S. bar, jump to the segno, come out at the coda
  sign, then play the coda. Barline repeats and 1st/2nd endings are expanded
  the same way (the bracket after the repeat bar belongs to the *second* pass).

A second pass over a section is an `ArrangementRepeat` with `overrides`
(`bars` + `chords`), never a duplicated section — the same reasoning that
made `arrangement` key by `sectionId` in the first place. A pass is "exact"
only when it covers the section's own bars *in order*; a 1st/2nd ending can be
the same length as its sibling and still be different bars, so length alone
never decides whether an override is needed.

Sections come from `<rehearsal>`, plus a coda sign *after* the D.S. (iReal
writes the coda as its own passage but doesn't always name it). Chords map
through the same `parseChordQuality` as everything else, so `<kind text="7b9">`
lands on a real `7b9` quality and `<degree>` alterations fold into the symbol
(`add9`). A `<bass>` that is one of the chord's own tones becomes an
**inversion** — `Dm/A` really is D minor's second inversion — and one that
isn't (`G7/A`) stays a label with a warning, because the model has no
walking-bass note.

Verified against a real export (24 bars, 35 harmonies, four chords in one
2/4 bar, meter changing 4/4 → 2/4 → 4/4 twice, `D.S. al Coda`, segno on bar 2,
coda sign on bar 11, coda bars 23–24): four sections `intro · A · B · Coda`,
and the played form `intro, A, B, A (bars 1–9), Coda`.

What it refuses to invent, and says so in `provenance.warnings`:

- **Tempo** — iReal stores none (it practises at a global tempo), so 120 BPM is
  a default, not an extraction.
- **One meter per section, declared** — a section that changes meter carries
  the opening meter in `timeSignatureNumerator/DenPower` plus a `meterMap`
  of the changes (see *Per-bar meter* below), so its length is right and
  every change is reported by bar.
- **Melody** — the export is rests.
- **`.mxl`** (zipped MusicXML) is not read; only plain `.musicxml`/`.xml`.

### Export: iReal's own dialect

Import stays MusicXML (above). **Export** goes out in iReal's native dialect,
because that is the only thing iReal Pro can read: a `irealb://` URL carrying
`title=composer=style=key=…=music=…=bpm=repeats`, inside the `.html` playlist
skeleton iReal's own exporter writes (`lib/ireal/`, surfaced as *iReal chart*
on the Rehearse desk).

The chord string is undocumented, so the writer is built from a real export
whose MusicXML gave the ground truth, and a reader for the same dialect lives
beside it — the two are tested by round trip rather than by hope. What the
sample settled:

- `*A` sections, `T44` meter, `|` bars, `{ }` repeat brackets, `Z` final bar.
- A chord on beat 1 owns the bar: `C^7XyQ`. A chord that arrives later is
  separated from the previous one by the distance it moved — one beat is `,`,
  two beats are a space, three are `, ` — and the bar closes with a trailing
  comma (`G7,W/A,W/B,W/G,`).
- The music string is obfuscated in 50-character blocks (first five swap with
  the last five, 10–23 swap with 39–26). The swap is its own inverse, so the
  same routine unscrambles.

Re-encoding a decoded real chart reproduces the same bars and chords; the
differences are only compression (iReal writes `Kcl` for a repeated bar and
brackets endings) and navigation (`D.S. al Coda`, segno, coda), which this
side expands into literal bars on import and therefore writes out longhand.
Melody, lyrics, drum/bass/colour instrumentation and performance effects do
not cross over, and the desk says so when it writes the file instead of
pretending they made it.

## Per-bar meter

`BlueprintSection.meterMap` is a list of `{ bar, numerator, denominator }`
changes. Absent — every song written before the field — the section is
`bars × beatsPerBar` exactly as it always was; present, the map decides how
long each bar is and the declared meter only describes the opening bar.

Why it exists: the MIDI importer used to take the *last* time signature in a
file for the whole song, which misread bar counts by up to 500 % on the Zappa
corpus (`Nanook Rubs It` imported as 653 bars instead of 109). Even
"most common meter" misses by 96 %, so no single-meter heuristic is good
enough for a chart that changes meter — the map is the only honest answer.

The helpers in `@music-theory/song-blueprint` are the whole API:

- `barLengths(section)` — one entry per bar.
- `sectionDurationBeats(section)` — the sum, so everything downstream (chord
  occurrences, section spans, both export paths) inherits the right length.
- `barAtBeat` / `beatAtBar` — convert across a change.
- `meanBeatsPerBar(section)` — the *average* bar, for display maths where the
  bars are drawn evenly (the Harmony cycle readout, the spine's bar↔beat seek).
- `meterForLength(beats)` — 3.5 → 7/8, so anything that only knows a bar's
  length can get its meter back.

Three consumers needed real work rather than a formula swap:

- **Section spans** accumulate `startBar` instead of dividing beats by one
  meter — a 3/4 section followed by a 4/4 one used to misplace the second
  section's bar origin.
- **The bridge** no longer duplicates the duration formula; it imports the
  shared helper, so app == bridge by construction. `parity.test.ts` carries a
  mixed-meter fixture so a drift shows up as notes a beat apart.
- **Drums**: `planSectionDrumNotes` takes `barBeats` plus a `meterVariants`
  map keyed by bar length, and restarts the groove at each new bar length
  with that length's own variant — a 4/4 pattern is not chopped at 3.5 beats
  when the chart drops to 7/8. Absent `barBeats`, the tiling path is the old
  one, unchanged.

It is editable: **Meter** in the Harmony dock lists the changes with their bar
spans and a numerator/denominator stepper each, adds a change one bar after
the last, and drops the map back to a single meter. A map that ends up with
one change is cleared rather than stored, because one change is just the
declared meter said twice.

Both importers write it: MusicXML from its per-measure `<time>` changes, MIDI
from its deduped time-signature events (ignoring events that sit past the last
note — a stray tail, as in `WildLove`, must not stretch the song).

Still open: the bars inside a mapped section are drawn evenly, so the ruler
shows the right bar *count* and total width but not the exact per-bar
spacing; and `drumBlocks` an importer wrote are absolute and exact, while a
generated groove follows the map only bar-by-bar (its fills and transitions
still treat the section as one gesture).

## Lyrics lookups: matching, not just searching

LRCLIB is queried on every import (`parseFile → enrichWithLrclib →
searchLrclib`), and the API is reachable straight from the browser
(`access-control-allow-origin: *`), so no proxy is involved. What was wrong was
the *choosing*: the old code took the first result that happened to carry
`syncedLyrics`, with no check that it was the same song.

On a pop catalogue that mostly works. On the corpora this app imports it is
actively harmful — "Piano Sonata no. 14 in C minor" matches *something*, and
attaching a stranger's words is worse than attaching none.
`lib/lyrics/lrclibMatch.ts` applies the rules the offline scripts already used,
plus one the app needs:

| Rule | Why |
|---|---|
| Normalise both titles (case, punctuation, brackets, accents, "the", "feat.") | `Help` must match `Help - Help!` |
| Require ≥0.86 title agreement | rejects "Help Me" for "Help" |
| Require the artist when one is known, ignore it when it reads "Unknown Artist" | corpora ship unknown artists |
| Require durations within 12 s, preferring the closest | a cover is not the record |
| **Refuse instrumentals outright** | a Mozart sonata has no words, however good the match |

Measured against the live API:

| Query | Old behaviour | Now |
|---|---|---|
| Help / The Beatles | first synced result | `Help - Help!`, synced, 139 s |
| Dancing Queen / ABBA | first synced result | `Dancing Queen`, synced, 233 s |
| Piano Sonata no. 14 in C minor | would attach *some* lyrics | **no match** |

### Corpus file names carry the metadata

CoCoPops names files `<Artist>_<TitleInCamelCase>_<Year>.mid`, and the importer
used to turn that into the title "ABBA DancingQueen 1976" — unfindable by any
lyrics search. `lib/parsers/corpusFileName.ts` splits it into
`Al Green / Lets Stay Together Part 2 / 1972` when the last part is a
four-digit year, and leaves ordinary names (`My Song.mid`) untouched. Combined
with the matcher, a CoCoPops import now finds its real lyrics: Dancing Queen
comes in as **ABBA – "Dancing Queen" with 29 timed lines**.

One bug surfaced along the way: attaching lyrics could make
`autoSectionFromRepeats` carve a one-line "chorus", which left a stray extra
section beside the original and inflated the song's bar count. The split now
requires a block of at least four lines, and the arrangement is rebuilt in
document order so no section can be orphaned from it.
