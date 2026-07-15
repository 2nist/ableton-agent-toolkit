# @platform/test-harness

Fakes only `ActivationContext.initializeExtensionHost()` — the SDK's real native-module boundary (verified against the vendored SDK's compiled output, see `docs/architecture.md`) — then hands the fake to the real, vendored `@ableton-extensions/sdk`'s own `initialize()`. Code under test gets real `Track`/`MidiTrack`/`AudioClip` instances, so `instanceof` checks behave correctly with zero duplicated class logic, and the mock can't drift from the real SDK's class hierarchy as it evolves.

## Usage

```ts
import { createMockContext } from "@platform/test-harness";
import { MidiTrack } from "@ableton-extensions/sdk";

const ctx = createMockContext();
const trackHandle = ctx.addTrack("MidiTrack", "Lead");
const track = ctx.sdk.getObjectFromHandle(trackHandle, MidiTrack);

const clip = await track.createMidiClip(0, 4);
clip.notes = [{ pitch: 60, startTime: 0, duration: 1, velocity: 100 }];

// Assert on real SDK state...
expect(track.arrangementClips).toHaveLength(1);

// ...and on how the extension drove the API, not just the result:
expect(ctx.log.filter("transaction.begin")).toHaveLength(1);
```

Pass `ctx.activation` directly to an extension's `activate(activation)` to test it end-to-end without touching `ctx.sdk` yourself:

```ts
import { activate } from "../../../extensions/chord-assistant/src/extension.js";

const ctx = createMockContext();
activate(ctx.activation);
ctx.invokeCommand("chord-assistant.insertProgression", fakeArrangementSelection);
```

## Known limitation

This validates logic, object relationships, and transaction grouping — not Live's actual scheduling or real audio rendering (`resources.renderPreFxAudio`/`importIntoProject` return plausible fake paths, no files are touched). Those stay manual-QA-only, verified against real Live 12 Beta.

## Files

- `mock-state.ts` — generic object graph (every SDK object is one record: `{id, kind, props}`); `getObjectIsOfClass` resolution is just `kind === className`.
- `mock-native-module.ts` — the full `{commands, dataModel, environment, resources, ui}` contract, backed by `mock-state.ts`.
- `call-log.ts` — records every native-module call; `withinTransaction` specifically records one `"transaction.begin"`/`"transaction.end"` pair per *outermost* call, so nested transactions (every property setter and `create*` call issues its own) don't inflate the count.
- `create-mock-context.ts` — builds the fake `ActivationContext`, calls the real SDK's `initialize()` against it.
