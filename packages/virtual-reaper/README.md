# @daw/virtual-reaper

Ported verbatim from `/Users/Matthew/unified-music-platform/packages/virtual-reaper` (based on EnviREAment's `enhanced_virtual_reaper.lua`, 3,035 lines). Zero runtime dependencies. This is a TypeScript port of the environment-detection/mocking *architecture* — not a line-for-line port of the Lua mock bodies, which live in the original Lua project.

## `env` is a module-level singleton, evaluated at import time

`export const env = new EnvironmentAdapter()` runs `detectEnvironment()` once, when the module is first imported — not lazily per call. If `globalThis.reaper` is set up *after* this module has already been imported, `env` will not reflect it; construct a fresh `new EnvironmentAdapter()` instead of relying on the singleton in any context where the reaper global might appear later than module load (e.g. test setup, or a build pipeline that stubs `reaper` asynchronously). Caught while writing `test/virtual-reaper.test.ts`, which mutates `globalThis.reaper` per-test and therefore constructs new adapters rather than reusing `env`.

## Related package: this is the TS sibling of the actual EnviREAment project

The real, actively-developed EnviREAment (the Lua virtual REAPER environment this package's architecture is based on) lives at `/Users/Matthew/devtoolbox-reaper-master/EnviREAment` — a separate Python-packaged project with its own `enhanced_virtual_reaper.lua`, VS Code extension, and test suite. This package does not supersede or wrap that project; it's a parallel TypeScript implementation of the same environment-detection pattern, useful for Node-side build/test tooling (e.g. `@platform/test-harness`) that wants the same "detect real vs. virtual vs. standalone" logic without a Lua runtime.

## No test suite existed upstream

Same situation as `@music-theory/core` — `vitest` was a devDependency, no `*.test.ts` files existed. `test/virtual-reaper.test.ts` is a baseline suite written during the port.
