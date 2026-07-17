# m4l-device-basic template

`reference.amxd` is hand-authored inside Max (launched through Live, never standalone — see `docs/m4l-scaffolding-risk.md`), not generated. If it ever needs to change shape (more inlets, different wiring), edit it the same way: through Live's Max for Live device editor, save, done. Don't hand-edit the binary file or try to synthesize one from scratch.

- `reference.amxd` — the real fixture. Read by `packages/cli/src/scaffold-device.ts` and its tests.
- `reference.maxpat` — the same content as plain JSON, for human reading/diffing only. Not read by any code; regenerate manually if `reference.amxd` changes (see `docs/m4l-scaffolding-risk.md` for how it was extracted).
- `ui/interface.html` — the placeholder page the reference device loads, and the starting point copied into every scaffolded device.
