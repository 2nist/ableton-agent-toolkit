# Adding a shared package

1. Create `packages/<name>/` with its own `package.json` (extend `tsconfig.base.json` from the repo root) and a `tsup` build producing `cjs,esm` + `.d.ts` — matches every existing shared package.
2. If the package needs to run inside a webview (Extensions modal or M4L `jweb`), keep it free of Node built-ins (`fs`, `path`, `os`, etc.) — `@music-theory/core` is the reference: zero runtime dependencies, pure logic, confirmed to run unmodified in both Node and browser contexts.
3. Register it in `platform.config.json`'s `sharedPackages` array so the CLI's overlay step knows it's available to offer when scaffolding a new extension or device.
4. npm workspaces resolves same-named local packages automatically by name in a consumer's `package.json` — no `workspace:` protocol (that's pnpm/yarn-specific and won't resolve under plain npm).
