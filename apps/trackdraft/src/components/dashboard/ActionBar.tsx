import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useSongStore } from "../../store/songStore";
import { readSongFile } from "../../lib/exportImport";
import { extractVideoId } from "../../lib/youtube";
import { parseSyncedLyrics } from "../../lib/youtube";
import type { BlueprintSong, BlueprintSection, LyricsTimelineEntry } from "../../types/blueprint";
import type { NoteName, ChordQuality } from "@music-theory/core";

// ---------------------------------------------------------------------------
// Chord name parser (shared with chordmini-bridge.ts)
// ---------------------------------------------------------------------------

interface ChordMiniAppResult {
  key: string;
  scale: string;
  bpm: number;
  time_signature?: { numerator: number; denominator: number };
  chords: Array<{ chord: string; start_time: number; duration: number; confidence?: number }>;
  segments?: Array<{ label: string; start_time: number; end_time: number }>;
}

function parseChordName(chordName: string): { root: NoteName; quality: ChordQuality } | null {
  const match = chordName.match(/^([A-G][#b]?)(maj7|min7|m7b5|maj|min|m|dim|aug|sus2|sus4|7)?$/i);
  if (!match) return null;
  const rawRoot = match[1];
  const root = (rawRoot.charAt(0).toUpperCase() + rawRoot.slice(1).toLowerCase()) as NoteName;
  const suffix = match[2]?.toLowerCase() ?? "";
  const qualityMap: Record<string, ChordQuality> = {
    "": "maj", "maj": "maj", "min": "min", "m": "min", "7": "7",
    "maj7": "maj7", "min7": "min7", "m7b5": "m7b5",
    "sus2": "sus2", "sus4": "sus4", "dim": "dim", "aug": "aug",
  };
  return { root, quality: qualityMap[suffix] ?? "maj" };
}

function chordMiniAppToBlueprintSong(
  json: ChordMiniAppResult,
  title: string,
  artist?: string,
  lrclibData?: { syncedLyrics?: string; plainLyrics?: string } | null,
): BlueprintSong {
  const now = new Date().toISOString();
  const scale = json.scale?.toLowerCase() === "minor" ? "aeolian" : "ionian";
  const key = (json.key ?? "C") as NoteName;
  const bpm = json.bpm ?? 120;
  const timeSigNum = json.time_signature?.numerator ?? 4;
  const timeSigDen = json.time_signature?.denominator ?? 4;
  const secondsPerBeat = 60 / bpm;

  // Convert chords from seconds to beats
  const allChords = (json.chords ?? []).map((c) => {
    const parsed = parseChordName(c.chord);
    const durationBeats = Math.max(1, Math.round((c.duration / secondsPerBeat) * 100) / 100);
    return {
      id: crypto.randomUUID(),
      romanNumeral: parsed?.root ?? "C",
      root: parsed?.root ?? "C",
      quality: parsed?.quality ?? "maj",
      beats: Math.round(durationBeats),
    };
  });

  // Build sections from segments, or single section from all chords
  let sections: BlueprintSection[] = [];
  if (json.segments && json.segments.length > 0) {
    sections = json.segments.map((seg, i) => {
      const durationBeats = (seg.end_time - seg.start_time) / secondsPerBeat;
      const chordsPerSegment = Math.ceil(allChords.length / Math.max(1, json.segments!.length));
      const segmentChordSlice = allChords.slice(i * chordsPerSegment, (i + 1) * chordsPerSegment);
      const roleMap: Record<string, BlueprintSection["role"]> = {
        intro: "intro", verse: "verse", chorus: "chorus", pre_chorus: "verse",
        bridge: "bridge", outro: "outro", solo: "solo", breakdown: "breakdown",
      };
      return {
        id: crypto.randomUUID(),
        name: seg.label || `Section ${i + 1}`,
        role: roleMap[seg.label?.toLowerCase()] ?? "custom",
        bars: Math.max(4, Math.ceil(durationBeats / timeSigNum)),
        chords: segmentChordSlice,
        beatsPerChord: 4,
        velocity: "mf",
        timeSignatureNumerator: timeSigNum,
        timeSignatureDenPower: Math.log2(timeSigDen),
      };
    });
  } else if (allChords.length > 0) {
    const totalBeats = allChords.reduce((sum, c) => sum + c.beats, 0);
    sections = [{
      id: crypto.randomUUID(),
      name: "Full Song",
      role: "verse",
      bars: Math.max(16, Math.ceil(totalBeats / timeSigNum)),
      chords: allChords,
      beatsPerChord: 4,
      velocity: "mf",
      timeSignatureNumerator: timeSigNum,
      timeSignatureDenPower: Math.log2(timeSigDen),
    }];
  }

  // Attach lyrics if available
  if (lrclibData?.syncedLyrics && sections.length > 0) {
    const timeline = parseSyncedLyrics(lrclibData.syncedLyrics, bpm);
    if (timeline.length > 0) {
      const fullText = lrclibData.plainLyrics || timeline.map((t) => t.text).join("\n");
      const lyricsTimeline: LyricsTimelineEntry[] = timeline.map((t) => ({ text: t.text, startBeat: t.startBeat }));

      if (sections.length === 1) {
        sections[0].lyrics = fullText;
        sections[0].lyricsTimeline = lyricsTimeline;
      } else {
        // Distribute lyrics across sections by beat range
        let cumulativeBeats = 0;
        for (const section of sections) {
          const sectionBeats = section.bars * timeSigNum;
          const endBeat = cumulativeBeats + sectionBeats;
          const sectionLyrics = lyricsTimeline.filter((l) => l.startBeat >= cumulativeBeats && l.startBeat < endBeat);
          if (sectionLyrics.length > 0) {
            section.lyrics = sectionLyrics.map((l) => l.text).join("\n");
            section.lyricsTimeline = sectionLyrics;
          }
          cumulativeBeats = endBeat;
        }
      }
    }
  }

  return {
    id: crypto.randomUUID(),
    title,
    artist,
    key,
    scale: scale as BlueprintSong["scale"],
    bpm,
    timeSignatureNumerator: timeSigNum,
    timeSignatureDenominator: timeSigDen,
    sections,
    arrangement: sections.map((s) => ({ sectionId: s.id, repeats: 1 })),
    concept: `YouTube full import: ${json.chords?.length ?? 0} chords, ${json.segments?.length ?? 0} segments, ${lrclibData?.syncedLyrics ? "synced lyrics" : "no lyrics"}`,
    provenance: {
      source: "audio-extract",
      extractedAt: now,
      warnings: [
        `Chord detection by ChordMiniApp — review and adjust.`,
        `Key: ${key} ${json.scale ?? "major"}, BPM: ${bpm}`,
        ...(lrclibData?.syncedLyrics ? ["Synced lyrics from LRCLIB — review section boundaries."] : []),
      ],
    },
    createdAt: now,
    updatedAt: now,
  };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

type ProgressStep = { step: string; message: string } | null;

export default function ActionBar() {
  const createNewSong = useSongStore((s) => s.createNewSong);
  const importSong = useSongStore((s) => s.importSong);
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const audioInputRef = useRef<HTMLInputElement>(null);

  const [newTitle, setNewTitle] = useState("");
  const [importError, setImportError] = useState<string | null>(null);
  const [youtubeUrl, setYoutubeUrl] = useState("");
  const [youtubeLoading, setYoutubeLoading] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [progressStep, setProgressStep] = useState<ProgressStep>(null);

  async function handleImportFile(file: File) {
    try {
      const song = await readSongFile(file);
      importSong(song);
      setImportError(null);
      navigate(`/song/${song.id}`);
    } catch (err) {
      setImportError(err instanceof Error ? err.message : "Failed to import file.");
    }
  }

  /** One-click YouTube full import: download → ChordMiniApp → LRCLIB → assemble */
  async function handleYoutubeFullImport() {
    const input = youtubeUrl.trim();
    if (!input) return;

    const videoId = extractVideoId(input);
    if (!videoId) {
      setImportError("Not a valid YouTube URL or video ID.");
      return;
    }

    setYoutubeLoading(true);
    setImportError(null);
    setProgressStep({ step: "start", message: "Starting…" });

    try {
      const res = await fetch("/__youtube-full-import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ videoId }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error ?? `Server returned ${res.status}`);
      }

      // Read SSE stream for progress updates
      const reader = res.body?.getReader();
      if (!reader) throw new Error("No response body");

      const decoder = new TextDecoder();
      let buffer = "";
      let resultData: {
        title?: string;
        artist?: string;
        chordMiniData?: ChordMiniAppResult;
        lrclibData?: Record<string, unknown>;
      } = {};

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        let currentEvent = "";
        for (const line of lines) {
          if (line.startsWith("event: ")) {
            currentEvent = line.slice(7).trim();
          } else if (line.startsWith("data: ")) {
            try {
              const data = JSON.parse(line.slice(6));
              if (currentEvent === "progress") {
                setProgressStep({ step: data.step as string, message: data.message as string });
                if (data.step === "analyze") {
                  resultData.chordMiniData = data as unknown as ChordMiniAppResult;
                }
              } else if (currentEvent === "error") {
                throw new Error(data.error as string);
              } else if (currentEvent === "result") {
                resultData = { ...resultData, ...data };
              }
            } catch (parseErr) {
              if (parseErr instanceof Error && parseErr.message !== "Unexpected end of JSON input") {
                throw parseErr;
              }
            }
          }
        }
      }

      if (!resultData.title || !resultData.chordMiniData) {
        throw new Error("Import completed but returned no data");
      }

      const lrclib = resultData.lrclibData as { syncedLyrics?: string; plainLyrics?: string } | undefined;
      const song = chordMiniAppToBlueprintSong(
        resultData.chordMiniData,
        resultData.title,
        resultData.artist,
        lrclib,
      );

      importSong(song);
      setYoutubeUrl("");
      setProgressStep(null);
      navigate(`/song/${song.id}`);
    } catch (err) {
      setImportError(err instanceof Error ? err.message : "YouTube import failed.");
      setProgressStep(null);
    } finally {
      setYoutubeLoading(false);
    }
  }

  async function handleAudioAnalyze(file: File) {
    setAnalyzing(true);
    setImportError(null);
    try {
      const res = await fetch("/__chordmini-analyze", {
        method: "POST",
        body: file,
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error ?? `Server returned ${res.status}`);
      }
      const json = await res.json() as ChordMiniAppResult;
      if (!json.chords || json.chords.length === 0) {
        setImportError("ChordMiniApp returned no chords — the audio may be too quiet or silent.");
        return;
      }
      const title = file.name.replace(/\.[^.]+$/, "").replace(/[-_]/g, " ");
      const song = chordMiniAppToBlueprintSong(json, title);
      importSong(song);
      navigate(`/song/${song.id}`);
    } catch (err) {
      setImportError(err instanceof Error ? err.message : "Audio analysis failed.");
    } finally {
      setAnalyzing(false);
    }
  }

  return (
    <div className="px-3 py-2 border-b border-edge shrink-0 space-y-2">
      {/* Row 1: New song + Import JSON */}
      <div className="flex items-center gap-2">
        <form
          className="flex gap-2 flex-1"
          onSubmit={(e) => {
            e.preventDefault();
            const title = newTitle.trim();
            if (!title) return;
            const song = createNewSong(title);
            setNewTitle("");
            navigate(`/song/${song.id}`);
          }}
        >
          <input
            className="flex-1 bg-panel border border-edge rounded px-2 py-1 text-xs"
            placeholder="New song title…"
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
          />
          <button
            type="submit"
            className="bg-accent text-black font-medium px-3 py-1 rounded text-xs"
          >
            Create
          </button>
        </form>
        <button
          className="border border-edge rounded px-3 py-1 text-xs text-inkMuted hover:text-ink hover:bg-panelAlt"
          onClick={() => fileInputRef.current?.click()}
        >
          Import .json
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleImportFile(file);
            e.target.value = "";
          }}
        />
      </div>

      {/* Row 2: YouTube one-click full import */}
      <div className="flex items-center gap-2">
        <input
          className="flex-1 bg-panel border border-edge rounded px-2 py-1 text-xs"
          placeholder="YouTube URL or video ID…"
          value={youtubeUrl}
          onChange={(e) => setYoutubeUrl(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleYoutubeFullImport()}
        />
        <button
          className="border border-accent text-accent rounded px-3 py-1 text-xs hover:bg-accent/10 disabled:opacity-40 font-medium"
          onClick={handleYoutubeFullImport}
          disabled={youtubeLoading || !youtubeUrl.trim()}
        >
          {youtubeLoading ? "…" : "▶ One-Click Import"}
        </button>
      </div>

      {/* Progress indicator */}
      {progressStep && (
        <div className="flex items-center gap-2 px-1">
          <span className="text-[10px] text-emerald-400 font-mono">
            {progressStep.step === "start" && "⬇ Starting…"}
            {progressStep.step === "metadata" && "🔍 " + progressStep.message}
            {progressStep.step === "download" && "⬇ " + progressStep.message}
            {progressStep.step === "analyze" && "🎵 " + progressStep.message}
            {progressStep.step === "lyrics" && "📝 " + progressStep.message}
            {progressStep.step === "assemble" && "📦 " + progressStep.message}
          </span>
        </div>
      )}

      {/* Row 3: ChordMiniApp audio analysis (standalone file picker) */}
      <div className="flex items-center gap-2">
        <span className="text-[10px] text-inkMuted/60 flex-1">
          {analyzing ? "Analyzing audio with ChordMiniApp…" : "Analyze audio file (chords + key + BPM + structure)"}
        </span>
        <button
          className="border border-purple-400/50 text-purple-300 rounded px-3 py-1 text-xs hover:bg-purple-400/10 disabled:opacity-40"
          onClick={() => audioInputRef.current?.click()}
          disabled={analyzing}
        >
          {analyzing ? "Analyzing…" : "🎵 Analyze Audio"}
        </button>
        <input
          ref={audioInputRef}
          type="file"
          accept="audio/*,.mp3,.wav,.aif,.aiff,.flac,.ogg"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleAudioAnalyze(file);
            e.target.value = "";
          }}
        />
      </div>

      {importError && <p className="text-[10px] text-red-400">{importError}</p>}
    </div>
  );
}