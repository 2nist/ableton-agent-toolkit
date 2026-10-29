import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as zlib from "node:zlib";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseHostFile } from "./index";
import type { HostFile, TrackDraftHost } from "../host";

/**
 * The Electron import path, without Electron.
 *
 * `parseHostFile` is the only thing standing between the native dialog and the
 * parsers, and it cannot be exercised by clicking in CI — so this drives it
 * through a fake host bridge backed by a real temp directory. If these pass,
 * the packaged "Import file…" path works for every format the renderer can
 * parse; only the OS dialog itself is left untested.
 */

let dir: string;

function file(name: string, contents: string | Uint8Array): HostFile {
  const full = path.join(dir, name);
  fs.writeFileSync(full, contents);
  return { name, path: full, ext: name.split(".").pop() ?? "", size: fs.statSync(full).size };
}

/** A minimal format-0 MIDI file with one note, one track. */
function midiBytes(): Uint8Array {
  const events = [
    0x00, 0x90, 0x3c, 0x64, // noteOn C4 v100
    0x60, 0x80, 0x3c, 0x00, // noteOff after 96 ticks
    0x00, 0xff, 0x2f, 0x00, // end of track
  ];
  const header = [0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1, 0x01, 0xe0];
  const len = events.length;
  const trackHeader = [0x4d, 0x54, 0x72, 0x6b, 0, 0, 0, len];
  return new Uint8Array([...header, ...trackHeader, ...events]);
}

function installHost(reads: string[] = []): void {
  const host: TrackDraftHost = {
    isElectron: true,
    appInfo: async () => ({ version: "test", electron: "test", chrome: "test", node: "test", platform: "test" }),
    pickFiles: async () => [],
    pickDirectory: async () => null,
    beatsLoad: async () => ({ beats: [], path: "/tmp/beats.json" }),
    beatsSave: async () => ({ ok: true, path: "/tmp/beats.json", count: 0 }),
    tablesLoad: async () => ({ dir: "/tmp/tables", files: {}, errors: {} }),
    tablesSave: async () => ({ ok: true, path: "/tmp/tables/x.json" }),
    tablesDelete: async () => ({ ok: true }),
    readText: async (p) => {
      reads.push(`text:${path.basename(p)}`);
      return fs.readFileSync(p, "utf8");
    },
    readBytes: async (p) => {
      reads.push(`bytes:${path.basename(p)}`);
      return new Uint8Array(fs.readFileSync(p));
    },
    readAlsXml: async (p) => {
      reads.push(`alsXml:${path.basename(p)}`);
      const raw = fs.readFileSync(p);
      try {
        return zlib.gunzipSync(raw).toString("utf8");
      } catch {
        return raw.toString("utf8");
      }
    },
    listDirectory: async () => [],
    libraryLoad: async () => ({ songs: [], seeded: 0, unreadable: 0, dir: "", distribution: "none" }),
    libraryWrite: async () => ({ ok: true }),
    libraryDelete: async () => ({ ok: true }),
    libraryInfo: async () => ({ dir: "", distribution: "none" }),
    youtubeMeta: async (videoId) => ({ title: "", artist: "", videoId }),
    analyzeAudio: async () => ({}),
    youtubeFullImport: async () => ({ title: "", artist: "", chordMiniData: {}, lrclibData: null }),
    onMenuImport: () => () => {},
  };
  (globalThis as unknown as { window: unknown }).window = {
    trackdraft: host,
    location: { hostname: "localhost", origin: "app://localhost", protocol: "app:" },
  };
}

function removeHost(): void {
  delete (globalThis as unknown as { window?: unknown }).window;
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "trackdraft-host-"));
  // Import paths run lyric enrichment, which calls lrclib.net. Tests must not
  // touch the network: a failed lookup is a normal, handled outcome.
  vi.stubGlobal("fetch", async () => ({ ok: false, status: 503 }) as unknown as Response);
});

afterEach(() => {
  vi.unstubAllGlobals();
  removeHost();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("parseHostFile", () => {
  it("refuses to run without a host", async () => {
    const f = file("song.json", "{}");
    const result = await parseHostFile(f);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("desktop host");
  });

  it("imports a blueprint JSON through the host", async () => {
    const reads: string[] = [];
    installHost(reads);
    const song = {
      id: "local-test",
      title: "Host Song",
      key: "C",
      scale: "ionian",
      bpm: 120,
      timeSignatureNumerator: 4,
      timeSignatureDenominator: 4,
      sections: [
        {
          id: "s1",
          name: "Verse",
          role: "verse",
          bars: 4,
          beatsPerChord: 4,
          velocity: "mf",
          timeSignatureNumerator: 4,
          timeSignatureDenPower: 2,
          chords: [{ id: "c1", romanNumeral: "I", root: "C", quality: "maj", beats: 4 }],
        },
      ],
      arrangement: [{ sectionId: "s1", repeats: 1 }],
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    };
    const result = await parseHostFile(file("host-song.json", JSON.stringify(song)));
    expect(result.ok, result.ok ? "" : result.error).toBe(true);
    if (result.ok) {
      expect(result.song.title).toBe("Host Song");
      expect(result.song.sections).toHaveLength(1);
    }
    // JSON goes through the text reader, not the byte reader.
    expect(reads.some((r) => r.startsWith("text:"))).toBe(true);
  });

  it("imports MIDI bytes through the host", async () => {
    const reads: string[] = [];
    installHost(reads);
    const result = await parseHostFile(file("take.mid", midiBytes()));
    expect(reads.some((r) => r.startsWith("bytes:"))).toBe(true);
    // The parser produces a song (even a nearly empty one) from one note.
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.song.sections.length).toBeGreaterThan(0);
  });

  it("imports lyrics text", async () => {
    installHost();
    const result = await parseHostFile(file("sketch.txt", "first line\nsecond line\n"));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.song.sections[0]?.lyrics).toContain("second line");
  });

  it("uses the host's decompressed XML for .als — the path the browser cannot take", async () => {
    const reads: string[] = [];
    installHost(reads);
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Ableton><LiveSet>
  <Tempo><Manual Value="124" /><AutomationTarget Id="1" /></Tempo>
  <Locators>
    <Locator Id="1"><Name Value="Intro" /><Time Value="0" /></Locator>
    <Locator Id="2"><Name Value="Verse" /><Time Value="16" /></Locator>
  </Locators>
</LiveSet></Ableton>`;
    const gz = zlib.gzipSync(Buffer.from(xml, "utf8"));
    const result = await parseHostFile(file("set.als", new Uint8Array(gz)));

    // The point of this test is the wiring: the XML must come from the host,
    // not from a Node zlib the renderer does not have.
    expect(reads).toContain("alsXml:set.als");
    expect(result.ok, result.ok ? "" : result.error).toBe(true);
    if (result.ok) {
      expect(result.song.title).toBe("set");
      expect(result.song.sections.length).toBeGreaterThan(0);
    }
  });

  it("reports a parse failure instead of throwing", async () => {
    installHost();
    const result = await parseHostFile(file("broken.json", "{not json"));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.length).toBeGreaterThan(0);
  });

  it("propagates a host read refusal as an error, not a crash", async () => {
    const host = {
      isElectron: true as const,
      appInfo: async () => ({ version: "", electron: "", chrome: "", node: "", platform: "" }),
      pickFiles: async () => [],
      pickDirectory: async () => null,
      readText: async () => {
        throw new Error("Refusing to read /etc/passwd: it was not chosen in this session.");
      },
      readBytes: async () => {
        throw new Error("refused");
      },
      readAlsXml: async () => {
        throw new Error("refused");
      },
      listDirectory: async () => [],
      libraryLoad: async () => ({ songs: [], seeded: 0, unreadable: 0, dir: "", distribution: "none" }),
      libraryWrite: async () => ({ ok: true }),
      libraryDelete: async () => ({ ok: true }),
      libraryInfo: async () => ({ dir: "", distribution: "none" }),
      youtubeMeta: async (videoId: string) => ({ title: "", artist: "", videoId }),
      analyzeAudio: async () => ({}),
      youtubeFullImport: async () => ({ title: "", artist: "", chordMiniData: {}, lrclibData: null }),
      onMenuImport: () => () => {},
    };
    (globalThis as unknown as { window: unknown }).window = {
      trackdraft: host,
      location: { hostname: "localhost", origin: "app://localhost", protocol: "app:" },
    };

    const result = await parseHostFile(file("song.json", "{}"));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("not chosen in this session");
  });
});
