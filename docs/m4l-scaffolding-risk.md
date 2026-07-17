# M4L device scaffolding

Was the platform's biggest unknown. Now built and tested — this file records what's actually confirmed, and the one thing that still needs a real Live session to fully close out.

## The `.amxd` format — reverse-engineered, not documented anywhere

`.amxd` (Ableton's Max for Live device file) is **not** plain JSON, despite `.maxpat` (the underlying Max patcher format) being plain JSON. Cycling '74 and Ableton don't publicly document the wrapper. Figured out by byte-level inspection of a real file saved from Live's own device editor:

```
offset 0   (4 bytes)  magic: "ampf"
offset 4   (4 bytes)  uint32 LE, always seen as 4 — purpose unconfirmed
offset 8   (8 bytes)  literal marker: "mmmmmeta"
offset 16  (4 bytes)  uint32 LE, always seen as 4 — purpose unconfirmed
offset 20  (4 bytes)  uint32 LE, always seen as 0 — purpose unconfirmed
offset 24  (4 bytes)  literal marker: "ptch"
offset 28  (4 bytes)  uint32 LE — length of the payload that follows
offset 32  (N bytes)  UTF-8 JSON text + one trailing 0x00 byte
```

Implemented in `packages/cli/src/amxd.ts` (`parseAmxd`/`serializeAmxd`), verified against the real reference file in `packages/cli/test/amxd.test.ts` — parse → serialize → re-parse produces semantically identical output (not byte-identical: Max writes whole-number floats as `439.0`, JavaScript's `JSON.stringify` can't reproduce that and always emits `439` — an inherent JSON-serialization limitation, not a gap in understanding the format).

**Scope**: only confirmed for a minimal device (no exposed Live-mappable parameters, no factory patcher preview, no automation state). A real, more complex device might have additional trailing sections this hasn't encountered. That's fine for what `create device` itself produces — every scaffolded device is a direct derivative of the same minimal reference, never more complex than it.

## Launching Max: through Live, never standalone

**Do not open `/Applications/Max.app` (or Live's bundled copy of it) directly.** Max for Live and standalone Max are two separate Cycling '74 products with separate authorization. An Ableton Suite license entitles you to Max *for Live* only — launching `Max.app` directly tries to authorize it as the full standalone product, which needs its own separate (unowned) license, and fails with a generic "Error getting authorization dictionary" regardless of any Cycling '74 account email. Confirmed via Ableton's own support docs: "If you own Max for Live but Max says you are not authorized, this is probably because you are using the standalone Max application rather than Max for Live... Max should always be opened from within Live via the Max for Live Editor button." ([Ableton: Max for Live Trial Not Started](https://help.ableton.com/hc/en-us/articles/115001317484-Max-for-Live-Trial-Not-Started-Saving-Disabled))

Max for Live itself authorizes through **Live's own Preferences → Licenses/Maintenance → "Authorize at Ableton.com"** — tied to the Ableton account, no Cycling '74 login involved for this path.

## The reference device

Built by hand in Live 12 Suite: Max MIDI Effect device → Edit → `inlet` → `jweb` → `outlet`, plus `loadbang` → a `read file://...` message box → `jweb`, wired and tested round-trip (a button in the loaded page calls `window.max.outlet`, confirmed arriving in the Max Console). Saved via Live's device editor, which produces `.amxd` (not `.maxpat`) — that's what led to reverse-engineering the wrapper format above.

Two files came out of this:
- `templates/m4l-device-basic/reference.amxd` — the real binary fixture. This is what `create device` and the test suite actually read.
- `templates/m4l-device-basic/reference.maxpat` — the same content, extracted as plain JSON text, for human readability/diffing only. **Not read by any code** — regenerating it after a `reference.amxd` change is a manual, optional step, not a sync requirement.
- `templates/m4l-device-basic/ui/interface.html` — the placeholder page the reference device loads, also copied into every scaffolded device's `ui/` folder as a starting point.

Inspecting the parsed JSON found no patcher-level title/name field anywhere — a device's displayed name in Live comes from its filename, not embedded metadata. So `create device` doesn't need to patch anything beyond the two places that reference the placeholder page's path.

## What `create device <name>` actually does

Implemented in `packages/cli/src/scaffold-device.ts`:

1. Reads and parses `reference.amxd`.
2. Finds the `jweb` box and rewrites its `url` attribute to `file://<repo>/devices/<name>/ui/interface.html`.
3. Finds the `message` box whose text starts with `read file://` and rewrites it to match.
4. Throws (refuses to scaffold) if either box isn't found — a signal the reference file's shape changed since this was written, not something to silently paper over.
5. Serializes the result and writes `devices/<name>/<name>.amxd`.
6. Copies `templates/m4l-device-basic/ui/interface.html` to `devices/<name>/ui/interface.html`.

No build step for the device's UI — `jweb` loads the HTML file directly off disk, same as the reference device does. Add a bundler if a real device's UI ever needs `@platform/ui-kit`/`@music-theory/core` inside it (same "build it when something needs it" approach as `extensions/*`'s webview pipeline).

Verified end-to-end: scaffolded a throwaway device via the built CLI, independently re-parsed the output `.amxd` with a fresh Python script (not the project's own parser, to catch any bug that would be self-consistent but still wrong), confirmed both patched paths point at the new device's own files with no leftover reference to the template.

## What's still NOT confirmed

**Whether Live/Max's own parser is fully happy with the re-serialized JSON's number formatting.** `JSON.stringify` can't reproduce Max's `439.0`-style whole-number floats — it always emits `439`. Both are the identical value per the JSON spec, and any spec-compliant parser treats them identically, but this hasn't been confirmed against Max's actual parser by opening a scaffolded device in a real Live session. That's the one remaining manual step: open a `create device`-scaffolded `.amxd` in Live and confirm it loads without complaint. Do this before relying on `create device` for anything real.
