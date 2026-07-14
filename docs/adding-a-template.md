# Adding a template

Templates live under `templates/<id>/` and are registered in `platform.config.json`'s `templates` array:

```json
{
  "id": "your-template-id",
  "targetDir": "extensions",
  "path": "templates/your-template-id",
  "description": "One line describing what this scaffolds."
}
```

- `targetDir` must be `extensions` or `devices` — matches the npm workspaces globs in the root `package.json`.
- For an Extension template, mirror the stock SDK project-creator output (`package.json`, `manifest.json`, `tsconfig.json`, `build.ts`, `src/extension.ts`, `.env`) — see `templates/extension-basic` for the reference copy.
- For a device template, see the explicit risk note in `docs/m4l-scaffolding-risk.md` before touching `reference.maxpat` — it is hand-authored, not generated, and should stay that way unless the Max patcher JSON format has been independently verified.

`packages/cli`'s `create` command reads this file to know what it can scaffold — there is no separate template registry to keep in sync.
