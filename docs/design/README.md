# Design — shared design loop

**The surface:** `/design-lab` (the old `/ui-kit-sandbox` link redirects there).
Source: `apps/trackdraft/src/pages/DesignLab.tsx`.

Hands-on in the browser, assisted by Copilot in chat:

1. **Play.** The page renders the *current* code — real tokens, verbatim button
   recipes, real density patterns. Hot reload means it always matches the app.
2. **React out loud.** Tell Copilot in chat, referencing the section + specimen
   ("amber should be the main accent", "primary button #2 but roomier",
   "keep the flat tabs"). The page's decision log IDs (D1–D6) are handy shorthand.
3. **It gets baked in.** Copilot turns decisions into real components (primitives
   land in `apps/trackdraft/src/components/common/`), updates the Design Lab to show
   the new state, and moves the decision's status.
4. **Repeat.** App-wide decisions get mirrored into `docs/ui-standardization.md §9`
   and the audit doc's counters re-run when they move.

## What lives where

| Artifact | Purpose |
|---|---|
| `/design-lab` | Hands-on surface + the **design decisions log** (D1–D6 today) |
| `docs/ui-audit.md` | Measured inventory of the UI (numbered findings, regeneration greps) |
| `docs/ui-standardization.md` | The constitution: principles, taxonomy, phases, definition of done |
| `docs/design/` | This note + design history/prototypes (the `newview.html` prototype lives at `docs/design/prototypes/newview.html`) |

## Ground rules

- The lab shows only what **exists** or is explicitly marked a candidate — no aspiration mockups.
- Every specimen cites its source file so feedback is unambiguous.
- Design changes land as small scoped commits; behavior suites (bridge parity, import
  tests, generators) stay green — they're the safety net that lets design move fast.
