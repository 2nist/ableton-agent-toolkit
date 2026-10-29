/**
 * TrackDraft — Electron main process.
 *
 * CommonJS on purpose: a sandboxed preload must be CJS, and main needs no
 * bundler to run, so `npm run electron` works from a clean checkout with no
 * extra build step. (A TS + bundler setup can come later; nothing here resists it.)
 *
 * What this replaces from the Vite dev server (see apps/trackdraft/vite.config.ts):
 *   /__local-file    → host:read-text / host:read-bytes / host:read-als-xml
 *   /__local-browse  → host:pick-files / host:pick-directory
 * The remaining six endpoints (catalog, YouTube, ChordMini) stay dev-only for
 * now — they need a decision about bundling yt-dlp / Python, not just plumbing.
 */

const { app, BrowserWindow, Menu, dialog, ipcMain, protocol, session, shell } = require("electron");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const zlib = require("node:zlib");
const media = require("./media.cjs");

const SCHEME = "app";
/**
 * The host must stay `localhost`: the renderer derives the osc-bridge address
 * from `window.location.hostname` (src/lib/bridgeHost.ts), and any host other
 * than localhost/127.0.0.1 is treated as a LAN address — `ws://trackdraft:8081`
 * would never resolve.
 */
const HOST = "localhost";
const ORIGIN = `${SCHEME}://${HOST}`;
const DIST = path.join(__dirname, "..", "dist");
const DEV_URL = process.env.TRACKDRAFT_DEV_URL ?? "";

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  // Tailwind ships a stylesheet; Puck injects style tags at runtime.
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' data:",
  "img-src 'self' data: blob:",
  "media-src 'self' data: blob:",
  // osc-bridge (Ableton sync / Send-to-Ableton), plus the two keyless lyric and
  // rhyme services the importer and the Lyrics view call.
  "connect-src 'self' ws://127.0.0.1:8081 ws://localhost:8081 http://127.0.0.1:5200 http://localhost:5200 https://lrclib.net https://api.datamuse.com",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join("; ");

/* Files and directories the user has explicitly chosen this session. Reads are
 * refused outside this set, so a compromised renderer cannot walk the disk —
 * the dialog is the only way in. */
const grantedFiles = new Set();
const grantedRoots = new Set();

function grantPath(target) {
  const resolved = path.resolve(target);
  grantedFiles.add(resolved);
  return resolved;
}

function isGranted(target) {
  const resolved = path.resolve(target);
  if (grantedFiles.has(resolved)) return true;
  for (const root of grantedRoots) {
    if (resolved === root || resolved.startsWith(root + path.sep)) return true;
  }
  return false;
}

function assertGranted(target) {
  if (typeof target !== "string" || target === "") throw new Error("No file path given");
  if (!isGranted(target)) {
    throw new Error(
      `Refusing to read ${target}: it was not chosen in this session. Pick it with the import dialog.`,
    );
  }
  return path.resolve(target);
}

const MIME = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
  ".wasm": "application/wasm",
  ".map": "application/json",
};

function mimeFor(filePath) {
  return MIME[path.extname(filePath).toLowerCase()] ?? "application/octet-stream";
}

/* Registering the scheme as privileged must happen before `app.ready`. */
protocol.registerSchemesAsPrivileged([
  {
    scheme: SCHEME,
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true },
  },
]);

function serveDist() {
  protocol.handle(SCHEME, async (request) => {
    const url = new URL(request.url);
    let pathname = decodeURIComponent(url.pathname);
    if (pathname === "/" || pathname === "") pathname = "/index.html";

    const candidate = path.normalize(path.join(DIST, pathname));
    if (!candidate.startsWith(DIST)) {
      return new Response("Forbidden", { status: 403 });
    }

    try {
      const body = await fsp.readFile(candidate);
      return new Response(body, {
        headers: { "content-type": mimeFor(candidate), "content-security-policy": CSP },
      });
    } catch {
      // Single-page app: an unknown path without an extension is a route.
      if (path.extname(pathname) !== "") {
        return new Response("Not found", { status: 404 });
      }
      try {
        const html = await fsp.readFile(path.join(DIST, "index.html"));
        return new Response(html, {
          headers: { "content-type": "text/html", "content-security-policy": CSP },
        });
      } catch {
        return new Response(
          "dist/index.html is missing — run `npm run build` in apps/trackdraft first.",
          { status: 500, headers: { "content-type": "text/plain" } },
        );
      }
    }
  });
}

let mainWindow = null;
/** Renderer diagnostics collected by the smoke run. */
const smokeErrors = [];

function hardenSession() {
  const s = session.defaultSession;

  // Web MIDI is the app's only sound path. Chromium asks; without an answer
  // the request is denied and the MIDI picker lists nothing.
  const allowed = new Set([
    "midi",
    "midiSysex",
    "media",
    "clipboard-read",
    "clipboard-sanitized-write",
    "fullscreen",
  ]);
  s.setPermissionRequestHandler((_contents, permission, callback) => callback(allowed.has(permission)));
  s.setPermissionCheckHandler((_contents, permission) => allowed.has(permission));

  // Nothing may navigate the shell away from the app; real links go to the OS.
  app.on("web-contents-created", (_event, contents) => {
    contents.on("will-navigate", (event, url) => {
      if (url.startsWith(ORIGIN) || (DEV_URL && url.startsWith(DEV_URL))) return;
      event.preventDefault();
      if (/^https?:$/.test(new URL(url).protocol)) void shell.openExternal(url);
    });
  });
}

function createWindow({ url = ORIGIN } = {}) {
  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 960,
    minHeight: 620,
    show: false,
    backgroundColor: "#1b1a17",
    title: "TrackDraft",
    titleBarStyle: "hiddenInset",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: true,
    },
  });

  win.once("ready-to-show", () => win.show());

  if (process.env.TRACKDRAFT_SMOKE) {
    win.webContents.on("console-message", (_event, level, message) => {
      if (level >= 3) smokeErrors.push(String(message).slice(0, 200));
    });
    win.webContents.on("render-process-gone", (_event, details) =>
      smokeErrors.push(`render-process-gone: ${details.reason}`),
    );
    win.webContents.on("preload-error", (_event, preloadPath, error) =>
      smokeErrors.push(`preload-error ${preloadPath}: ${error.message}`),
    );
  }
  win.loadURL(url);

  // The lyric/chord popout is the app's one real second window. Anything else
  // is either external (→ OS browser) or refused.
  win.webContents.setWindowOpenHandler(({ url: target }) => {
    let parsed;
    try {
      parsed = new URL(target, ORIGIN);
    } catch {
      return { action: "deny" };
    }
    if (parsed.origin === ORIGIN || (DEV_URL && target.startsWith(DEV_URL))) {
      return {
        action: "allow",
        overrideBrowserWindowOptions: {
          width: 900,
          height: 560,
          autoHideMenuBar: true,
          backgroundColor: "#1b1a17",
          webPreferences: {
            preload: path.join(__dirname, "preload.cjs"),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
          },
        },
      };
    }
    if (/^https?:$/.test(parsed.protocol)) void shell.openExternal(target);
    return { action: "deny" };
  });

  return win;
}

function buildMenu() {
  const isMac = process.platform === "darwin";
  const template = [
    ...(isMac ? [{ role: "appMenu" }] : []),
    {
      label: "File",
      submenu: [
        {
          label: "Import Song…",
          accelerator: "CmdOrCtrl+O",
          click: () => mainWindow?.webContents.send("menu:import"),
        },
        { type: "separator" },
        isMac ? { role: "close" } : { role: "quit" },
      ],
    },
    // Without these roles, Cmd+C/V/Z do nothing inside text inputs on macOS.
    { role: "editMenu" },
    {
      label: "View",
      submenu: [
        { role: "reload" },
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    { role: "windowMenu" },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

/* ── The song library, on disk ──────────────────────────────────────────────
 *
 * localStorage caps out around 5 MB, which is ~85 songs — the shipped Beatles
 * catalogue alone is 10.9 MB across 182 files. So in the desktop build the
 * library IS this directory: one `<songId>.trackdraft.json` per song, under
 * userData. The renderer keeps its in-memory shape and asks us to load/save.
 */

function libraryDir() {
  return path.join(app.getPath("userData"), "songs");
}

/** Where a build-time catalogue pack is bundled (see scripts/bundle-catalog.ts). */
function bundledCatalogDir() {
  const packaged = path.join(process.resourcesPath ?? "", "catalog");
  if (process.resourcesPath && fs.existsSync(packaged)) return packaged;
  return path.join(__dirname, "..", "dist", "catalog");
}

function ensureLibraryDir() {
  const dir = libraryDir();
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Beat library: `<library>/beats.json` → `<library>/tables/beats.json`.
 *
 * Beats became a table once the tables folder existed, and a file left in the
 * old place would silently read as "no saved beats" — the writer's beats are
 * still there, just not found. Move once, and only when the new file is absent
 * so a later deliberate reset is not undone by the old copy.
 */
function migrateBeatsFile(target) {
  const legacy = path.join(ensureLibraryDir(), "beats.json");
  if (fs.existsSync(target) || !fs.existsSync(legacy)) return;
  try {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.renameSync(legacy, target);
    console.log(`[beats] moved beats.json into tables/ (${target})`);
  } catch (error) {
    console.warn("[beats] could not move beats.json into tables/", error);
  }
}

/**
 * First run only: copy the bundled catalogue into the library so a test build
 * opens with songs in it. Returns how many were seeded. Never overwrites — an
 * existing library is the user's.
 */
function seedLibraryIfEmpty() {
  const dir = ensureLibraryDir();
  const existing = fs.readdirSync(dir).filter((f) => f.endsWith(".trackdraft.json"));
  if (existing.length > 0) return 0;

  const bundled = bundledCatalogDir();
  if (!fs.existsSync(bundled)) return 0;

  const songs = fs.readdirSync(bundled).filter((f) => f.endsWith(".trackdraft.json"));
  for (const file of songs) {
    fs.copyFileSync(path.join(bundled, file), path.join(dir, file));
  }
  // Keep the pack's provenance next to the songs it describes.
  for (const meta of ["MANIFEST.json", "DO-NOT-DISTRIBUTE.txt", "README.txt"]) {
    const from = path.join(bundled, meta);
    if (fs.existsSync(from)) fs.copyFileSync(from, path.join(dir, `_pack-${meta}`));
  }
  return songs.length;
}

/** What the bundled pack says about itself (distribution class), if anything. */
function bundledDistribution() {
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(bundledCatalogDir(), "MANIFEST.json"), "utf8"));
    return manifest.distribution ?? "unknown";
  } catch {
    return "none";
  }
}

function safeSongFile(songId) {
  const name = `${String(songId).replace(/[^A-Za-z0-9._-]/g, "_")}.trackdraft.json`;
  return path.join(libraryDir(), name);
}

/* ── IPC: the replacements for /__local-file and /__local-browse ─────────── */

const importFilters = [
  { name: "Songs", extensions: ["json", "mid", "midi", "musicxml", "xml", "als"] },
  { name: "Audio", extensions: ["mp3", "wav", "aif", "aiff", "flac", "ogg", "m4a"] },
  { name: "Lyrics", extensions: ["txt", "lrc", "md"] },
  { name: "All files", extensions: ["*"] },
];

function describeFile(filePath) {
  const name = path.basename(filePath);
  return {
    name,
    path: filePath,
    ext: path.extname(name).slice(1).toLowerCase(),
    size: fs.statSync(filePath).size,
  };
}

function registerIpc() {
  ipcMain.handle("host:app-info", () => ({
    version: app.getVersion(),
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
    platform: process.platform,
  }));

  ipcMain.handle("host:pick-files", async (_event, options = {}) => {
    const multiple = options.multiple === true;
    const result = await dialog.showOpenDialog({
      title: "Import into TrackDraft",
      properties: multiple ? ["openFile", "multiSelections"] : ["openFile"],
      filters: importFilters,
    });
    if (result.canceled) return [];
    return result.filePaths.map((filePath) => describeFile(grantPath(filePath)));
  });

  ipcMain.handle("host:pick-directory", async () => {
    const result = await dialog.showOpenDialog({
      title: "Choose a song folder",
      properties: ["openDirectory", "createDirectory"],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    const root = path.resolve(result.filePaths[0]);
    grantedRoots.add(root);
    return root;
  });

  ipcMain.handle("host:read-text", async (_event, filePath) => {
    return fsp.readFile(assertGranted(filePath), "utf8");
  });

  ipcMain.handle("host:read-bytes", async (_event, filePath) => {
    const buffer = await fsp.readFile(assertGranted(filePath));
    // Structurally cloned to the renderer as a Uint8Array.
    return buffer;
  });

  /**
   * `.als` is gzipped XML. Decompression needs Node, which the renderer no
   * longer has (and which is why .als import never worked in the browser) —
   * so main does the gunzip and the renderer keeps the XML walk it already had.
   */
  ipcMain.handle("host:read-als-xml", async (_event, filePath) => {
    const raw = await fsp.readFile(assertGranted(filePath));
    try {
      return zlib.gunzipSync(raw).toString("utf8");
    } catch {
      // Some sets are saved uncompressed.
      return raw.toString("utf8");
    }
  });

  /* ── library ─────────────────────────────────────────────────────────── */

/**
 * One-time clean-up of a library seeded before the drum reset.
 *
 * Every catalogue song used to carry `drumBlocks` transcribed from a demucs
 * drum stem. Those blocks REPLACE a lane's content across their range, so a
 * transcription that heard two kicks in four bars deleted the groove underneath
 * and left the section nearly empty. The curated pattern pool is the intended
 * fallback, so the transcribed blocks are dropped — once, with the library
 * copied aside first, and never again (the marker file below is the guard).
 */
function runLibraryMigrations() {
  const dir = ensureLibraryDir();
  const markerPath = path.join(dir, "_migrations.json");
  let markers = {};
  try {
    markers = JSON.parse(fs.readFileSync(markerPath, "utf8"));
  } catch {
    markers = {};
  }
  if (markers.droppedTranscribedDrumBlocks) return null;

  const songs = fs.readdirSync(dir).filter((f) => f.endsWith(".trackdraft.json"));
  if (songs.length === 0) return null;

  const backupDir = path.join(dir, `_backup-before-drums-reset-${Date.now()}`);
  fs.mkdirSync(backupDir, { recursive: true });
  for (const file of songs) {
    fs.copyFileSync(path.join(dir, file), path.join(backupDir, file));
  }

  let dropped = 0;
  let sections = 0;
  for (const file of songs) {
    const full = path.join(dir, file);
    let parsed;
    try {
      parsed = JSON.parse(fs.readFileSync(full, "utf8"));
    } catch {
      continue;
    }
    const song = parsed.song ?? parsed;
    let touched = false;
    for (const section of song.sections ?? []) {
      if (Array.isArray(section.drumBlocks) && section.drumBlocks.length > 0) {
        dropped += section.drumBlocks.length;
        sections += 1;
        delete section.drumBlocks;
        touched = true;
      }
    }
    if (touched) fs.writeFileSync(full, `${JSON.stringify(parsed, null, 2)}\n`);
  }

  markers.droppedTranscribedDrumBlocks = new Date().toISOString();
  fs.writeFileSync(markerPath, `${JSON.stringify(markers, null, 2)}\n`);
  const summary = { dropped, sections, backup: path.basename(backupDir) };
  console.log(`[library] dropped ${dropped} transcribed drum block(s) from ${sections} section(s); backup: ${summary.backup}`);
  return summary;
}

  ipcMain.handle("host:library-load", async () => {
    const seeded = seedLibraryIfEmpty();
    runLibraryMigrations();
    // Beats moved into `tables/` with the other user data; do it at boot rather
    // than on first use of the groove shelf, so the files are where Settings
    // says they are from the first launch.
    migrateBeatsFile(beatsFile());
    const dir = ensureLibraryDir();
    const songs = [];
    let unreadable = 0;
    for (const file of fs.readdirSync(dir).filter((f) => f.endsWith(".trackdraft.json"))) {
      try {
        songs.push(JSON.parse(fs.readFileSync(path.join(dir, file), "utf8")));
      } catch {
        unreadable += 1;
      }
    }
    return { songs, seeded, unreadable, dir, distribution: bundledDistribution() };
  });

  ipcMain.handle("host:library-write", async (_event, song) => {
    if (!song || typeof song.id !== "string") throw new Error("Song has no id");
    ensureLibraryDir();
    const target = safeSongFile(song.id);
    // Write-then-rename so a crash mid-write cannot truncate a song.
    const tmp = `${target}.tmp`;
    await fsp.writeFile(tmp, JSON.stringify(song, null, 2), "utf8");
    await fsp.rename(tmp, target);
    return { ok: true };
  });

  ipcMain.handle("host:library-delete", async (_event, songId) => {
    const target = safeSongFile(songId);
    await fsp.rm(target, { force: true });
    return { ok: true };
  });

  ipcMain.handle("host:library-info", () => ({
    dir: libraryDir(),
    distribution: bundledDistribution(),
  }));

  /* ── engine tables: `<library>/tables/*.json` ──────────────────────────
   * The colour matrix, the genre map and the drum gesture catalog ship inside
   * their packages, but a writer who extends one should not have to rebuild:
   * an edited table is a FILE next to the songs, loaded at boot and validated
   * on the way in. The package copy stays the fallback, so a broken file can
   * never leave the engine without a table. Saved beats are a table too. */
  const tablesDir = () => path.join(ensureLibraryDir(), "tables");
  const beatsFile = () => path.join(tablesDir(), "beats.json");

  /* ── saved beats: a portable file beside the tables ────────────────────
   * Beats live in `<library>/tables/beats.json` rather than in the renderer's
   * localStorage, so they travel with the song library, can be edited in any
   * JSON editor, and can be exported/imported across machines. One file, one
   * list — beats are small (a bar of five lanes is a few dozen numbers). */
  ipcMain.handle("host:beats-load", () => {
    const file = beatsFile();
    migrateBeatsFile(file);
    try {
      const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
      const beats = Array.isArray(parsed?.beats) ? parsed.beats : Array.isArray(parsed) ? parsed : [];
      return { beats, path: file };
    } catch {
      return { beats: [], path: file };
    }
  });

  ipcMain.handle("host:tables-load", () => {
    const dir = tablesDir();
    const files = {};
    const errors = {};
    if (!fs.existsSync(dir)) return { dir, files, errors };
    for (const name of fs.readdirSync(dir).filter((f) => f.endsWith(".json"))) {
      try {
        const parsed = JSON.parse(fs.readFileSync(path.join(dir, name), "utf8"));
        // Accept the exported envelope and a bare table.
        files[name] = parsed && typeof parsed === "object" && "data" in parsed ? parsed.data : parsed;
      } catch (error) {
        errors[name] = error instanceof Error ? error.message : String(error);
      }
    }
    if (Object.keys(files).length > 0) {
      console.log(`[tables] read ${Object.keys(files).join(", ")} from ${dir}`);
    }
    return { dir, files, errors };
  });

  ipcMain.handle("host:tables-save", async (_event, filename, data) => {
    if (typeof filename !== "string" || !filename.endsWith(".json")) throw new Error("bad table filename");
    const dir = tablesDir();
    fs.mkdirSync(dir, { recursive: true });
    const target = path.join(dir, path.basename(filename));
    const tmp = `${target}.tmp`;
    const payload = {
      format: `trackdraft.table.v1`,
      updatedAt: new Date().toISOString(),
      data,
    };
    await fsp.writeFile(tmp, JSON.stringify(payload, null, 2), "utf8");
    await fsp.rename(tmp, target);
    return { ok: true, path: target };
  });

  ipcMain.handle("host:tables-delete", async (_event, filename) => {
    if (typeof filename !== "string") throw new Error("bad table filename");
    await fsp.rm(path.join(tablesDir(), path.basename(filename)), { force: true });
    return { ok: true };
  });

  ipcMain.handle("host:beats-save", async (_event, beats) => {
    if (!Array.isArray(beats)) throw new Error("beats must be an array");
    const file = beatsFile();
    fs.mkdirSync(tablesDir(), { recursive: true });
    const tmp = `${file}.tmp`;
    const payload = { format: "trackdraft.beats.v1", updatedAt: new Date().toISOString(), beats };
    await fsp.writeFile(tmp, JSON.stringify(payload, null, 2), "utf8");
    await fsp.rename(tmp, file);
    return { ok: true, path: file, count: beats.length };
  });

  /* ── media: YouTube import + ChordMiniApp analysis ──────────────────────
   * These were Vite dev middleware, so the packaged app 404'd on buttons that
   * looked live. Every failure mode (no yt-dlp, no ffmpeg, no ChordMiniApp)
   * reports a sentence the user can act on. */
  ipcMain.handle("media:youtube-meta", (_event, videoId) => media.fetchYoutubeMeta(videoId));

  ipcMain.handle("media:chordmini-analyze", async (_event, bytes) => {
    return media.analyzeChords(Buffer.from(bytes));
  });

  ipcMain.handle("media:youtube-full-import", async (event, { videoId, id } = {}) => {
    return media.fullImport(videoId, (step, message) => {
      // Progress is advisory — a closed window must not turn into a crash.
      if (!event.sender.isDestroyed()) event.sender.send("media:progress", { id, step, message });
    });
  });

  ipcMain.handle("host:list-directory", async (_event, dirPath) => {
    const dir = assertGranted(dirPath);
    const entries = await fsp.readdir(dir, { withFileTypes: true });
    // Subfolders are listed too, so a corpus with per-source directories
    // reads the same as it does under the dev server.
    return entries
      .filter((entry) => !entry.name.startsWith("."))
      .map((entry) => {
        const full = path.join(dir, entry.name);
        if (!entry.isDirectory()) return describeFile(full);
        return { name: entry.name, path: full, ext: "", size: 0, isDirectory: true };
      });
  });
}

/**
 * `TRACKDRAFT_SMOKE=1 npx electron .` — boot the shell, assert the things that
 * only exist under Electron, print one JSON line, quit. This is how the
 * protocol, the preload bridge and the path guard get tested without a human
 * clicking through a native dialog.
 */
function runSmokeTest(win) {
  const timer = setTimeout(() => {
    console.log("SMOKE", JSON.stringify({ ok: false, error: "timed out waiting for load" }));
    app.exit(1);
  }, 20000);

  win.webContents.once("did-finish-load", async () => {
    try {
      const probeSource = fs.readFileSync(path.join(__dirname, "smoke-probe.js"), "utf8");
      const probe = await win.webContents.executeJavaScript(probeSource);
      console.log("SMOKE", JSON.stringify({ ok: true, ...probe, errors: smokeErrors }));
      clearTimeout(timer);
      app.quit();
    } catch (error) {
      clearTimeout(timer);
      console.log("SMOKE", JSON.stringify({ ok: false, error: String(error && error.message || error) }));
      app.exit(1);
    }
  });
}

/* One identity for dev and packaged runs: without this, `npx electron .` uses
 * the workspace package name ("trackdraft") for userData while the packaged
 * bundle uses productName ("TrackDraft"), and the two libraries never meet. */
app.setName("TrackDraft");

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    hardenSession();
    if (!DEV_URL) serveDist();
    registerIpc();
    buildMenu();

    mainWindow = createWindow({ url: DEV_URL || ORIGIN });
    mainWindow.on("closed", () => {
      mainWindow = null;
    });
    if (process.env.TRACKDRAFT_SMOKE) runSmokeTest(mainWindow);

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        mainWindow = createWindow({ url: DEV_URL || ORIGIN });
      }
    });
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
}
