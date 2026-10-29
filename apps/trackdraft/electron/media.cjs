/**
 * Audio/YouTube capabilities for the packaged app.
 *
 * These four jobs used to live as Vite dev middleware, so they existed only
 * while the dev server ran — in the built app the buttons fetched
 * `app://localhost/__youtube-*` and got a 404. They are plain Node work
 * (global fetch, spawning yt-dlp/ffmpeg), so the main process can do them
 * directly.
 *
 * Everything here degrades with a real message rather than a mystery 404:
 * yt-dlp missing, ffmpeg missing, or ChordMiniApp not running are the three
 * normal failure modes on a fresh machine.
 */
const fs = require("node:fs");
const { execFile, execFileSync } = require("node:child_process");

const CHORDMINI_URL = process.env.CHORDMINI_URL ?? "http://localhost:5000/analyze";
const CHORDMINI_LABEL = CHORDMINI_URL.replace(/^https?:\/\//, "").replace(/\/analyze$/, "");
const VIDEO_ID = /^[a-zA-Z0-9_-]{11}$/;

/** yt-dlp is an external binary (brew install yt-dlp). Resolved the same way
 *  the dev server did, so one-machine setup notes stay true. */
function resolveYtDlpPath() {
  for (const candidate of ["/opt/homebrew/bin/yt-dlp", "/usr/local/bin/yt-dlp", "/usr/bin/yt-dlp"]) {
    if (fs.existsSync(candidate)) return candidate;
  }
  try {
    return execFileSync("which", ["yt-dlp"], { encoding: "utf8" }).trim();
  } catch {
    return null;
  }
}

function assertVideoId(videoId) {
  if (typeof videoId !== "string" || !VIDEO_ID.test(videoId)) {
    throw new Error("That isn't a valid YouTube video id.");
  }
  return videoId;
}

/** oEmbed: title + channel, no API key, no quota. */
async function fetchYoutubeMeta(videoId) {
  assertVideoId(videoId);
  const url = `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`;
  const res = await fetch(url).catch(() => null);
  if (!res || !res.ok) throw new Error("Video not found or unavailable.");
  const oembed = await res.json();
  return { title: oembed.title, artist: oembed.author_name, videoId };
}

/** Run a child process that writes binary to stdout. */
function spawnToBuffer(command, args, { timeout = 120_000, maxBuffer = 200 * 1024 * 1024, stdin } = {}) {
  return new Promise((resolve, reject) => {
    const proc = execFile(command, args, { encoding: null, timeout, maxBuffer });
    const parts = [];
    let stderr = "";
    proc.stdout?.on("data", (chunk) => parts.push(chunk));
    proc.stderr?.on("data", (data) => {
      stderr += data.toString();
    });
    proc.on("error", (err) => reject(new Error(`${command.split("/").pop()}: ${err.message}`)));
    proc.on("close", (code) => {
      if (code !== 0) {
        const tail = stderr.split("\n").filter(Boolean).slice(-3).join("; ").slice(0, 300);
        reject(new Error(`${command.split("/").pop()} exited with code ${code}${tail ? `: ${tail}` : ""}`));
        return;
      }
      const buffer = Buffer.concat(parts);
      if (buffer.length === 0) reject(new Error(`${command.split("/").pop()} produced no output`));
      else resolve(buffer);
    });
    if (stdin) {
      proc.stdin?.on("error", () => {
        /* ffmpeg rejecting the pipe surfaces through the exit code */
      });
      proc.stdin?.end(stdin);
    }
  });
}

/** Native m4a straight to stdout — no ffmpeg needed for the download itself. */
async function downloadYoutubeAudio(videoId) {
  const ytdlp = resolveYtDlpPath();
  if (!ytdlp) {
    throw new Error(
      "yt-dlp isn't installed. Install it with `brew install yt-dlp` and try again.",
    );
  }
  assertVideoId(videoId);
  return spawnToBuffer(
    ytdlp,
    ["-f", "bestaudio[ext=m4a]/bestaudio/best", "-o", "-", "--no-playlist", `https://www.youtube.com/watch?v=${videoId}`],
    { timeout: 120_000 },
  );
}

/** ChordMiniApp expects wav it can decode; m4a often fails silently. Falls
 *  back to the raw bytes when ffmpeg is missing, exactly as the dev endpoint
 *  did, so a machine without ffmpeg still gets a shot at analysis. */
async function toWav(audio) {
  try {
    return await spawnToBuffer(
      "ffmpeg",
      ["-i", "pipe:0", "-f", "wav", "-ar", "44100", "-ac", "1", "pipe:1"],
      { timeout: 60_000, maxBuffer: 500 * 1024 * 1024, stdin: audio },
    );
  } catch {
    return audio;
  }
}

/** POST raw audio to the local ChordMiniApp analysis server. */
async function analyzeChords(audio) {
  if (!audio || audio.length === 0) throw new Error("No audio to analyze.");
  const res = await fetch(CHORDMINI_URL, {
    method: "POST",
    headers: { "Content-Type": "application/octet-stream" },
    body: audio,
  }).catch(() => null);
  if (!res) {
    throw new Error(
      `Could not reach ChordMiniApp at ${CHORDMINI_LABEL}. Start its Python server, then retry.`,
    );
  }
  if (!res.ok) throw new Error(`ChordMiniApp returned ${res.status}.`);
  return res.json();
}

/** Keyless lyric lookup. Returns the best match, preferring synced lyrics. */
async function fetchLyrics(title, artist) {
  const params = new URLSearchParams({ track_name: title });
  if (artist) params.set("artist_name", artist);
  const res = await fetch(`https://lrclib.net/api/search?${params}`).catch(() => null);
  if (!res || !res.ok) return null;
  const results = await res.json().catch(() => null);
  if (!Array.isArray(results) || results.length === 0) return null;
  return results.find((r) => r.syncedLyrics) ?? results[0];
}

/**
 * One-click YouTube → analysis → lyrics. Returns the same payload shape the
 * dev endpoint's SSE `result` event carried, so the renderer assembles the
 * BlueprintSong exactly as before.
 */
async function fullImport(videoId, onProgress = () => {}) {
  onProgress("metadata", "Fetching YouTube metadata…");
  const meta = await fetchYoutubeMeta(videoId);
  onProgress("metadata", `Found: "${meta.title}" by ${meta.artist}`);

  onProgress("download", "Downloading audio…");
  const raw = await downloadYoutubeAudio(videoId);
  onProgress("download", `Audio downloaded (${(raw.length / 1048576).toFixed(1)} MB)`);

  onProgress("convert", "Preparing audio for analysis…");
  const wav = await toWav(raw);
  onProgress("convert", `Ready for analysis (${(wav.length / 1048576).toFixed(1)} MB)`);

  onProgress("analyze", "Analyzing with ChordMiniApp…");
  const chordMiniData = await analyzeChords(wav);
  const chordCount = Array.isArray(chordMiniData.chords) ? chordMiniData.chords.length : 0;
  const segmentCount = Array.isArray(chordMiniData.segments) ? chordMiniData.segments.length : 0;
  if (chordCount === 0 && segmentCount === 0) {
    throw new Error("ChordMiniApp returned an empty analysis — the audio may be too quiet or silent.");
  }
  onProgress(
    "analyze",
    `Analysis complete: ${chordCount} chords, ${segmentCount} segments, key ${chordMiniData.key ?? "?"}, ${chordMiniData.bpm ?? "?"} BPM`,
  );

  onProgress("lyrics", "Searching for synced lyrics…");
  const lrclibData = await fetchLyrics(meta.title, meta.artist).catch(() => null);
  onProgress("lyrics", lrclibData ? "Lyrics found" : "No lyrics found on LRCLIB");

  // The renderer's assembler spells a few fields differently at its edge, so
  // hand back null rather than undefined for "nothing found".
  return { title: meta.title, artist: meta.artist, chordMiniData, lrclibData: lrclibData ?? null };
}

module.exports = {
  CHORDMINI_LABEL,
  analyzeChords,
  fetchLyrics,
  fetchYoutubeMeta,
  fullImport,
  resolveYtDlpPath,
  toWav,
};
