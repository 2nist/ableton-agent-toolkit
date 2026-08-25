import { useEffect, useMemo, useState } from "react";
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

interface ChordSlot {
  chord: { romanNumeral: string; root: string; quality: string };
  startBeat: number;
  durationBeats: number;
  display: string;
}

/** Expand a section's chord list to fill its duration, same as
 *  midiExport's loopChordsToFill — one pass of the user's progression,
 *  looped to cover the section's full beat count. Returns chord slots
 *  with absolute section-relative beat positions. */
function expandChords(section: { chords: { romanNumeral: string; root: string; quality: string; beats: number }[] }, durationBeats: number): ChordSlot[] {
  if (section.chords.length === 0) return [];
  const cycleBeats = section.chords.reduce((sum, c) => sum + c.beats, 0);
  if (cycleBeats <= 0) return [];

  const slots: ChordSlot[] = [];
  let cursor = 0;
  while (cursor < durationBeats) {
    for (const chord of section.chords) {
      if (cursor >= durationBeats) break;
      const chordBeats = Math.min(chord.beats, durationBeats - cursor);
      slots.push({
        chord,
        startBeat: cursor,
        durationBeats: chordBeats,
        display: `${chord.romanNumeral} (${chordDisplayName(pitchClass(chord.root), chord.quality as "maj", "C")})`,
      });
      cursor += chord.beats;
    }
  }
  return slots;
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
 *  Chords and lyrics are interleaved inline: lyric lines appear at their
 *  timeline positions, and chord changes appear as accent-colored labels
 *  between them. The current chord and lyric line highlight in sync
 *  (accent color for current chord, white for current lyric line). */
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

  // Expand chords to full section duration with beat positions
  const chordSlots = useMemo(
    () => expandChords(section, activeSpan.durationBeats),
    [section.chords, activeSpan.durationBeats],
  );

  // Find the current chord slot
  const activeChordIndex = chordSlots.findIndex(
    (s) => beatInSection >= s.startBeat && beatInSection < s.startBeat + s.durationBeats,
  );

  // Build a merged view: lyrics with chords interleaved at their
  // respective beat positions
  const rows: { type: "chord" | "lyric"; text: string; isActive: boolean; beat: number; idx: number }[] = [];

  if (timeline && timeline.length > 0) {
    let chordIdx = 0;
    let lyricIdx = 0;
    while (chordIdx < chordSlots.length || lyricIdx < timeline.length) {
      const nextChord = chordSlots[chordIdx];
      const nextLyric = timeline[lyricIdx];
      const chordBeat = nextChord?.startBeat ?? Infinity;
      const lyricBeat = nextLyric?.startBeat ?? Infinity;

      if (chordBeat <= lyricBeat && nextChord) {
        rows.push({
          type: "chord",
          text: nextChord.display,
          isActive: chordIdx === activeChordIndex,
          beat: chordBeat,
          idx: chordIdx,
        });
        chordIdx++;
      } else if (nextLyric) {
        rows.push({
          type: "lyric",
          text: nextLyric.text,
          isActive: lyricIdx === activeLine,
          beat: lyricBeat,
          idx: lyricIdx,
        });
        lyricIdx++;
      } else {
        break;
      }
    }
  }

  return (
    <div className="min-h-screen bg-black text-white flex flex-col items-center justify-center p-10 gap-2 select-none">
      <p className="text-sm uppercase tracking-widest text-neutral-500 font-mono mb-2">{section.name}</p>

      {timeline && timeline.length > 0 ? (
        <div className="text-center space-y-2.5 max-w-4xl">
          {rows.map((row, i) => (
            <p
              key={i}
              className={
                row.type === "chord"
                  ? row.isActive
                    ? "text-lg font-mono text-accent transition-colors"
                    : "text-sm font-mono text-accent/30"
                  : row.isActive
                    ? "text-5xl font-semibold text-white transition-colors"
                    : "text-2xl text-neutral-600"
              }
            >
              {row.text}
            </p>
          ))}
        </div>
      ) : section.lyrics ? (
        <div className="text-center max-w-3xl">
          {section.chords.length > 0 && (
            <p className="text-lg font-mono text-accent mb-3">
              {section.chords
                .map((c) => {
                  const display = `${c.romanNumeral} (${chordDisplayName(pitchClass(c.root), c.quality, keyName)})`;
                  return display;
                })
                .join("   ")}
            </p>
          )}
          <p className="text-3xl whitespace-pre-wrap text-neutral-300">{section.lyrics}</p>
        </div>
      ) : (
        <div className="text-center max-w-3xl">
          {section.chords.length > 0 && (
            <p className="text-lg font-mono text-accent mb-3">
              {section.chords
                .map((c) => `${c.romanNumeral} (${chordDisplayName(pitchClass(c.root), c.quality, keyName)})`)
                .join("   ")}
            </p>
          )}
          <p className="text-xl text-neutral-600">No lyrics for this section.</p>
        </div>
      )}
    </div>
  );
}