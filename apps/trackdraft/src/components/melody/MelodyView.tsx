import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useSongStore } from "../../store/songStore";
import { useMidiSettingsStore } from "../../store/midiSettingsStore";
import { getSongTransport } from "../../lib/playback/songTransport";
import { getLiveMidiScheduler, getMidiOutput } from "../../lib/playback/liveMidiOut";
import { sectionSpans } from "../../lib/arrangement";
import { updateSection } from "../../lib/sections";
import { MelodyRecorder, rawNotesToBeats, midiToNoteName } from "../../lib/melody/recorder";
import { adjustMelody, QUANTIZE_GRID_LABELS, type QuantizeGrid } from "../../lib/melody/quantize";
import { ClickTrack } from "../../lib/melody/clickTrack";
import { foldNotesToSection, dedupeNotes } from "../../lib/melody/recordTiming";
import MelodyStaff from "./MelodyStaff";
import MelodyPianoRoll from "./MelodyPianoRoll";
import type { BlueprintSection, MelodyNote } from "../../types/blueprint";

/** The Melody tab — capture a sung/hummed line from the microphone while a
 *  section plays, then dial it in with a quantize grid + fit-to-scale knob.
 *
 *  Flow: pick a section → ● Record → hum along → ■ Stop. The take is
 *  anchored to the target section, translated to section-relative beats,
 *  and *immediately* attached to that section's `melody` — so the moment
 *  you stop, the line is playable (Studio Play streams it on the template's
 *  `melody` track, ch.5) and exportable (the .mid now has a Melody track).
 *
 *  Timing aids: a **Click** checkbox plays a metronome synced to the song
 *  beat while recording, and the **Follow / Loop** mode picks what plays —
 *  Follow records the section under the playhead (jumping playback to the
 *  selected section if it isn't playing), Loop repeats just the selected
 *  section so you can hum it over and over (later passes are folded back
 *  onto the section window and merged).
 *
 *  The quantize/fit knobs are non-destructive: they re-run over the raw
 *  capture (`rawCapture`) and rewrite the attached melody, so you can wiggle
 *  them freely without re-recording.
 */
export default function MelodyView() {
  const currentSong = useSongStore((s) => s.currentSong());
  const updateCurrentSong = useSongStore((s) => s.updateCurrentSong);
  const midiOutputId = useMidiSettingsStore((s) => s.midiOutputId);
  const midiChannels = useMidiSettingsStore((s) => s.channels);

  const [isPlaying, setIsPlaying] = useState(false);
  const [recording, setRecording] = useState(false);
  // ?section= deep links (the workbench's melody row jumps here with the
  // section it was focused on — before this, the param was silently
  // ignored and every dive landed on the first section).
  const [searchParams] = useSearchParams();
  const [selectedSectionId, setSelectedSectionId] = useState<string | null>(searchParams.get("section"));
  const [micError, setMicError] = useState<string | null>(null);
  const [rawCapture, setRawCapture] = useState<MelodyNote[] | null>(null);
  const [liveNote, setLiveNote] = useState<string | null>(null);
  const [liveClarity, setLiveClarity] = useState(0);
  const [quantize, setQuantize] = useState<QuantizeGrid>("1/8");
  const [fitToScale, setFitToScale] = useState(true);
  const [viewMode, setViewMode] = useState<"staff" | "piano">("staff");
  /** Metronome click during recording — helps users stay on time. */
  const [clickEnabled, setClickEnabled] = useState(false);
  /** What plays while recording: follow the song (record whatever section
   *  is playing) or loop just the selected section. */
  const [recordMode, setRecordMode] = useState<"follow" | "loop">("follow");

  const recorderRef = useRef<MelodyRecorder | null>(null);
  const clickTrackRef = useRef<ClickTrack | null>(null);
  const latestBeatRef = useRef(0);
  const recordStartBeatRef = useRef(0);
  const anchorBeatRef = useRef(0);
  const targetSectionIdRef = useRef<string | null>(null);
  /** Set while recording in loop mode — the section span the transport is
   *  looping, used to fold later passes back onto the section window. */
  const loopRef = useRef<{ start: number; end: number } | null>(null);

  // Re-target when the SAME view is re-navigated with a new section
  // (clicking another row's open → while already on /melody).
  useEffect(() => {
    const s = searchParams.get("section");
    if (s) setSelectedSectionId(s);
  }, [searchParams]);

  if (!currentSong) return null;
  const song = currentSong;
  const spans = sectionSpans(song);
  const activeSection = song.sections.find((s) => s.id === selectedSectionId) ?? song.sections[0] ?? null;
  const activeSpan = spans.find((s) => s.sectionId === activeSection?.id) ?? null;
  const sectionKey = activeSection?.key ?? song.key;
  const sectionScale = activeSection?.scale ?? song.scale;

  // Track the transport beat + play state so Record can anchor the take to
  // wherever the playhead is. Release the mic/click on unmount — but NOT the
  // transport: the header's global Play keeps the song going while you edit
  // other tabs, so leaving this tab must not kill playback.
  useEffect(() => {
    const transport = getSongTransport();
    const unsubscribe = transport.onTick((tick) => {
      latestBeatRef.current = tick.beat;
      setIsPlaying(tick.isPlaying);
    });
    return () => {
      unsubscribe();
      clickTrackRef.current?.dispose();
      clickTrackRef.current = null;
      recorderRef.current?.dispose();
      recorderRef.current = null;
    };
  }, []);

  if (song.sections.length === 0) {
    return (
      <div className="p-4 text-inkMuted text-sm">
        Add sections on the spine above first, then hum a melody for one here.
      </div>
    );
  }

  /** Start the same live playback the Studio tab uses — transport playhead
   *  plus (when a MIDI port is selected) the live scheduler that streams
   *  every stem, now including the Melody channel. `startBeat` seeks
   *  playback to a beat (e.g. a section's start); `loop` loops that beat
   *  region so a section repeats while the user records it. */
  async function startPlayback(startBeat = 0, loop: { start: number; end: number } | null = null) {
    const transport = getSongTransport();
    transport.play(
      song,
      loop ? { startBeat, loopStart: loop.start, loopEnd: loop.end } : { startBeat },
    );
    if (midiOutputId) {
      const output = await getMidiOutput(midiOutputId);
      if (output) {
        getLiveMidiScheduler().start(
          song,
          output,
          midiChannels,
          loop ? { startBeat, loopStart: loop.start, loopEnd: loop.end } : { startBeat },
        );
      }
    }
  }

  function togglePlayback() {
    if (isPlaying) {
      getSongTransport().stop();
      getLiveMidiScheduler().stop();
      return;
    }
    void startPlayback();
  }

  /** Current knob settings → the (section-resolved) key/scale. */
  function currentOpts() {
    return { quantize, fitToScale, key: sectionKey, scale: sectionScale };
  }

  /** Rewrite a section's attached melody from an adjusted note list. */
  function applyMelody(sectionId: string, notes: MelodyNote[]) {
    updateCurrentSong((s) => updateSection(s, sectionId, (sec) => ({ ...sec, melody: { notes } })));
  }

  async function toggleRecord() {
    // ── Stop recording ──
    if (recording) {
      const raw = recorderRef.current?.stop() ?? [];
      recorderRef.current = null;
      setRecording(false);
      setLiveNote(null);
      setLiveClarity(0);
      clickTrackRef.current?.stop();
      loopRef.current = null;

      const targetId = targetSectionIdRef.current;
      if (!targetId) {
        setMicError("Couldn't place the take — no section was targeted.");
        return;
      }
      const targetSpan = spans.find((s) => s.sectionId === targetId);
      if (!raw.length || !targetSpan) {
        setMicError(raw.length ? "Couldn't place the take — the section wasn't found." : "No notes detected — try humming a little louder, or hold each note a touch longer.");
        return;
      }

      const songNotes = rawNotesToBeats(raw, recordStartBeatRef.current, song.bpm);
      let sectionNotes = songNotes
        .map((n) => ({ ...n, startTime: Math.round((n.startTime - anchorBeatRef.current) * 100) / 100 }))
        .filter((n) => n.startTime >= 0);

      if (loopRef.current) {
        // Loop recording: later passes land past the section end — fold
        // them back onto the section window and merge repeated notes.
        sectionNotes = dedupeNotes(foldNotesToSection(sectionNotes, targetSpan.durationBeats), 0.25);
      } else {
        sectionNotes = sectionNotes.filter((n) => n.startTime < targetSpan.durationBeats);
      }
      if (!sectionNotes.length) {
        setMicError("No notes landed inside the section's time window — record while that section is playing.");
        return;
      }

      setRawCapture(sectionNotes);
      setMicError(null);
      applyMelody(targetId, adjustMelody(sectionNotes, currentOpts()));
      return;
    }

    // ── Start recording ──
    setMicError(null);
    try {
      const rec = new MelodyRecorder();
      rec.onFrame = (f) => {
        setLiveNote(f.midi != null ? midiToNoteName(f.midi) : null);
        setLiveClarity(f.clarity);
      };
      await rec.start();
      recorderRef.current = rec;

      const transport = getSongTransport();
      const playing = transport.getIsPlaying();
      const playingBeat = latestBeatRef.current;
      const looping = recordMode === "loop";

      // Decide the target section and where playback starts:
      // - Follow mode while playing → capture the section under the
      //   playhead, don't restart playback.
      // - Otherwise → seek to the selected section's start (and loop it in
      //   loop mode), so the user hears exactly what they're recording.
      let targetId: string;
      let startBeat: number;
      if (playing && !looping) {
        const span = spans.find((s) => playingBeat >= s.startBeat && playingBeat < s.startBeat + s.durationBeats) ?? spans[0];
        targetId = span.sectionId;
        startBeat = playingBeat;
      } else {
        const sectionId = selectedSectionId ?? spans[0].sectionId;
        const span = spans.find((s) => s.sectionId === sectionId) ?? spans[0];
        targetId = span.sectionId;
        startBeat = span.startBeat;
      }
      const targetSpan = spans.find((s) => s.sectionId === targetId) ?? spans[0];
      const loopRegion = looping
        ? { start: targetSpan.startBeat, end: targetSpan.startBeat + targetSpan.durationBeats }
        : null;

      // Start/restart playback unless we're just following an already
      // playing song in follow mode.
      if (!playing || looping) {
        await startPlayback(looping ? targetSpan.startBeat : startBeat, loopRegion);
      }

      // Metronome click to help keep time.
      if (clickEnabled) {
        if (!clickTrackRef.current) clickTrackRef.current = new ClickTrack();
        clickTrackRef.current.start();
      }

      recordStartBeatRef.current = startBeat;
      anchorBeatRef.current = targetSpan.startBeat;
      loopRef.current = loopRegion;
      targetSectionIdRef.current = targetId;
      setSelectedSectionId(targetId);
      setRecording(true);
    } catch (err) {
      recorderRef.current = null;
      setMicError(err instanceof Error ? err.message : String(err));
    }
  }

  /** Re-run the knobs over the raw capture (non-destructive — the attached
   *  melody is always derived from `rawCapture` until the user edits notes
   *  individually). */
  function reapplyFromRaw(nextQuantize = quantize, nextFit = fitToScale) {
    const targetId = targetSectionIdRef.current;
    if (!rawCapture || !targetId) return;
    const key = song.sections.find((s) => s.id === targetId)?.key ?? song.key;
    const scale = song.sections.find((s) => s.id === targetId)?.scale ?? song.scale;
    applyMelody(targetId, adjustMelody(rawCapture, { quantize: nextQuantize, fitToScale: nextFit, key, scale }));
  }

  function clearMelody() {
    if (!activeSection) return;
    updateCurrentSong((s) => updateSection(s, activeSection.id, (sec) => {
      const { melody: _drop, ...rest } = sec;
      return rest as BlueprintSection;
    }));
    setRawCapture(null);
  }

  const melodyNotes = activeSection?.melody?.notes ?? [];
  const sortedNotes = [...melodyNotes].sort((a, b) => a.startTime - b.startTime);
  const micSupported = typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia;
  const sectionBeats = activeSpan?.durationBeats ?? 1;

  return (
    <div className="p-4 max-w-5xl space-y-3">
      {/* Section picker — same chip pattern as the Lyrics tab. */}
      <div className="flex gap-2 flex-wrap">
        {song.sections.map((section) => (
          <button
            key={section.id}
            className={`text-sm px-3 py-1 rounded border ${
              activeSection?.id === section.id
                ? "border-accent text-accent"
                : "border-edge text-inkMuted hover:text-ink"
            }`}
            onClick={() => {
              setSelectedSectionId(section.id);
              targetSectionIdRef.current = section.id;
              setRawCapture(null);
            }}
          >
            {section.name}
          </button>
        ))}
      </div>

      {/* Record + transport row. */}
      <div className="flex items-center gap-2 border-b border-edge pb-2">
        <button
          className={`text-xs font-medium px-3 py-1.5 rounded disabled:opacity-40 ${
            recording ? "bg-red-600 text-white" : "bg-accent text-black"
          }`}
          onClick={() => void toggleRecord()}
          disabled={!micSupported}
          title={
            micSupported
              ? recording
                ? "Stop recording and attach the take to the section that was playing"
                : "Start microphone capture — hum or sing along while the song plays"
              : "Microphone access needs a secure context (localhost or HTTPS)"
          }
        >
          {recording ? "■ Stop" : "● Record"}
        </button>
        <button
          className="border border-edge text-inkMuted hover:text-ink rounded px-2.5 py-1.5 text-xs font-mono"
          onClick={togglePlayback}
          title="Play the song so you can hum along (melody streams on channel 5 when a MIDI port is set)"
        >
          {isPlaying ? "■ Stop song" : "▶ Play song"}
        </button>

        {/* Record timing aids: a metronome click, and what plays while you
            record (follow the song or loop just the selected section). */}
        <label
          className="flex items-center gap-1 text-[11px] text-inkMuted cursor-pointer select-none"
          title="Play a metronome click while recording to help stay on time"
        >
          <input type="checkbox" checked={clickEnabled} onChange={(e) => setClickEnabled(e.target.checked)} />
          Click
        </label>
        <div className="flex border border-edge rounded p-0.5" title="What plays while you record">
          <button
            className={`text-[10px] px-1.5 py-0.5 rounded ${recordMode === "follow" ? "bg-accent text-black" : "text-inkMuted hover:text-ink"}`}
            onClick={() => setRecordMode("follow")}
            title="Record the section that's playing — Record jumps playback to the selected section"
          >
            Follow
          </button>
          <button
            className={`text-[10px] px-1.5 py-0.5 rounded ${recordMode === "loop" ? "bg-accent text-black" : "text-inkMuted hover:text-ink"}`}
            onClick={() => setRecordMode("loop")}
            title="Loop the selected section while you record, so you can hum it over and over"
          >
            Loop
          </button>
        </div>

        {/* Live pitch meter while recording. */}
        {recording && (
          <div className="flex items-center gap-2 ml-2" aria-live="polite">
            <span className={`font-mono text-sm ${liveNote ? "text-accent" : "text-inkMuted"}`}>
              {liveNote ?? "—"}
            </span>
            <div className="w-24 h-1.5 bg-panelAlt border border-edge rounded overflow-hidden">
              <div
                className="h-full bg-accent transition-all"
                style={{ width: `${Math.max(0, Math.min(100, liveClarity * 100))}%` }}
              />
            </div>
            <span className="text-[10px] text-inkMuted">recording…</span>
          </div>
        )}
      </div>

      {micError && <p className="text-xs text-red-500">{micError}</p>}
      {!micSupported && (
        <p className="text-xs text-inkMuted">
          Microphone capture needs a secure context. Open TrackDraft at <span className="font-mono">localhost:5183</span> (or serve it over HTTPS) to hum a melody.
        </p>
      )}

      {/* The two knobs — quantize grid + fit to scale. */}
      <div className="flex items-center gap-4 border-b border-edge pb-2">
        <div className="flex items-center gap-1.5">
          <label className="text-3xs text-inkMuted uppercase tracking-wide font-mono">Quantize</label>
          <select
            className="bg-panelAlt border border-edge rounded px-1.5 py-0.5 text-xs text-ink"
            value={quantize}
            onChange={(e) => {
              const v = e.target.value as QuantizeGrid;
              setQuantize(v);
              reapplyFromRaw(v, fitToScale);
            }}
            title="Snap note onsets/offsets to a beat grid"
          >
            {(Object.keys(QUANTIZE_GRID_LABELS) as QuantizeGrid[]).map((g) => (
              <option key={g} value={g}>{QUANTIZE_GRID_LABELS[g]}</option>
            ))}
          </select>
        </div>
        <label className="flex items-center gap-1.5 cursor-pointer">
          <input
            type="checkbox"
            checked={fitToScale}
            onChange={(e) => {
              const v = e.target.checked;
              setFitToScale(v);
              reapplyFromRaw(quantize, v);
            }}
          />
          <span className="text-3xs text-inkMuted uppercase tracking-wide font-mono">Fit to scale</span>
        </label>
        <span className="text-[10px] text-inkMuted font-mono">
          {sectionKey} {sectionScale} · {activeSection?.name}
        </span>
        <span className="ml-auto text-[10px] text-inkMuted">
          {sortedNotes.length} note{sortedNotes.length === 1 ? "" : "s"} in this section
        </span>
      </div>

      {/* Melody strip — real musical notation on a staff (default) or a
          piano roll (pitch on the Y axis, time on X), via a small toggle. */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <div className="text-3xs text-inkMuted uppercase tracking-wide font-mono">Melody · {activeSection?.name}</div>
          <div className="flex gap-1 border border-edge rounded p-0.5">
            <button
              className={`text-[10px] px-1.5 py-0.5 rounded ${viewMode === "staff" ? "bg-accent text-black" : "text-inkMuted hover:text-ink"}`}
              onClick={() => setViewMode("staff")}
              title="Show the melody as musical notation on a treble staff"
            >
              Staff
            </button>
            <button
              className={`text-[10px] px-1.5 py-0.5 rounded ${viewMode === "piano" ? "bg-accent text-black" : "text-inkMuted hover:text-ink"}`}
              onClick={() => setViewMode("piano")}
              title="Show the melody as a piano roll — pitch up/down, time left/right"
            >
              Piano roll
            </button>
          </div>
        </div>

        {sortedNotes.length === 0 ? (
          <div className="h-28 bg-panelAlt border border-edge rounded flex items-center justify-center text-[11px] text-inkMuted">
            No melody yet — press ● Record and hum this section.
          </div>
        ) : viewMode === "staff" ? (
          <MelodyStaff notes={sortedNotes} sectionBeats={sectionBeats} songKey={sectionKey} scale={sectionScale} height={128} />
        ) : (
          <MelodyPianoRoll notes={sortedNotes} sectionBeats={sectionBeats} height={150} />
        )}
      </div>

      {/* Note list with per-note delete + clear. */}
      {sortedNotes.length > 0 && (
        <div className="border border-edge rounded overflow-hidden">
          <div className="grid grid-cols-[1fr_auto_auto_auto] gap-2 px-2.5 py-1 bg-panelAlt text-[10px] text-inkMuted uppercase tracking-wide font-mono">
            <span>Pitch</span>
            <span className="w-14 text-right">Start</span>
            <span className="w-14 text-right">Len</span>
            <span className="w-8" />
          </div>
          <div className="max-h-40 overflow-y-auto">
            {sortedNotes.map((n, i) => (
              <div key={i} className="grid grid-cols-[1fr_auto_auto_auto] gap-2 items-center px-2.5 py-1 text-xs border-t border-edge first:border-t-0">
                <span className="flex items-center gap-2">
                  <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: `hsl(${(n.pitch * 17) % 360}, 60%, 55%)` }} />
                  <span className="font-mono">{midiToNoteName(n.pitch)}</span>
                  <span className="text-inkMuted">({n.pitch})</span>
                </span>
                <span className="w-14 text-right font-mono">{n.startTime.toFixed(2)}</span>
                <span className="w-14 text-right font-mono">{n.duration.toFixed(2)}</span>
                <button
                  className="w-8 text-center text-inkMuted hover:text-red-500"
                  title="Remove this note"
                  onClick={() => {
                    if (!activeSection) return;
                    const next = melodyNotes.filter((_, j) => j !== i);
                    updateCurrentSong((s) => updateSection(s, activeSection.id, (sec) => ({ ...sec, melody: { notes: next } })));
                  }}
                >
                  &times;
                </button>
              </div>
            ))}
          </div>
          <div className="flex justify-end px-2.5 py-1.5 bg-panelAlt">
            <button
              className="text-[11px] text-inkMuted hover:text-red-500"
              onClick={clearMelody}
              title="Remove the melody from this section entirely"
            >
              Clear melody
            </button>
          </div>
        </div>
      )}

      <p className="text-[11px] text-inkMuted leading-relaxed max-w-2xl">
        Record while a section plays — the take attaches to whatever section was under the playhead when you pressed ●. It's
        immediately playable (Studio ▶ streams it on the template's <span className="font-mono">melody</span> track, ch.5) and
        exported with the .mid (a Melody track). The knobs re-run over your raw take non-destructively; delete individual notes
        to nudge the line. Melody capture is monophonic — hum or sing one voice at a time.
      </p>
    </div>
  );
}
