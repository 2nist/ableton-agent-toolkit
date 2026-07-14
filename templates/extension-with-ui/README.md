# extension-with-ui template (Phase 4)

Same as `extension-basic` plus a two-stage `build.ts`: esbuild-bundle the webview TS as `format:"iife", platform:"browser"`, then inline that bundle into the HTML's `<script>` tag before `showModalDialog` loads it as a `data:` URL. See `docs/architecture.md`.
