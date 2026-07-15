# extension-basic template

`templates/` here is a byte-for-byte copy of the EJS templates found inside the vendored `ableton-create-extension` tarball's own `templates/` folder — Ableton's own official scaffold, not a platform invention. Confirmed identical via `diff -rq` against the extracted tarball at the time of copying.

`@platform/cli`'s `scaffoldExtension()` (`packages/cli/src/scaffold-extension.ts`) renders these with its own data object — a fresh, non-interactive implementation, since the official tool's own `scaffold()` function is only reachable through its interactive `prompts()`-based CLI, not exported for reuse.

One file set, one `needsUI` conditional — not two separate templates. `platform create extension <name> --ui` toggles the modal-dialog variant of `src/extension.ts.ejs` and adds `ui/interface.html`, `vite.config.ts`, `src/html.d.ts`.

**Do not hand-edit these `.ejs` files** to add platform-specific behavior (like the `@music-theory/core` dependency or `test`/`typecheck` scripts) — that overlay is applied by `scaffold-extension.ts` after rendering, precisely so this directory stays a clean, verifiable copy of Ableton's own template. If the SDK ships an updated `ableton-create-extension`, re-copying its `templates/` folder here should be a safe, mechanical operation.
