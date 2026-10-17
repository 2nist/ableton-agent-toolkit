# @daw/routing-matrix

**Status (2026-10-17): parked.** No workspace imports this package yet. It is kept for a planned integration, is still typechecked/tested, and should be adopted deliberately (or removed) rather than treated as live surface.


Ported verbatim from `/Users/Matthew/unified-music-platform/packages/routing-matrix`. Zero runtime dependencies. Models MIDI/audio signal routing as a directed graph of `RoutingNode`s and `RoutingConnection`s, with cycle detection and unconnected-node warnings.

## `buildMatrix` auto-routes tracks, but only nodes of `kind: "track"`

Any node with `kind: "track"` that has no connection already sourced from it gets auto-wired to `parentId` (if set and valid) or `masterNodeId`. Nodes of other kinds (`bus`, `fx_return`, `external_send`) are **not** auto-routed — leaving one unconnected is a legitimate way to model, e.g., an FX return that's a dead end in a sketch/scratch routing. Caught while writing `test/routing-matrix.test.ts`'s dead-end trace test, which had to switch from a `track` node to an `fx_return` node to actually observe a dead end.

## Feedback-loop detection is DFS-based and reports the whole cycle path

`validateRouting`'s cycle detection returns warnings, not errors — a feedback loop is flagged but doesn't make the matrix invalid on its own (useful for sidechain/parallel-processing patterns that are intentionally cyclic-looking but not actually audio feedback).

## No test suite existed upstream

Same situation as `@music-theory/core` — `vitest` was a devDependency, no `*.test.ts` files existed. `test/routing-matrix.test.ts` is a baseline suite written during the port.
