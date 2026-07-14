# @platform/cli (Phase 4 — not yet built)

`create extension <name>` shells out to the vendored `ableton-create-extension` tarball, then overlays platform deps from `platform.config.json`. `create device <name>` copies `templates/m4l-device-basic/reference.maxpat` and JSON-patches it — see `docs/m4l-scaffolding-risk.md` before changing this behavior.
