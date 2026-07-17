# M4L device scaffolding — known risk

This is the least-verified part of the platform. Stated plainly rather than smoothed over.

## What's confirmed

- `jweb` is a real Max object that embeds a Chromium (CEF) web view in a patcher — confirmed from Cycling '74's own shipped docs (`/Applications/Max.app/Contents/Resources/C74/docs/refpages/max-ref/jweb.maxref.xml`, `.../help/max/jweb.maxhelp`, `.../userguide/content/web_browser.json`).
- The JS-to-Max / Max-to-JS bridge (`window.max.outlet`, `window.max.bindInlet`, `window.max.getDict`/`setDict`) is confirmed from the same source.
- The jweb help patch itself uses plain `jweb` + `inlet`/`outlet` + basic routing objects — nothing exotic pairs with it.

## What's NOT confirmed

- No `.maxpat` file exists anywhere on this machine to use as a real starting point. `/Users/Matthew/m4l-chord-progression-device` is JS logic only (`hexagon_chord_logic.js`), never wired into an actual device — there is no working reference device to copy from.
- The exact JSON schema Cycling '74 uses for `.maxpat` files has not been independently verified beyond what's needed to hand-edit one (it's known to be JSON, but its full structure, required keys, and versioning quirks are not documented here).

## Launching Max: through Live, never standalone

**Do not open `/Applications/Max.app` (or Live's bundled copy of it) directly.** Max for Live and standalone Max are two separate Cycling '74 products with separate authorization. An Ableton Suite license entitles you to Max *for Live* only — launching `Max.app` directly tries to authorize it as the full standalone product, which needs its own separate (unowned) license, and fails with a generic "Error getting authorization dictionary" regardless of any Cycling '74 account email. Confirmed via Ableton's own support docs: "If you own Max for Live but Max says you are not authorized, this is probably because you are using the standalone Max application rather than Max for Live... Max should always be opened from within Live via the Max for Live Editor button." ([Ableton: Max for Live Trial Not Started](https://help.ableton.com/hc/en-us/articles/115001317484-Max-for-Live-Trial-Not-Started-Saving-Disabled))

Max for Live itself authorizes through **Live's own Preferences → Licenses/Maintenance → "Authorize at Ableton.com"** — tied to the Ableton account, no Cycling '74 login involved for this path.

## The chosen approach — do not deviate without re-reading this file

**Hand-author exactly one reference patcher, launching Max through Live.** In Live: create a Max MIDI Effect (or Max Instrument/Audio Effect) device on a track, click its **Edit** button to open Max already authorized in the Max-for-Live context. Drop a `jweb` object, an `inlet`, an `outlet`, wire them together (optionally through a `[route]`), point `jweb`'s page-source at a placeholder HTML file, save as `templates/m4l-device-basic/reference.maxpat`.

The CLI's `create device <name>` then only:
1. Copies `reference.maxpat` to `devices/<name>/<name>.maxpat`.
2. Parses it as JSON and patches two things: the jweb object's page-source argument (to point at the new device's built `ui/dist/index.html`) and the patcher's title/name string.
3. Scaffolds `devices/<name>/ui/` (src/main.ts, interface.html, build.ts) and `package.json`.

**Never attempt to synthesize `.maxpat` JSON from nothing.** If a future template needs a materially different patcher shape (more inlets, DSP objects, etc.), hand-author a new reference patcher the same way — don't try to generate the delta programmatically without opening Max to verify the result.
