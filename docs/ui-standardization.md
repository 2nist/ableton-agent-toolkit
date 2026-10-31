# TrackDraft UI standardization — the 10,000-ft view

**Status:** concept & decision document — no code lives here. Companion to
`docs/ui-audit.md` (the inventory; every counter referenced below comes from it).
Audit = *what exists*. This = *how it should all be organized, standardized, and
polished*. The phases at the end are executed against this document, one slice at a time.

---

## Progress — 2026-10-30 (pre-beta unification pass)

Landed, verified (tsc clean · 1671 tests green · production build clean):

- **P8 keyboard baseline is now real.** `hooks/useGlobalKeys.ts` is the one
  registry: a priority stack (overlay → surface → shell), one `keydown`
  listener, first handler that returns `true` consumes the event. Twelve ad-hoc
  listeners became three — the registry, `Modal`'s capture-phase focus trap, and
  the Shift-modifier tracker in `DrumBlocksView` (state, not a command).
  `useGlobalKeys.test.ts` pins the arbitration. This closed a live bug: the
  spine and the drums editor both claimed `Escape`.
- **`MicroLabel` is adopted** (the §2 T1 queue's top item): 18 sites in 9 files,
  with `size` (3xs/2xs), `as`, `className` and `title` — the same shape that made
  `TapeLabel` stick at 28 files. The literal recipe now appears zero times.
- **One time axis.** `ArrangementTimeline` reads `timeViewportStore` and is
  bar-linear; its private `PX_PER_BEAT = 2` + 64px floor (which let a 1-bar intro
  and a 4-bar verse draw the same width) are gone. Proportions are exact at every
  zoom level, and the spine's zoom now moves both surfaces.
- **One clock.** `lib/time/clock.ts#secondsPerBeat` replaces six hand-written
  `60 / bpm`. `lib/scales.ts#SCALES` replaces four copies of the mode list.
- **One drum write path.** `writeDrumSection()` in `drumsDraftStore.ts` owns
  "clear the staged draft, then write" — five scattered `clearDraft()` calls
  dropped to three legitimate ones (bulk write, revert, section change).
- **Six dead components deleted** (1,125 lines: `SelectionWorkbench`,
  `SelectionPad`, `MelodyPianoRoll`, `ChordCard`, `SectionMarker`,
  `FloatingToolbar`) plus the dead `common/index.ts` barrel. The Puck registry
  is now an explicit allow-list (`src/puck.manifest.ts`) instead of a directory
  scan, so a component nothing imports can no longer acquire a fake consumer.
- **Harmony "form" tool fixed.** It was a drawer value with no renderer: it
  opened an empty overlay mislabelled "Harmonic rhythm" on top of the form
  segments it was supposed to reveal. It is now a floor annotation toggle, and
  the drawer titles come from a `Record` instead of a ternary chain.
- **Dashboard header unified** into `DashboardHeader` (the two copies had drifted
  and the wordmark painted under the theme toggle below ~1100px). The four lab
  links moved to Settings, where the workspace doc already says labs live.
- **Persistence has one registry.** `lib/persistence/keys.ts` declares every
  durable key with a **scope** (`song` · `device` · `ui` · `lab`) and an owner;
  all 25 call sites now import from it instead of re-typing a string.
  `keys.test.ts` fails if a `"trackdraft-*"` literal appears anywhere else, so a
  new key cannot be added without deciding what kind of state it is. The §5
  table below is now generated from the same decisions.
- **`KeySelector` was dead** (no live consumer, only the sandbox registry) and is
  deleted — the workbench's `SongSettingsStrip` is the one key/scale/tempo
  editor. `EmptyState` (unused primitive) removed too. The manifest comment now
  separates real product surfaces from the three T1 primitives (`Select`,
  `TextField`, `Modal`) that live in the sandbox on purpose.
- **"3D" no longer means two things**: the floor's camera preset is **tilt**
  (`front · tilt · top`) and the study desk's `HarmonyScene` mode is **Orbit**.
- **Harmony lost a whole chrome band.** The desk switcher owned its own
  full-width bordered row above every desk — 31px, a "Harmony" label repeating
  the left rail, and a permanent sentence of instructional copy. It is now
  `HarmonyDeskSwitch`, injecting as the **first control of each desk's own
  toolbar row** (the `leading` prop on `HarmonyDeskProps`), with the sentence
  moved into the option tooltips. Verified: the compose row now reads
  `COMPOSE REHEARSE STUDY · TONIC D aeolian · SECTION Intro …` on one line, the
  canvas gained 33px, and the switch stays reachable in all three multi-select
  branches.
- **Multi-section bands render `compact`.** Every band in the strip used to be
  a full `ComposeDesk` — complete toolbar, foot band and footer — inside a
  ~200px column, so `7 bars` collided with `RHYTHM`, `Root` overlapped
  `Walking`, and the 118px foot band covered a third of the plate. A band is
  now its header plus the floor (308px each, measured); per-section tools belong
  to the focused section, which the band header switches to. `compact` threads
  `ComposeDesk → ProgressionFloor`, where it zeroes the foot height so the scene
  fit reclaims the space instead of leaving a hole.
- **Chord lenses have one host.** `ChordSurface` owns the three views that open
  over the floor (map · rhythm · midi) and the one table that describes them
  (`CHORD_VIEWS`). Before, they were a hand-written enum in `ComposeDesk`, a
  label ternary, and ~90 lines of conditional JSX — which is how `form` ended up
  as a "view" with no renderer. Its contract is a `Pick<>` of the desk props, so
  a lens physically cannot be handed section-splitting verbs. The open lens is
  now persisted (`trackdraft-harmony-chord-view`), which removes the old
  asymmetry where the desk survived a reload and the lens didn't.
- **`Segmented` extracted** — the app's most repeated control. Twelve
  `flex overflow-hidden rounded border` groups with identical `aria-pressed`
  wiring were written by hand; the harmony toolbar's BARS / PLACE / VIEW rows and
  the desk switch now share one component with two documented sizes. This is
  deliberately a *group* primitive, not a generic `<Button>`: 404 of 413 buttons
  are multi-line JSX with per-site structure, so there is no honest bulk
  conversion for them, and a regex sweep is how tag-pairing gets broken (it was,
  once, during the `MicroLabel` pass).

---

## 0. Product posture

**Identity:** a songwriting cockpit that behaves like one piece of studio hardware —
**one instrument with six stations**, not six pages behind a menu.

**Feel words** (already true in the best parts of the app — make them true everywhere):

- **Cockpit, not dashboard.** Dense, mono micro-labels, everything reachable, nothing
  decorative. The user is operating, not browsing.
- **Suggestive, not bossy.** The app may know things the user doesn't (detected style,
  borrowed chords). It shows them; it never applies them. ◆ is the mark.
- **Derived, not stored.** The UI computes from the song wherever it can. What's stored
  is authored (the song) or ephemeral (selection, drafts). Nothing in between.

**Strengths to protect** (the overhaul must not sand these off — they're why the app
already feels good in places):

1. The dock grammar with auto-focus (`setTools` comes up with a selection).
2. The ◆ suggest-don't-impose pattern (`BendPanel` ghosts, `ModeInferenceCard`).
3. `font-mono` micro-labels + tight radius + `ABLETON_DARK` tokens.
4. Derived-state discipline (chord function/color computed from numerals; suggestions
   recomputed, evaporating when wrong).
5. The test culture: bridge parity, `applySongMap`, import whitelist, generators — UI
   work must keep those suites green (they've caught real bugs twice this month).

**Strategic frame** (from the project direction): the React app is the *design spec* for
any eventual native/JUCE build. Everything standardized here — taxonomy, tokens,
interaction contracts — is exactly what would port. "Complete picture first" is the gate;
this document defines what *complete* means (§8).

---

## 1. Principles (the constitution)

**P1 — Tokens are the only color source, and they are runtime.**
Classes use token names, and every token resolves to a CSS variable
(`rgb(var(--c-*) / <alpha-value>)`, so opacity modifiers still work). A theme is a
block of channel triples in `theme/themes.css`; nothing in a component knows which
theme is on. Canvas/SVG draw code can't use classes, so it reads the same values as
strings from `theme/palette.ts` via `usePalette()` — never an inline literal.
*Test:* zero raw hex in class strings; hex lives only in `themes.css` and
`theme/palette.ts`, and `palette.test.ts` fails if the two disagree.

**P2 — One type scale, one label recipe.**
`text-2xs`/`text-3xs`/`text-xs/text-sm` + the mono micro-label recipe
(mono · uppercase · tracking-wider · inkMuted) for panel titles, axis labels, metadata.
Numbers use tabular-nums. Bracketed pixel sizes are retired.
*Test:* zero `text-[Npx]`; every panel header matches the recipe.

**P3 — Every song tab is a station; grammar or documented exception.**
A station = canvas + dock relationship (bottom bar and/or right sidebar) with the four
panel roles (info/primary/tools/layers). A tab that deviates carries a one-paragraph
header comment explaining why.
*Test:* each of the six tabs either registers dock content or has its exception note.

**P4 — Primitives before patterns, patterns before pages. The two-consumer rule.**
Nothing moves into the shared tier until a second consumer exists — but once it does,
duplication is a bug. (This is the repo's own documented ethos: no speculative
indirection, no premature abstraction.)
*Test:* the audit's duplication list (§2 queue) drains; no new third copy of anything.

**P5 — Suggest, don't impose. ◆**
Features that derive knowledge show it as a ghost with an explicit **adopt**; nothing
auto-applies; suggestions are recomputed from state and vanish when no longer true;
dismissals persist deliberately (per-song acks), never accidentally.
*Test:* any new "the app knows better" feature cites this pattern or argues why not.

**P6 — Derived over stored. Song is authored-only. Selection is session-only.**
UI state never enters `BlueprintSong`. Selection lives in `use<Domain>SelectionStore`.
Drafts (staged edits, e.g. drums) live in `use<Domain>DraftStore`. Persistence is for
durable config only (§5 table).
*Test:* the persisted-keys table in §5 is the complete list; nothing else writes storage.

**P7 — One confirm mechanism; undo beats confirmation.**
Destructive flows (replace template, replace progression) confirm exactly once through
the standard modal — never `window.confirm`. Everything reversible is undoable instead
of confirmed.
*Test:* zero native `confirm()`; every modal routes through the same shell.

**P8 — Keyboard baseline, through one registry.**
`Esc` closes the topmost overlay · `Space` toggles transport (when not typing) ·
`Cmd/Ctrl+Z / Shift+Cmd/Ctrl+Z` undo/redo. One `useGlobalKeys` mechanism; stations don't
each invent listeners. Beyond the baseline, keyboard is deliberately not first-class
(nothing more until the baseline is universal).
*Test:* the two ad-hoc global listeners become one; baseline works on every tab.

**P9 — Design artifacts stay curated.**
Prototypes, mockups, and design history live in `docs/design/` (or `archive/`), never in
`src/`. `newview.html` is the founding example.

---

## 2. Component taxonomy — the org chart

Four tiers + one shell. The rule between tiers is **P4's two-consumer promotion**.

| Tier | Definition | Target contents | Home (v1) |
|---|---|---|---|
| **T0 — Tokens** | Color / type / space / radius / motion as CSS vars + TS constants | `ABLETON_DARK` mapping (exists) · voice palette · deep-canvas fills · accent/substitution/secondary semantics | `@platform/ui-kit` (exists) + app `theme.ts` |
| **T1 — Primitives** | Dumb, stateless, zero domain vocabulary | Button (primary/secondary/ghost/danger) · IconButton · Input · NumberField · Select · Checkbox · Slider (row wrapper) · Chip · Modal shell (+Confirm) · Popover · Dropdown · Tooltip · MicroLabel · EmptyState · PanelHeader | `apps/trackdraft/src/components/common/` |
| **T2 — Widgets** | Domain-flavored pieces with **≥2 consumers** | SliderRow (label/lo-hi/◆ ghost — BendPanel's `AxisSlider` is the mold) · Block (titled panel w/ hint) · StepGrid · NecklaceRow (already shared ✓) · ChordChip/Card · MeterOutline editor · ConfidenceDot · TransportButton · DockPanel section | `components/common/` when generic; stays in domain folder until second consumer |
| **T3 — Stations** | The six tab views + dashboard + popout | Studio · Structure · Harmony · Drums · Lyrics · Melody · Dashboard · Popout | `components/<domain>/` (folders as today) |
| **T4 — Shell** | The frame everything sits in | `SongEditorLayout` · dock host · routes · header transport | `components/layout/`, `components/dashboard/` |

**T1 extraction queue** (from the audit's duplication list — each already has 3+ copies
in the wild):
`Button` (238 sites, ~6 ad-hoc recipes) → `Select` (12 files) → `Modal shell` (4 overlays)
→ `Chip` (the drums "active chip" string ×4 files) → `Slider`/`SliderRow` → `Checkbox` →
`MicroLabel` (34 files use the recipe; none shares the code) → `EmptyState` (every station
improvises) → `Confirm` (3 `confirm()` calls) → `Dropdown` (ExportMenu) → `Popover`
(ChordEditorPopover).

**T2 extraction queue**: `SliderRow`+◆ghost (BendPanel → any detection-driven UI),
`Block`, `StepGrid` (DrumPatternTools + DrumBlocksView + MelodyPianoRoll share the
concept), `DockPanel` chrome (Harmony/Lyrics/Drum dock tools all hand-roll the same
section header).

---

## 3. Layout grammar

### The song shell

```
┌ header ───────────────────────────────────────────────┐
│ back · title · key/bpm · transport · undo/redo · export │
├ tabs ──────────────────────────────────────────────────┤
│ Studio · Structure · Harmony · Drums · Lyrics · Melody  │
├ station canvas ───────────────────────────┬ dock (opt)  │
│                                           │ info        │
│                                           │ primary     │
│                                           │ tools       │
│                                           │ layers      │
└───────────────────────────────────────────┴─────────────┘
```

**Dock placement, made canonical:**

- **Bottom bar** is the default home for every station's panels; **right sidebar** is
  reserved for workflows where the canvas is a list or needs full width and the tools
  sit beside it.
- Current dispositions to keep (each with an expected header comment):
  - **Structure** → right sidebar (canvas is a vertical list; side tools fit the
    ergonomics) — documented exception to "bottom default".
  - **Harmony** → bottom dock **and** right sidebar for Tools (two tool families, kept).
  - **Studio** → no dock; the console/timeline occupy the lower band — documented
    exception.
  - **Drums / Lyrics / Melody** → bottom bar (Melody to *register* content or gain the
    documented exception; today its bar is info-only).
- **`info` is universal**: `SongInfoPanel` stays the info panel on every station it fits.

### Dashboard

Grammar: sidebar (mode switch + directories + import targets) · header (links, counts,
legend) · action bar · filter bar · main (table or gallery). Keep it; add nothing new
until stations are done.

### Overlays

One mechanism, four placement variants, all from the T1 Modal shell:
**center dialog** (DirSetup, Confirm) · **large editor** (SelectionEditorModal) ·
**side sheet** (MidiSetupPanel) · **floating** (Popover/Dropdown, non-modal).
Focus trap + Esc + scrim-click rules defined once in the shell.

### Popout

Treat as a **read-only station variant**: it shares T2 widgets (ChordStrip, LyricsBlock)
with the Lyrics/Harmony stations rather than re-implementing rendering.

---

## 4. Interaction conventions

**The ◆ contract** (codify so future features inherit it):

- *Ghost state*: derived value shown next to the live control (marker + value), never
  touching it.
- *Adopt*: explicit click → one undoable write. Adopted state is visually quieter.
- *Dismissal*: "keep as-is" persists as a deliberate ack (per song / per section — the
  `blueprintAcks` model), never re-asking the same question.
- *Evaporation*: suggestions are recomputed from state; fixing the cause removes the
  suggestion with no cleanup.

**Selection drives tools.** The drums pattern ("the workbench comes up *with* a
selection, goes away with it") generalizes: stations surface contextual tools on
selection, not on a separate "edit mode".

**Undo.** Song-level history stays the only global undo. Local staging uses **draft
stores** (the drums pattern) — staged edits commit explicitly. No new undo stacks.

**Destructive copy.** One voice: short, factual, names what changes
("Replace all sections with the 'Math Rock (7/8)' template?"). Modal, not browser
confirm; primary action is the destructive one only when genuinely expected.

**Empty states.** Every station's empty state = one line of guidance + the exact action
word from the UI that fixes it ("No melody yet — hum one in the Melody tab." is the
model).

---

## 5. Naming & state conventions

**Vocabulary** (words the docs and code should share):

- **Station** = a tab-level view. **Panel** = a dock section. **Block** = a titled
  canvas region. **Ghost** = the ◆ suggestion overlay. **Adopt** = committing a ghost.
- File naming: stations keep `*View` (rename to `*Station` is *not* worth the churn —
  vocabulary only). Shell = `*Layout`. Primitives = bare nouns (`Button.tsx`). Modals =
  `*Modal.tsx`.

**Stores**: `use<Domain>Store` · selection = `use<Domain>SelectionStore` · drafts =
`use<Domain>DraftStore`. Persistence only via `store/storage.ts` helpers.

**The persisted-keys registry is the complete list of durable state**
(`apps/trackdraft/src/lib/persistence/keys.ts` — 26 keys: 6 `song` (one of them
the desktop library mirror), 7 `device`, 12 `ui`, 1 `lab`).

It is enforced, not aspirational: `keys.test.ts` fails if a `"trackdraft-*"`
literal appears anywhere outside the registry, so adding a key forces the
scope decision. What the scope means:

| Scope | Rule | Cost of losing it |
|---|---|---|
| `song` | belongs to the music; travels with the library | **data loss** |
| `device` | per-machine setup (ports, folders, clock, theme) | re-setup once |
| `ui` | a view preference (zoom, open drawer, chosen tab) | an annoyance |
| `lab` | design surfaces outside the songwriting loop | nothing |

The `ui` row is the one to watch: twelve keys is a lot of durable view state,
and any of them that starts holding something you would *miss* has been filed in
the wrong scope. Anything genuinely authored belongs in `BlueprintSong`, not
here.

**New song-field checklist** (any schema addition, enforced by the existing test):
schema (`song-blueprint`) → rebuild → `parseImportedSong` whitelist + `exportImport.test.ts`
→ song-mcp schema if agent-facing → (if analysis-derived) `detect-bend`. This checklist
exists because two fields have already been silently dropped on import.

---

## 6. The one architecture decision: where do shared components live?

**Context.** `@platform/ui-kit` today = tokens + host bridge, deliberately
framework-agnostic, because it serves two hosts: the React app (consumes tokens via
Tailwind — already true) and vanilla webviews in extensions (drum-studio, etc. —
consume tokens directly). The app has **no** component layer at all.

**The options:**

- **A. Web Components in ui-kit** — one kit for both hosts. Maximum reuse *if* the
  webviews grow real UI; taxes every app component with WC interop, shadow-DOM styling,
  and an unfamiliar DX in a React codebase.
- **B. Tokens shared; idiomatic layers per host** — tokens stay the cross-host contract
  (already are). React primitives live in the app (`components/common/`). Webview
  controls get minimal vanilla twins *only when actually needed* (the two-consumer rule
  applied across hosts).
- **C. React everywhere** — webviews adopt React or keep bespoke UI; no cross-host
  sharing ambition at all.

**Recommendation: B.** Because: (1) React is where 95% of the UI lives and iterates
fastest — the canonical layer should be there; (2) the webview modals are small and few:
duplicating a button/select is cheaper than imposing a WC architecture app-wide;
(3) the eventual native-port story is unchanged — the React component inventory is the
spec, and it's the *inventory* that matters, not the runtime; (4) it matches the repo's
"no speculative indirection" ethos.

**Promotion trigger** (pre-committed, so it isn't relitigated): if a **second React
consumer** needs the same primitives — `apps/devkit`, or a new app — promote T1 to
`@platform/ui-react` *then*. If the **webview** UI ever needs more than a handful of
matching controls, revisit option A *then*, with real requirements.

---

## 7. Phases — working our way down

Concept-level; each phase names its exit test. One writer per area (two agents editing
the same files has already cost us one swept-in commit — keep adds scoped).

**Phase 0 — settle the constitution.** This doc + the audit live in `docs/`; the user
decides §9. No code.

**Phase 1 — T0 + T1 foundation + mechanical drift.**
Palette module (accent, substitution orange, deep fills, six voice colors — single
source, theme-aware via `usePalette()`); primitives v1 (Button, IconButton, Input/NumberField, Select, Checkbox, Chip,
SliderRow, Modal + Confirm, MicroLabel, EmptyState); migrate the countable drift
(4 accent bracket classes, ~15 active-chip strings, 11 `rounded-lg`, 159 bracket fonts,
3 `confirm()` calls).
*Exit:* audit counters for drift hit zero; no behavior change (parity suites green).

**Phase 2 — T2 widgets + dock completion.**
Extract the two-consumer widgets; canonical DockPanel chrome; Melody registers dock
content (or documents its exception); Studio/Structure exception comments land.
*Exit:* every station conforms or is annotated; dock chrome is one implementation.

**Phase 3 — station-by-station polish, heaviest first.**
**Drums** (split `DrumBlocksView` 1,574 / `DrumPatternTools` 1,091 / `DrumsView` 950
into blocks + lanes + tools + workbench, behind the unchanged public behavior), then
**Harmony**, then **Studio**; each station gets the same checklist: primitives adopted,
keyboard baseline, empty states, destructive-copy voice, density pass.
*Exit:* no component file above the agreed monolith threshold; drums share of UI LOC
falls from 35%.

**Phase 4 — finish the picture.**
Remaining in-flight features land *inside* the new grammar: effect-lane polish,
per-section modulation edit UX, hex tap semantics review, mode-inference placement, the
popout's shared rendering. This phase ends when the feature set is frozen — the
"complete picture" the native-port decision waits on.

**Phase 5 — hardening + the gate.**
A11y pass on the new primitives (focus, contrast, ARIA); performance on the drums
canvas; visual/primitive tests; final audit re-run. **This is the gate:** when §8 is
green, the React app IS the spec and the JUCE/Tracktion conversation can begin with
something worth porting.

---

## 8. Definition of done (the counters)

The overhaul is done when the audit's regeneration commands report:

- **0** raw hex in class strings; hex exists only in the palette module (+ its ui-kit
  source).
- **0** `text-[Npx]`; **0** `rounded-lg` remnants.
- Every station: dock-registered or exception-annotated.
- All 4 overlays + popover/dropdown route through the T1 shell; **0** native `confirm()`.
- **1** keyboard registry; Esc/Space/Undo baseline works on every tab.
- No component file above the agreed threshold (proposed: **~800 LOC**); no domain above
  ~25% of UI LOC.
- Audit re-run is green; all parity/behavior suites unchanged and passing.
- `newview.html` relocated from `src/`; design artifacts have a home.

And the qualitative finish: a new feature can be described as *"a Block with a SliderRow
and a ◆ ghost in the Drums station"* — and that sentence builds itself.

---

## 9. Open decisions (user's call)

1. **ui-kit direction** — recommend **B** (§6); this unlocks Phase 1.
2. **Monolith threshold** — proposed ~800 LOC; and appetite for the drums split in
   Phase 3 (recommend: yes, it's 35% of the UI).
3. **Keyboard posture** — minimal global baseline via one registry (recommend), or
   explicit "keyboard is not first-class" (also defensible; the app is mouse-first by
   design today).
4. **`*View` → `*Station` rename** — recommend keep names, vocabulary only.
5. ~~**`newview.html` destination**~~ — **resolved 2026-10-17:** moved to
   `docs/design/prototypes/newview.html` (the v3 design record, out of `src/`).

---

## Appendix — audit findings → disposition

| Audit §7 finding | Disposition |
|---|---|
| 1. Token drift countable (accent/fonts/radius) | P1, P2 — Phase 1 mechanical pass |
| 2. Draw code needs shared constants | P1 — palette module (§7 P1) |
| 3. Voice palette duplicated 4+×; source is a prototype HTML | T0 palette module; P9 relocation |
| 4. Drums = 35% of UI | Phase 3 (first), §9.2 threshold |
| 5. No primitives layer | §2 T1 extraction queue; §6 decision |
| 6. Dock grammar varies | P3 — §3 canonical + exceptions |
| 7. ◆ pattern uncodified | P5 — §4 contract |
| 8. No shortcut layer | P8 — §4 baseline |
| 9. Inline styles 76 (mostly deserved) | P1 — static ones to tokens; dynamic ones keep + document |
| 10. font-mono de-facto standard | P2 — promote to explicit recipe |
| 11. Selection-store pattern consistent | P6 — §5 conventions |
| 12. Prototype artifacts in src | P9 — §3/§9.5 |
