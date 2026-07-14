# M4L device scaffolding — known risk

This is the least-verified part of the platform. Stated plainly rather than smoothed over.

## What's confirmed

- `jweb` is a real Max object that embeds a Chromium (CEF) web view in a patcher — confirmed from Cycling '74's own shipped docs (`/Applications/Max.app/Contents/Resources/C74/docs/refpages/max-ref/jweb.maxref.xml`, `.../help/max/jweb.maxhelp`, `.../userguide/content/web_browser.json`).
- The JS-to-Max / Max-to-JS bridge (`window.max.outlet`, `window.max.bindInlet`, `window.max.getDict`/`setDict`) is confirmed from the same source.
- The jweb help patch itself uses plain `jweb` + `inlet`/`outlet` + basic routing objects — nothing exotic pairs with it.

## What's NOT confirmed

- No `.maxpat` file exists anywhere on this machine to use as a real starting point. `/Users/Matthew/m4l-chord-progression-device` is JS logic only (`hexagon_chord_logic.js`), never wired into an actual device — there is no working reference device to copy from.
- The exact JSON schema Cycling '74 uses for `.maxpat` files has not been independently verified beyond what's needed to hand-edit one (it's known to be JSON, but its full structure, required keys, and versioning quirks are not documented here).

## The chosen approach — do not deviate without re-reading this file

**Hand-author exactly one reference patcher inside Max itself.** Open Max, drop a `jweb` object, an `inlet`, an `outlet`, wire them together (optionally through a `[route]`), point `jweb`'s page-source at a placeholder HTML file, save as `templates/m4l-device-basic/reference.maxpat`.

The CLI's `create device <name>` then only:
1. Copies `reference.maxpat` to `devices/<name>/<name>.maxpat`.
2. Parses it as JSON and patches two things: the jweb object's page-source argument (to point at the new device's built `ui/dist/index.html`) and the patcher's title/name string.
3. Scaffolds `devices/<name>/ui/` (src/main.ts, interface.html, build.ts) and `package.json`.

**Never attempt to synthesize `.maxpat` JSON from nothing.** If a future template needs a materially different patcher shape (more inlets, DSP objects, etc.), hand-author a new reference patcher the same way — don't try to generate the delta programmatically without opening Max to verify the result.
