import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { pitchClass, NOTE_TO_PC } from "@music-theory/core";
import type { NoteName } from "@music-theory/core";
import { useSongStore } from "../../store/songStore";
import { sectionSpans, spanIndexForTick, type SectionSpan } from "../../lib/arrangement";
import { chordSlotsForSection } from "../../lib/harmony/chordSlots";
import type { Chord } from "../../types/blueprint";
import { TRANSPORT_CHANNEL_NAME, type TransportTick } from "../../lib/playback/songTransport";
import { chordDisplayName } from "../../lib/harmony/chordBuilder";
import { currentLineIndex, rebaseLyricsTimeline } from "./lyricTimeline";

interface ChordSlot {
  chord: Chord;
  startBeat: number;
  durationBeats: number;
  display: string;
}

/** Expand a section's chord list to fill its duration (the shared
 *  `chordSlotsForSection` — the same loop `midiExport`'s `loopChordsToFill`
 *  applies) and decorate each slot with the karaoke display string. */
function expandChords(section: { chords: Chord[] }, durationBeats: number): ChordSlot[] {
  return chordSlotsForSection(section.chords, durationBeats).map((slot) => ({
    ...slot,
    display: `${slot.chord.romanNumeral} (${chordDisplayName(pitchClass(slot.chord.root), slot.chord.quality as "maj", "C")})`,
  }));
}

/** Which popout face the performer last chose — persisted so a tab that
 *  prefers the big single-section view stays there across sessions. */
const POPOUT_MODE_KEY = "trackdraft-popout-mode";

/** The lines a flow block shows: timeline entries when present (one per
 *  sung line — the same shape the section view renders), else the plain
 *  lyrics split into non-blank lines. */
function flowLinesForSpan(span: SectionSpan): string[] {
  const tl = span.section.lyricsTimeline;
  if (tl && tl.length > 0) return tl.map((l) => l.text);
  return (span.section.lyrics ?? "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
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
 *  (accent color for current chord, white for current lyric line).
 *
 *  Two faces, toggled top-right (persisted in `trackdraft-popout-mode`):
 *    · SONG FLOW (default) — the whole arrangement as one scroll: every
 *      section pass (repeats expanded, "Chorus · 2/3" labels) with the
 *      current line lit and auto-scrolled into view. Renders even with no
 *      playback at all, so the form can be reviewed from the words alone —
 *      the rehearsal face that lets you verify the sections you fixed.
 *    · SECTION — the original performing face: only the section currently
 *      playing, big and glanceable. */
export default function LyricChordPopout() {
  const { songId } = useParams<{ songId: string }>();
  const song = useSongStore((s) => s.songs.find((sg) => sg.id === songId));
  const [tick, setTick] = useState<TransportTick | null>(null);
  const [mode, setModeState] = useState<"flow" | "section">(() => {
    try {
      return localStorage.getItem(POPOUT_MODE_KEY) === "section" ? "section" : "flow";
    } catch {
      return "flow";
    }
  });
  function setMode(m: "flow" | "section") {
    setModeState(m);
    try {
      localStorage.setItem(POPOUT_MODE_KEY, m);
    } catch {}
  }

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
  const spans = useMemo(() => (song ? sectionSpans(song) : []), [song]);

  // SECTION mode — the performing face: only the span actually playing
  // (requires isPlaying, so the "waiting" screen shows until playback).
  const activeSpan = song && tick && tick.isPlaying ? spans[spanIndexForTick(spans, tick)] ?? null : null;
  // Expand chords to full section duration with beat positions (empty while
  // not playing / song not found — deps are stable references + numbers, so
  // it only recomputes when the section's chords or length actually change).
  // `activeSpan` is a stable object from the memoized span list, so it only
  // changes when the playhead crosses into another section — which is exactly
  // when the chords need re-expanding.
  const chordSlots = useMemo<ChordSlot[]>(
    () => (activeSpan ? expandChords(activeSpan.section, activeSpan.durationBeats) : []),
    [activeSpan],
  );

  // FLOW mode — the rehearsal face: the whole arrangement as one scroll,
  // every repeat pass its own block. The highlight follows any valid tick
  // (paused included, so a glance keeps your place); stop() emits
  // sectionIndex -1 and dims everything. Renders with no tick at all, so
  // the finished form can be previewed before playing a note.
  const flowIndex = tick ? spanIndexForTick(spans, tick) : -1;
  const flowSpan = flowIndex >= 0 ? spans[flowIndex] : null;
  const flowChordSlots = useMemo<ChordSlot[]>(
    () => (flowSpan ? expandChords(flowSpan.section, flowSpan.durationBeats) : []),
    [flowSpan],
  );
  const flowTimeline = useMemo(
    () => rebaseLyricsTimeline(flowSpan?.section.lyricsTimeline, flowSpan?.startBeat ?? 0),
    [flowSpan?.section.lyricsTimeline, flowSpan?.startBeat],
  );
  const allFlowLines = useMemo(() => spans.map(flowLinesForSpan), [spans]);
  const flowLines = flowSpan ? allFlowLines[flowIndex] : [];
  const flowActiveLine = (() => {
    if (!flowSpan || !tick) return -1;
    const beatIn = tick.beat - flowSpan.startBeat;
    if (flowTimeline.length > 0) return currentLineIndex(flowTimeline, beatIn);
    const n = flowLines.length;
    if (n === 0) return -1;
    return Math.min(n - 1, Math.floor((beatIn / Math.max(0.001, flowSpan.durationBeats)) * n));
  })();
  const activeLineRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (mode !== "flow") return;
    activeLineRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [mode, flowIndex, flowActiveLine]);

  if (!song) {
    return (
      <div className="min-h-screen bg-black text-neutral-400 flex items-center justify-center">
        <p className="text-lg font-mono">Song not found — open it in the main window first.</p>
      </div>
    );
  }

  const modeToggle = (
    <div className="fixed top-3 right-4 z-50 flex items-center gap-0.5 rounded border border-neutral-800 bg-black/80 px-1 py-0.5 font-mono text-[11px]">
      {(["flow", "section"] as const).map((m) => (
        <button
          key={m}
          className={`px-2 py-0.5 rounded ${mode === m ? "bg-neutral-200 text-black" : "text-neutral-400 hover:text-white"}`}
          title={
            m === "flow"
              ? "Song flow — the whole arrangement as one scroll; every pass of every section, the current line lit"
              : "Section — only the section being played, big and glanceable"
          }
          onClick={() => setMode(m)}
        >
          {m === "flow" ? "Song flow" : "Section"}
        </button>
      ))}
    </div>
  );

  if (mode === "flow") {
    return (
      <div className="h-screen overflow-y-auto bg-black text-white select-none">
        {modeToggle}
        <div className="max-w-3xl mx-auto px-8 py-16 space-y-10">
          {spans.length === 0 ? (
            <p className="text-center text-xl text-neutral-600 font-mono">
              No sections yet — build the arrangement on the spine, then come back to sing it.
            </p>
          ) : (
            spans.map((span, i) => {
              const isActive = i === flowIndex;
              const passes = spans.filter((sp) => sp.sectionId === span.sectionId).length;
              const lines = allFlowLines[i];
              return (
                <section
                  key={`${span.sectionId}:${span.occurrenceIndex}`}
                  className={`transition-opacity duration-300 ${isActive || flowIndex < 0 ? "" : "opacity-35"}`}
                >
                  <p
                    className={`font-mono text-xs uppercase tracking-[0.2em] mb-3 text-center ${
                      isActive ? "text-accent" : "text-neutral-500"
                    }`}
                  >
                    {span.section.name}
                    {passes > 1 ? ` · ${span.occurrenceIndex + 1}/${passes}` : ""}
                    {span.variation ? ` — ${span.variation}` : ""}
                  </p>
                  {lines.length === 0 ? (
                    <p className="text-center text-xl text-neutral-700 italic">— instrumental —</p>
                  ) : (
                    lines.map((text, li) => {
                      const current = isActive && li === flowActiveLine;
                      let chords: { display: string; left: number }[] = [];
                      if (isActive && flowChordSlots.length > 0) {
                        const tl = flowTimeline.length > 0 ? flowTimeline : null;
                        const n = lines.length;
                        const start = tl ? (tl[li]?.startBeat ?? 0) : (li * span.durationBeats) / Math.max(1, n);
                        const next = tl
                          ? li + 1 < tl.length
                            ? tl[li + 1].startBeat
                            : span.durationBeats
                          : ((li + 1) * span.durationBeats) / Math.max(1, n);
                        const spanBeats = Math.max(0.001, next - start);
                        chords = flowChordSlots
                          .filter((c) => c.startBeat >= start && c.startBeat < next)
                          .map((c) => ({ display: c.display, left: 8 + ((c.startBeat - start) / spanBeats) * 84 }));
                      }
                      return (
                        <div key={li} ref={current ? activeLineRef : undefined} className="py-1">
                          {chords.length > 0 && (
                            <div className="relative h-6 max-w-3xl mx-auto">
                              {chords.map((c, ci) => (
                                <span
                                  key={ci}
                                  className="absolute -translate-x-1/2 font-mono text-sm font-semibold text-accent/60"
                                  style={{ left: `${c.left}%` }}
                                >
                                  {c.display}
                                </span>
                              ))}
                            </div>
                          )}
                          <p
                            className={`text-center transition-all duration-200 ${
                              current
                                ? "text-4xl font-bold text-white"
                                : isActive
                                  ? "text-2xl text-neutral-300"
                                  : "text-xl text-neutral-600"
                            }`}
                          >
                            {text}
                          </p>
                        </div>
                      );
                    })
                  )}
                </section>
              );
            })
          )}
        </div>
      </div>
    );
  }

  if (!activeSpan || !tick) {
    return (
      <div className="min-h-screen bg-black text-neutral-500 flex items-center justify-center">
        {modeToggle}
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
      {modeToggle}
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