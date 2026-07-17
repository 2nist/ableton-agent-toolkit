# Reference: Ableton MIDI Remote Scripts

`scripts/` is a symlink to `/Users/Matthew/knowledge-base/input_pdfs/AbletonLive12_MIDIRemoteScripts-main` — an unofficial, community-decompiled repository of Ableton Live 12.0.1's MIDI Remote Scripts Python sources (by Julien Bayle / Structure Void, https://structure-void.com/ableton-live-midi-remote-scripts). No official support; source only, ~40 control surfaces, 1,243 files.

This is machine-local (an absolute-path symlink, not a submodule) because the source repo isn't independently git-managed with a remote — it's a plain folder inside `~/knowledge-base`. Consistent with how this monorepo's own READMEs already reference other `/Users/Matthew/...` project paths (see `@music-theory/core`'s README, for example).

## What `@hardware/controller-bridge` currently models

- `scripts/APC_mini_mk2/` — `elements.py`, `mappings.py`, `colors.py`
- `scripts/ATOMSQ/` — `elements.py`, `mappings.py`, `display.py`, `touch_strip.py`, `midi.py`, `skin.py`, `launch_and_stop.py`

`APC_MINI_MK2`/`ATOMSQ` (in `../src/elements/`) and `APC_MINI_MK2_MAPPINGS`/`ATOMSQ_MAPPINGS` (in `../src/mappings/`) were ported from these two controllers' `elements.py`/`mappings.py`.

## Confirmed finding: whole-matrix mapping is the real framework's intended pattern

`APC_mini_mk2/mappings.py` (`create_mappings`) maps properties directly to matrix names exactly like the ported TS mappings do — e.g. `dict(component="Mixer", volume_controls="faders")`. In Ableton's real `ableton.v3.control_surface` framework, `"faders"` resolves through the control surface's elements registry to a whole `ButtonMatrixElement`/`EncoderMatrixElement` object, which gets passed directly to the target component's setter (e.g. `Mixer.set_volume_controls(matrix)`) — components are written to accept either a single element or a matrix.

`@hardware/controller-bridge`'s `getMidi()` only resolves to a single MIDI number, so it has no way to represent "this maps to the whole `faders` matrix." That's the root cause of the `validate()`/`toReaLearnPreset()` gap documented in `../README.md` — it isn't a porting mistake, it's a genuine simplification versus the real framework's element-or-matrix polymorphism. A faithful fix would give `getMidi`/`validate` a matrix-aware return type (single MIDI number *or* the matrix's full identifier grid) rather than assuming every mapping target is one control.

## Adding a new controller

Browse `scripts/<ControllerName>/elements.py` (hardware layout: `ButtonElement`/`EncoderElement`/`ButtonMatrixElement` declarations) and `mappings.py` (`create_mappings`, same dict-of-dicts shape used above) for the source pattern, then port following the same shape as `../src/elements/apc-mini-mk2.ts` and `../src/mappings/apc-mini-mk2.ts`.
