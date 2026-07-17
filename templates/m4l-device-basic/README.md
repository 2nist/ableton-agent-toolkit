# m4l-device-basic template

`reference.amxd` is hand-authored inside Max (launched through Live, never standalone — see `docs/m4l-scaffolding-risk.md`), not generated. If it ever needs to change shape (more inlets, different wiring), edit it the same way: through Live's Max for Live device editor, save, done. Don't hand-edit the binary file or try to synthesize one from scratch.

Includes a `loadbang` → `nonstandardoutletcalls 1` message → `jweb` wire that looks incidental but isn't: without it, `jweb` silently drops every custom message sent via `window.max.outlet()` from the page's JS, while still emitting its own built-in status messages fine. Don't remove this wire when editing — see `docs/m4l-scaffolding-risk.md` for the full story of why it's there and why it can't just be a saved attribute on the object.

- `reference.amxd` — the real fixture. Read by `packages/cli/src/scaffold-device.ts` and its tests.
- `reference.maxpat` — the same content as plain JSON, for human reading/diffing only. Not read by any code; regenerate manually if `reference.amxd` changes (see `docs/m4l-scaffolding-risk.md` for how it was extracted).
- `ui/interface.html` — the placeholder page the reference device loads, and the starting point copied into every scaffolded device.
