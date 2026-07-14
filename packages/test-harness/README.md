# @platform/test-harness (Phase 1 — next up)

Fakes only `ActivationContext.initializeExtensionHost()` — the SDK's real native-module boundary, verified in `docs/architecture.md` — then hands the fake to the real, vendored `@ableton-extensions/sdk`'s own `initialize()`. Code under test gets real `Track`/`MidiTrack`/`AudioClip` instances, so `instanceof` checks behave correctly with zero duplicated class logic.

Planned files: `mock-native-module.ts`, `call-log.ts`, `create-mock-context.ts`.
