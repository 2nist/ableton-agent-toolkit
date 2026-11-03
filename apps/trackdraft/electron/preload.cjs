/**
 * The renderer's entire view of the desktop host.
 *
 * Deliberately tiny: five functions, no arbitrary path access, no Node. The
 * renderer asks the main process to show a dialog; the dialog grants access;
 * reads are refused for anything that was not granted.
 *
 * Sandboxed preload — CJS, and only `electron` may be required.
 */

const { contextBridge, ipcRenderer } = require("electron");

/**
 * @typedef {{ name: string, path: string, ext: string, size: number }} HostFile
 */

contextBridge.exposeInMainWorld("trackdraft", {
  isElectron: true,

  /** Versions/platform, for the Settings panel and bug reports. */
  appInfo: () => ipcRenderer.invoke("host:app-info"),

  /**
   * Native open dialog. `multiple` picks several songs in one go.
   * @param {{ multiple?: boolean }} [options]
   * @returns {Promise<HostFile[]>}
   */
  pickFiles: (options) => ipcRenderer.invoke("host:pick-files", options ?? {}),

  /** @returns {Promise<string | null>} */
  pickDirectory: () => ipcRenderer.invoke("host:pick-directory"),

  /** @param {string} filePath @returns {Promise<string>} */
  readText: (filePath) => ipcRenderer.invoke("host:read-text", filePath),

  /** @param {string} filePath @returns {Promise<Uint8Array>} */
  readBytes: (filePath) => ipcRenderer.invoke("host:read-bytes", filePath),

  /**
   * `.als` only: the Live Set XML, already gunzipped by the main process.
   * @param {string} filePath @returns {Promise<string>}
   */
  readAlsXml: (filePath) => ipcRenderer.invoke("host:read-als-xml", filePath),

  /** @param {string} dirPath @returns {Promise<HostFile[]>} */
  listDirectory: (dirPath) => ipcRenderer.invoke("host:list-directory", dirPath),
  presetDir: () => ipcRenderer.invoke("host:preset-dir"),
  presetList: () => ipcRenderer.invoke("host:preset-list"),
  presetLoad: (name) => ipcRenderer.invoke("host:preset-load", name),
  presetSave: (name, xml) => ipcRenderer.invoke("host:preset-save", name, xml),

  /* The song library lives on disk in the desktop build — localStorage's ~5 MB
   * cannot hold the catalogue. Main seeds it from the bundled pack on first run. */
  libraryLoad: () => ipcRenderer.invoke("host:library-load"),
  libraryWrite: (song) => ipcRenderer.invoke("host:library-write", song),
  libraryDelete: (songId) => ipcRenderer.invoke("host:library-delete", songId),
  libraryInfo: () => ipcRenderer.invoke("host:library-info"),

  /** Saved beats: `<library>/tables/beats.json`, portable and hand-editable. */
  beatsLoad: () => ipcRenderer.invoke("host:beats-load"),
  beatsSave: (beats) => ipcRenderer.invoke("host:beats-save", beats),

  /** Engine tables: `<library>/tables/*.json`, loaded at boot. */
  tablesLoad: () => ipcRenderer.invoke("host:tables-load"),
  tablesSave: (filename, data) => ipcRenderer.invoke("host:tables-save", filename, data),
  tablesDelete: (filename) => ipcRenderer.invoke("host:tables-delete", filename),

  /* ── audio analysis / YouTube import ───────────────────────────────────
   * Main does the fetching and the child processes (see electron/media.cjs);
   * the renderer only ever sees results and progress strings. */
  /** @param {string} videoId @returns {Promise<{title: string, artist: string, videoId: string}>} */
  youtubeMeta: (videoId) => ipcRenderer.invoke("media:youtube-meta", videoId),

  /** @param {Uint8Array} bytes @returns {Promise<unknown>} raw ChordMiniApp JSON */
  analyzeAudio: (bytes) => ipcRenderer.invoke("media:chordmini-analyze", bytes),

  /**
   * Metadata → audio → ChordMiniApp → LRCLIB, with progress events.
   * @param {string} videoId
   * @param {(update: {step: string, message: string}) => void} [onProgress]
   */
  youtubeFullImport: (videoId, onProgress) => {
    // A per-call id keeps two concurrent imports from crossing their progress
    // streams; the listener is torn down even when the import throws.
    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const handler = (_event, payload) => {
      if (payload && payload.id === id) onProgress?.({ step: payload.step, message: payload.message });
    };
    ipcRenderer.on("media:progress", handler);
    return ipcRenderer
      .invoke("media:youtube-full-import", { videoId, id })
      .finally(() => ipcRenderer.removeListener("media:progress", handler));
  },

  /** Fired by File → Import Song… (Cmd/Ctrl+O). Returns an unsubscribe. */
  onMenuImport: (listener) => {
    const handler = () => listener();
    ipcRenderer.on("menu:import", handler);
    return () => ipcRenderer.removeListener("menu:import", handler);
  },
});
