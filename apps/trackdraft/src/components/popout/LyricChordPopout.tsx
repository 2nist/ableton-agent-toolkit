import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { pitchClass, NOTE_TO_PC } from "@music-theory/core";
import type { NoteName } from "@music-theory/core";
import { useSongStore } from "../../store/songStore";
import { sectionSpans } from "../../lib/arrangement";
import { TRANSPORT_CHANNEL_NAME, type TransportTick } from "../../lib/playback/songTransport";
import { chordDisplayName } from "../../lib/harmony/chordBuilder";
import { currentLineIndex, rebaseLyricsTimeline } from "./lyricTimeline";

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

  // All hooks run unconditionally, BEFORE any early return — the popout has
  // to render its "not found"/"waiting" states without skipping hooks.
  // Calling useMemo only once playback started violated the Rules of Hooks
  // ("rendered more hooks than during the previous render") and crashed the
  // popout the moment the first transport tick arrived, so lyrics/chords
  // never displayed. Derive the plain values first, memoize below.
  const spans = song ? sectionSpans(song) : [];
  const activeSpan = song && tick && tick.isPlaying && tick.sectionIndex >= 0 ? spans[tick.sectionIndex] : null;
  // Expand chords to full section duration with beat positions (empty while
  // not playing / song not found — deps are stable references + numbers, so
  // it only recomputes when the section's chords or length actually change).
  const chordSlots = useMemo<ChordSlot[]>(
    () => (activeSpan ? expandChords(activeSpan.section, activeSpan.durationBeats) : []),
    [activeSpan?.section.chords, activeSpan?.durationBeats],
  );

  if (!song) {
    return (
      <div className="min-h-screen bg-black text-neutral-400 flex items-center justify-center">
        <p className="text-lg font-mono">Song not found — open it in the main window first.</p>
      </div>
    );
  }

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
  const timeline = rebaseLyricsTimeline(section.lyricsTimeline, activeSpan.startBeat);
  const activeLine = currentLineIndex(timeline, beatInSection);

  // ---- Karaoke layout: every lyric line is a block with its chord labels
  // drawn INLINE OVER the line (floating above the words, positioned by
  // their beat), and the line currently being sung is lit up (white +
  // larger) while the rest stay dim.
  interface LyricBlock {
    text: string;
    startBeat: number;
    /** Beats until the next line (or section end for the last). */
    spanBeats: number;
    chords: { display: string; beat: number; isCurrent: boolean }[];
    isCurrent: boolean;
  }

  const blocks: LyricBlock[] = (() => {
    if (timeline && timeline.length > 0) {
      return timeline.map((line, i) => {
        const nextStart = i + 1 < timeline.length ? timeline[i + 1].startBeat : activeSpan.durationBeats;
        const spanBeats = Math.max(0.001, nextStart - line.startBeat);
        const chords = chordSlots
          .filter((c) => c.startBeat >= line.startBeat && c.startBeat < nextStart)
          .map((c) => ({
            display: c.display,
            beat: c.startBeat - line.startBeat,
            isCurrent: beatInSection >= c.startBeat && beatInSection < c.startBeat + c.durationBeats,
          }));
        return { text: line.text, startBeat: line.startBeat, spanBeats, chords, isCurrent: i === activeLine };
      });
    }
    // No timed timeline — split the plain lyrics into lines and estimate
    // the current one by how far through the section we are, distributing
    // the chords evenly by line.
    const lines = (section.lyrics ?? "").split("\n").map((l) => l.trim()).filter(Boolean);
    const estCurrent =
      lines.length > 0 ? Math.min(lines.length - 1, Math.floor((beatInSection / Math.max(0.001, activeSpan.durationBeats)) * lines.length)) : -1;
    const spanBeats = Math.max(0.001, activeSpan.durationBeats / Math.max(1, lines.length));
    return lines.map((text, i) => ({
      text,
      startBeat: i * spanBeats,
      spanBeats,
      chords: chordSlots
        .filter((c) => c.startBeat >= i * spanBeats && c.startBeat < (i + 1) * spanBeats)
        .map((c) => ({ display: c.display, beat: c.startBeat - i * spanBeats, isCurrent: beatInSection >= c.startBeat && beatInSection < c.startBeat + c.durationBeats })),
      isCurrent: i === estCurrent,
    }));
  })();

  const hasLyrics = blocks.length > 0;

  return (
    <div className="min-h-screen bg-black text-white flex flex-col items-center justify-center p-8 select-none">
      <p className="text-sm uppercase tracking-widest text-neutral-500 font-mono mb-3">{section.name}</p>

      {hasLyrics ? (
        <div className="w-full max-w-4xl text-center">
          {blocks.map((block, i) => (
            <div key={i} className="py-1">
              {/* chords floating inline over this lyric line */}
              {block.chords.length > 0 && (
                <div className="relative h-7 mx-auto max-w-3xl">
                  {block.chords.map((c, ci) => {
                    const frac = block.spanBeats > 0 ? c.beat / block.spanBeats : 0;
                    const left = 8 + frac * 84;
                    return (
                      <span
                        key={ci}
                        className={`absolute -translate-x-1/2 font-mono text-base font-semibold transition-colors duration-200 ${
                          c.isCurrent ? "text-accent" : "text-accent/30"
                        }`}
                        style={{ left: `${left}%` }}
                      >
                        {c.display}
                      </span>
                    );
                  })}
                </div>
              )}
              <p
                className={`transition-all duration-200 ${
                  block.isCurrent ? "text-5xl font-bold text-white" : "text-2xl text-neutral-600"
                }`}
              >
                {block.text}
              </p>
            </div>
          ))}
        </div>
      ) : (
        <div className="text-center max-w-3xl">
          {section.chords.length > 0 && (
            <p className="text-lg font-mono text-accent mb-3">
              {section.chords.map((c) => `${c.romanNumeral} (${chordDisplayName(pitchClass(c.root), c.quality, keyName)})`).join("   ")}
            </p>
          )}
          <p className="text-xl text-neutral-600">No lyrics for this section.</p>
        </div>
      )}
    </div>
  );
}