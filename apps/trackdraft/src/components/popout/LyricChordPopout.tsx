import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { pitchClass, NOTE_TO_PC } from "@music-theory/core";
import type { NoteName } from "@music-theory/core";
import { useSongStore } from "../../store/songStore";
import { sectionSpans } from "../../lib/arrangement";
import { TRANSPORT_CHANNEL_NAME, type TransportTick } from "../../lib/playback/songTransport";
import { chordDisplayName } from "../../lib/harmony/chordBuilder";

/** Which lyric line is current, given how far into the section we are.
 *  `startBeat` entries are strictly increasing (ingestion-produced), so
 *  the current line is the last one whose startBeat has passed. Returns
 *  -1 before the first line or when there's no timeline data at all. */
function currentLineIndex(timeline: { startBeat: number }[] | undefined, beatInSection: number): number {
  if (!timeline || timeline.length === 0) return -1;
  let idx = -1;
  for (let i = 0; i < timeline.length; i++) {
    if (timeline[i].startBeat > beatInSection) break;
    idx = i;
  }
  return idx;
}

/** A separate, chrome-free window (opened via `window.open`, not a route
 *  nested under SongEditorLayout) meant to be glanced at from across a
 *  room or on a second monitor while performing/rehearsing. Reads the
 *  song from the *same* localStorage-backed store every tab shares (no
 *  data needs to cross the window boundary) and only listens for live
 *  transport ticks over BroadcastChannel — a popout window is a fresh
 *  page load with its own JS realm, so it can't hold a reference to the
 *  main tab's `SongTransport` singleton directly.
 *
 *  `lyricsTimeline` (per-line beat timestamps) only exists on sections
 *  that came through an ingestion adapter (LRC/YouTube/Whisper) — a
 *  freshly-authored section falls back to its plain lyrics text with no
 *  per-line highlight, rather than showing nothing. */
export default function LyricChordPopout() {
  const { songId } = useParams<{ songId: string }>();
  const song = useSongStore((s) => s.songs.find((sg) => sg.id === songId));
  const [tick, setTick] = useState<TransportTick | null>(null);

  useEffect(() => {
    const channel = new BroadcastChannel(TRANSPORT_CHANNEL_NAME);
    channel.onmessage = (e) => setTick(e.data as TransportTick);
    return () => channel.close();
  }, []);

  if (!song) {
    return (
      <div className="min-h-screen bg-black text-neutral-400 flex items-center justify-center">
        <p className="text-lg font-mono">Song not found — open it in the main window first.</p>
      </div>
    );
  }

  const spans = sectionSpans(song);
  const activeSpan = tick && tick.isPlaying && tick.sectionIndex >= 0 ? spans[tick.sectionIndex] : null;

  if (!activeSpan || !tick) {
    return (
      <div className="min-h-screen bg-black text-neutral-500 flex items-center justify-center">
        <p className="text-2xl font-mono">{song.title} — waiting for Studio playback…</p>
      </div>
    );
  }

  const section = activeSpan.section;
  const rawKey = section.key ?? song.key;
  const keyName: NoteName = rawKey in NOTE_TO_PC ? (rawKey as NoteName) : "C";
  const beatInSection = tick.beat - activeSpan.startBeat;
  const timeline = section.lyricsTimeline;
  const activeLine = currentLineIndex(timeline, beatInSection);

  return (
    <div className="min-h-screen bg-black text-white flex flex-col items-center justify-center p-10 gap-8 select-none">
      <p className="text-sm uppercase tracking-widest text-neutral-500 font-mono">{section.name}</p>

      {section.chords.length > 0 && (
        <p className="text-3xl font-mono text-accent text-center">
          {section.chords
            .map((c) => `${c.romanNumeral} (${chordDisplayName(pitchClass(c.root), c.quality, keyName)})`)
            .join("   ")}
        </p>
      )}

      {timeline && timeline.length > 0 ? (
        <div className="text-center space-y-3 max-w-3xl">
          {timeline.map((line, i) => (
            <p
              key={i}
              className={i === activeLine ? "text-5xl font-semibold text-white" : "text-2xl text-neutral-600"}
            >
              {line.text}
            </p>
          ))}
        </div>
      ) : section.lyrics ? (
        <p className="text-3xl text-center max-w-3xl whitespace-pre-wrap text-neutral-300">{section.lyrics}</p>
      ) : (
        <p className="text-xl text-neutral-600">No lyrics for this section.</p>
      )}
    </div>
  );
}
