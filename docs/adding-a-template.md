# Adding a template

Templates live under `templates/<id>/` and are listed in `platform.config.json`'s `templates` array — that file is the human-readable registry, describing what exists and why. **It's not read at runtime yet**: `packages/cli/src/cli.ts` hardcodes the one path it needs (`templates/extension-basic/templates`) directly, since there is exactly one extension template and dynamic config-driven lookup for a single case would be premature. If/when a second extension template exists, wire `cli.ts` to actually read `platform.config.json` at that point — don't add the indirection speculatively.

```json
{
  "id": "your-template-id",
  "targetDir": "extensions",
  "path": "templates/your-template-id",
  "description": "One line describing what this scaffolds."
}
```

- `targetDir` must be `extensions` or `devices` — matches the npm workspaces globs in the root `package.json`.
- For an Extension template, see `templates/extension-basic` — a byte-for-byte copy of the official `ableton-create-extension` tool's own EJS templates, rendered by `packages/cli/src/scaffold-extension.ts`'s own non-interactive implementation (the official tool's `scaffold()` isn't exported for reuse, only reachable through its interactive prompts).
- For a device template, see the explicit risk note in `docs/m4l-scaffolding-risk.md` before touching `reference.maxpat` — it is hand-authored, not generated, and should stay that way unless the Max patcher JSON format has been independently verified.
