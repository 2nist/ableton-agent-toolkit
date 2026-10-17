# TrackDraft Bridge

The flagship Ableton Extension: applies a TrackDraft song blueprint to a Live
Set as chord / drum / bass / color MIDI clips, with a picker and a read-only
viewer in Live's modal webview.

## Commands

Right-click a MIDI or Audio track (the generated-clip commands are MIDI-only):

| Command | What it does |
|---|---|
| **Apply Song Blueprint** | Writes cue points, tempo, and chord/drum/bass/color clips for the whole arrangement. |
| **View Song Blueprint** | Read-only section/chord/lyric viewer. |
| **Generate Chord Clips** | One chord clip per section on the clicked track. |
| **Generate Drum Clips** | Section drum clips via `@drum/library` + `@drum/rack-kit` pad mapping. |
| **Generate Bass Line** | Root-following bass clips. |
| **Generate Blank Section Clips** | Empty section-length clips for hand-writing. |
| **Probe Drum Rack** | Reports the live Drum Rack's pad layout (used to map roles to notes). |

Each handler is wrapped so a thrown error is logged instead of killing the
extension host (observed: one bad filesystem call took both commands down
until Live restarted).

## Where songs come from

Extensions may only read `context.environment.storageDirectory`, so blueprints
live in:

```
~/Library/Application Support/Ableton/Extensions Data/matthew.trackdraft-bridge/blueprints/*.trackdraft.json
```

Two ways to populate it:

1. **From TrackDraft (recommended):** the Studio view's *Send to Ableton*
   button POSTs the song to `osc-bridge` (`/api/push-song`), which writes the
   file and queues an `applyBlueprint` command.
2. **Manually:** export `.trackdraft.json` files, then
   `npm run sync-blueprints -w extensions/trackdraft-bridge` (paths are
   derived from the repo root and `$HOME`; override the destination with
   `TRACKDRAFT_EXTENSION_DATA`).

## Command queue

The extension polls `<storageDirectory>/queue/command_*.json` every 2 seconds.
This is deliberate: the Extensions modal channel is one-shot, so a file queue
is the only push path into a running host. Commands are applied and the files
are consumed by the extension.

## Develop

```bash
npm test -w extensions/trackdraft-bridge     # 109 tests (clip planning, parity, HTML)
npm run start -w extensions/trackdraft-bridge
npm run package -w extensions/trackdraft-bridge   # produces the .ablx
```

The clip planners (`chordClips`, `drumClips`, `bassLine`, `colorClips`,
`blueprint`) are pure functions and carry the test coverage; `extension.ts`
is the SDK orchestration layer. `test/parity.test.ts` locks the planners
against the app's own arrangement resolution so the browser preview and the
rendered clips cannot drift.
