import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useSongStore } from "../../store/songStore";
import { readSongFile } from "../../lib/exportImport";
import { extractVideoId, fetchYoutubeMetadata, searchLrclib, buildYoutubeBlueprintSong } from "../../lib/youtube";
import type { BlueprintSong, BlueprintSection } from "../../types/blueprint";
import type { NoteName, ChordQuality } from "@music-theory/core";

// ---------------------------------------------------------------------------
// ChordMiniApp conversion (inline — same logic as scripts/chordmini-bridge.ts)
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

function chordMiniAppToBlueprintSong(json: ChordMiniAppResult, title: string): BlueprintSong {
  const now = new Date().toISOString();
  const scale = json.scale?.toLowerCase() === "minor" ? "aeolian" : "ionian";
  const key = (json.key ?? "C") as NoteName;
  const bpm = json.bpm ?? 120;
  const timeSigNum = json.time_signature?.numerator ?? 4;
  const timeSigDen = json.time_signature?.denominator ?? 4;
  const secondsPerBeat = 60 / bpm;

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

  return {
    id: crypto.randomUUID(),
    title,
    key,
    scale: scale as BlueprintSong["scale"],
    bpm,
    timeSignatureNumerator: timeSigNum,
    timeSignatureDenominator: timeSigDen,
    sections,
    arrangement: sections.map((s) => ({ sectionId: s.id, repeats: 1 })),
    concept: `ChordMiniApp analysis: ${json.chords?.length ?? 0} chords, ${json.segments?.length ?? 0} segments`,
    provenance: {
      source: "audio-extract",
      extractedAt: now,
      warnings: [`Chord detection by ChordMiniApp — review and adjust. Key: ${key} ${json.scale ?? "major"}, BPM: ${bpm}`],
    },
    createdAt: now,
    updatedAt: now,
  };
}

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

  async function handleYoutubeImport() {
    const input = youtubeUrl.trim();
    if (!input) return;

    const videoId = extractVideoId(input);
    if (!videoId) {
      setImportError("Not a valid YouTube URL or video ID.");
      return;
    }

    setYoutubeLoading(true);
    setImportError(null);

    try {
      const metadata = await fetchYoutubeMetadata(videoId);
      if (!metadata) {
        setImportError("Could not fetch YouTube video metadata. Video may be unavailable.");
        setYoutubeLoading(false);
        return;
      }
      const lrclib = await searchLrclib(metadata.title, metadata.artist);
      const song = buildYoutubeBlueprintSong(metadata, lrclib);
      importSong(song);
      setYoutubeUrl("");
      navigate(`/song/${song.id}`);
    } catch (err) {
      setImportError(err instanceof Error ? err.message : "Failed to import from YouTube.");
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

      {/* Row 2: YouTube import */}
      <div className="flex items-center gap-2">
        <input
          className="flex-1 bg-panel border border-edge rounded px-2 py-1 text-xs"
          placeholder="YouTube URL or video ID…"
          value={youtubeUrl}
          onChange={(e) => setYoutubeUrl(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleYoutubeImport()}
        />
        <button
          className="border border-accent/50 text-accent rounded px-3 py-1 text-xs hover:bg-accent/10 disabled:opacity-40"
          onClick={handleYoutubeImport}
          disabled={youtubeLoading || !youtubeUrl.trim()}
        >
          {youtubeLoading ? "…" : "▶ YT Import"}
        </button>
      </div>

      {/* Row 3: ChordMiniApp audio analysis */}
      <div className="flex items-center gap-2">
        <span className="text-[10px] text-inkMuted/60 flex-1">
          {analyzing ? "Analyzing audio with ChordMiniApp…" : "Analyze audio (chords + key + BPM + structure)"}
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