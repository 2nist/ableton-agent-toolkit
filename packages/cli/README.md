# @platform/cli

Non-interactive scaffolding, by design: the official `ableton-create-extension` tool is interactive-only (`prompts()`, no answer flags), which doesn't work for an agent trying to create a new tool without a human present to answer prompts. Everything here is a flag with a sensible default instead.

## Usage

From the repo root:

```sh
node packages/cli/dist/cli.js create extension <name> [--ui] [--author "Name"] [--live /path/to/Ableton\ Live.app]
node packages/cli/dist/cli.js create device <name>
```

(Or `npm run cli -- create extension <name> ...` — see the root `package.json`.)

### `create extension <name>`

1. Resolves the Extension Host path: `--live` if given, otherwise auto-discovers installed Live versions in `/Applications` (macOS) and picks the newest one with Extensions support. Fails with a clear message if none found.
2. Resolves `--author`, falling back to `git config user.name`, falling back to `"Unknown"`.
3. Renders `templates/extension-basic/templates/*.ejs` (copied verbatim from the vendored SDK's own project creator) into `extensions/<name>/`.
4. Applies the platform overlay: adds `@music-theory/core`, `@platform/ui-kit`, `@platform/test-harness` to the generated `package.json`, plus `test`/`typecheck` scripts.

Dependencies point at the repo's one shared `vendor/` directory, not a per-extension copy — a deliberate deviation from the stock tool, appropriate for a monorepo (see `scaffold-extension.ts`'s doc comment).

### `create device <name>`

**Not implemented yet.** `templates/m4l-device-basic/reference.maxpat` doesn't exist — it has to be hand-authored inside Max itself before any copy/patch logic can work against it. Running this command explains why and points at `docs/m4l-scaffolding-risk.md`. This is Phase 5.

## What's deliberately NOT copied from the official tool

- **Interactivity.** No `prompts()`. Every answer is a flag or a discoverable default.
- **A per-extension `vendor/` copy.** One shared `vendor/` at the repo root instead.
- **The "does your extension need a UI?" two-stage bundler enhancement** originally sketched in the project's plan (bundle `ui-kit`-driven TS into the modal, inline it into `interface.html`) — the stock template's own UI variant just inlines a *static* `interface.html` via esbuild's text loader, no separate JS bundle. Building the richer pipeline before anything actually needs `ui-kit` inside a modal would be speculative; add it when `chord-assistant` or a future extension actually wants one, matching how `ui-kit`'s own components are being built on demand.
