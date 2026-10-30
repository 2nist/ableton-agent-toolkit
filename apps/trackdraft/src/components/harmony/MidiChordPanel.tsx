import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { chordName, midiToPitchClass, noteName, pitchClass } from "@music-theory/core";
import type { NoteName, ScaleType } from "@music-theory/core";
import {
  meanBeatsPerBar,
  sectionDurationBeats,
  type BlueprintSection,
  type BlueprintSong,
  type Chord,
} from "../../types/blueprint";
import { sectionSpans } from "../../lib/arrangement";
import { getSongTransport } from "../../lib/playback/songTransport";
import { listMidiOutputs } from "../../lib/playback/liveMidiOut";
import { ClickTrack } from "../../lib/melody/clickTrack";
import { insertChordAt } from "../../lib/harmony/floorLayout";
import { deriveEvent } from "../../lib/harmony/analysis";
import {
  captureToChords,
  type CapturedChordEvent,
} from "../../lib/harmony/chordCapture";
import {
  recognizedChordName,
  recognizedRootName,
  type RecognizedChord,
} from "../../lib/harmony/chordRecognition";
import { useMidiChordInput } from "../../hooks/useMidiChordInput";
import { targetUsesAppClock, useDawTargetStore } from "../../store/dawTargetStore";
import { useMidiSettingsStore } from "../../store/midiSettingsStore";
import { uuid } from "../../lib/uuid";

interface MidiChordPanelProps {
  song: BlueprintSong;
  section: BlueprintSection;
  keyName: NoteName;
  scale: ScaleType;
  selectedChordId: string | null;
  /** Song-relative beat of the playhead, when something is playing. */
  playheadBeat?: number | null;
  onChangeChords: (chords: Chord[]) => void;
  onSelectChord: (id: string | null) => void;
  onPreviewChord?: (chord: Chord) => void;
}

/** Beat grid the take is read onto. `1` is a beat — the useful default, since
 *  chords normally change on the beat; the halves are for pushes. */
const GRID_CHOICES: { beats: number; label: string }[] = [
  { beats: 0.5, label: "1/8" },
  { beats: 1, label: "1/4" },
  { beats: 2, label: "1/2" },
];

/**
 * MIDI chord entry for the Compose floor.
 *
 * Two jobs in one panel, because they are the same feature seen from two
 * angles:
 *
 * 1. **Read the chord** — hold a chord on any MIDI keyboard and it is named
 *    here, then written either onto the selected chord or at the cursor.
 * 2. **Play the progression** — arm the metronome, play the changes in time
 *    through the section, stop, and the take is quantized against the beat
 *    grid into the section's `chords`. Nothing is written until "write
 *    progression" is pressed, so a bad take costs one click.
 *
 * The click is Web Audio (not MIDI), so recording works even when no MIDI
 * output is configured; timing comes from the same transport the rest of
 * the app plays on.
 */
export default function MidiChordPanel({
  song,
  section,
  keyName,
  scale,
  selectedChordId,
  playheadBeat,
  onChangeChords,
  onSelectChord,
  onPreviewChord,
}: MidiChordPanelProps) {
  const clockBlocked = !targetUsesAppClock(useDawTargetStore((s) => s.target));
  const [gridBeats, setGridBeats] = useState(1);
  const [clickEnabled, setClickEnabled] = useState(true);
  const [countInEnabled, setCountInEnabled] = useState(true);
  const [loop, setLoop] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [countIn, setCountIn] = useState<number | null>(null);
  const [changeCount, setChangeCount] = useState(0);
  const [take, setTake] = useState<Chord[] | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 9000);
    return () => clearTimeout(timer);
  }, [notice]);

  const sectionBeats = sectionDurationBeats(section);
  // The section's own meter, not the song's — a 3/4 waltz counts in three.
  const beatsPerBar = Math.max(1, Math.round(meanBeatsPerBar(section)));
  const span = useMemo(
    () => sectionSpans(song).find((entry) => entry.sectionId === section.id) ?? null,
    [song, section.id],
  );

  const capturingRef = useRef(false);
  const eventsRef = useRef<CapturedChordEvent[]>([]);
  const clickRef = useRef<ClickTrack | null>(null);
  const timersRef = useRef<number[]>([]);
  const startedRef = useRef(false);
  /** Where the last chord was released — the end of the take when the
   *  player lets go before pressing stop. Cleared when the next chord
   *  starts sounding. */
  const lastReleaseBeatRef = useRef<number | null>(null);
  /** Where a note-on timestamp lands on the song timeline. `startedAtMs` is
   *  when the finger hit, which may be a settle-window before now — so read
   *  the transport's beat and walk back by that much wall time. */
  const beatAt = useCallback(
    (startedAtMs: number): number | null => {
      const transport = getSongTransport();
      if (!transport.getIsPlaying()) return null;
      const beatNow = transport.getBeat();
      const elapsedBeats = ((performance.now() - startedAtMs) / 1000) * (song.bpm / 60);
      return beatNow - elapsedBeats;
    },
    [song.bpm],
  );

  const onChordStart = useCallback(
    (chord: RecognizedChord, startedAtMs: number) => {
      if (!capturingRef.current || !span || sectionBeats <= 0) return;
      const beat = beatAt(startedAtMs);
      if (beat === null) return;
      let sectionBeat = beat - span.startBeat;
      // A loop folds each pass back onto the section, so a second take lands
      // on the same grid instead of drifting through the song.
      if (loop && sectionBeat >= sectionBeats) sectionBeat %= sectionBeats;
      if (sectionBeat < -0.05 || sectionBeat >= sectionBeats - 1e-6) return;
      eventsRef.current.push({
        beat: Math.max(0, sectionBeat),
        rootPc: chord.rootPc,
        quality: chord.quality,
      });
      lastReleaseBeatRef.current = null;
      setChangeCount(eventsRef.current.length);
    },
    [beatAt, loop, sectionBeats, span],
  );

  /** The last chord's end, used to close the take instead of stretching the
   *  final chord across the whole section. */
  const onChordEnd = useCallback(
    (endedAtMs: number) => {
      if (!capturingRef.current || !span || sectionBeats <= 0) return;
      const beat = beatAt(endedAtMs);
      if (beat === null) return;
      let sectionBeat = beat - span.startBeat;
      if (loop && sectionBeat >= sectionBeats) sectionBeat %= sectionBeats;
      if (sectionBeat < 0 || sectionBeat >= sectionBeats) return;
      lastReleaseBeatRef.current = sectionBeat;
    },
    [beatAt, loop, sectionBeats, span],
  );

  const midiOutputId = useMidiSettingsStore((state) => state.midiOutputId);
  const [outputName, setOutputName] = useState<string | null>(null);
  useEffect(() => {
    if (!midiOutputId) {
      setOutputName(null);
      return;
    }
    let cancelled = false;
    void listMidiOutputs()
      .then((outputs) => {
        if (!cancelled) setOutputName(outputs.find((output) => output.id === midiOutputId)?.name ?? null);
      })
      .catch(() => {
        /* no permission yet — the selected port is simply not known by name */
      });
    return () => {
      cancelled = true;
    };
  }, [midiOutputId]);

  // A virtual bus (IAC / loopMIDI / the Live template's port) appears as an
  // input too. Listening to the port the app plays through would record its
  // own click as chord input, so that end of the bus is skipped by name.
  const ignoreInputNames = useMemo(() => (outputName ? [outputName] : []), [outputName]);
  const midi = useMidiChordInput({ keyName, scale, onChordStart, onChordEnd, ignoreInputNames });

  const clearTimers = useCallback(() => {
    for (const timer of timersRef.current) window.clearTimeout(timer);
    timersRef.current = [];
    setCountIn(null);
  }, []);

  const stopCapture = useCallback(
    (atBeat?: number) => {
      if (!capturingRef.current) return;
      const transport = getSongTransport();
      const playing = transport.getIsPlaying();
      const stopBeat = atBeat ?? (playing ? transport.getBeat() : null);
      let transportEnd: number | null = null;
      if (span && stopBeat !== null) {
        let sectionBeat = stopBeat - span.startBeat;
        if (loop && sectionBeat >= sectionBeats) sectionBeat %= sectionBeats;
        if (sectionBeat >= 0 && sectionBeat < sectionBeats) transportEnd = sectionBeat;
      }
      // A release before the stop is the true end of the last chord; the
      // stop button only supplies an end when the chord was still held.
      const endBeat = lastReleaseBeatRef.current ?? transportEnd ?? undefined;

      capturingRef.current = false;
      startedRef.current = false;
      setCapturing(false);
      clearTimers();
      transport.stop();
      clickRef.current?.stop();

      const chords = captureToChords(eventsRef.current, sectionBeats, {
        keyName,
        scale,
        gridBeats,
        endBeat,
      });
      if (chords.length === 0) {
        setTake(null);
        setNotice("Nothing mapped — hold each chord for at least a beat of the click.");
        return;
      }
      setTake(chords);
      setNotice(null);
    },
    [clearTimers, gridBeats, keyName, loop, scale, sectionBeats, span],
  );

  // Kept in a ref so the section-change effect can end a take without
  // re-subscribing every time the grid changes.
  const stopCaptureRef = useRef(stopCapture);
  stopCaptureRef.current = stopCapture;

  const startCapture = useCallback(() => {
    if (capturingRef.current || !span || sectionBeats <= 0) return;
    setTake(null);
    setNotice(null);
    eventsRef.current = [];
    lastReleaseBeatRef.current = null;
    setChangeCount(0);
    capturingRef.current = true;
    startedRef.current = false;
    setCapturing(true);

    const transport = getSongTransport();
    const click = clickRef.current ?? new ClickTrack();
    clickRef.current = click;

    // Live owns the clock: there is nothing here to start, so arming simply
    // listens to Live's transport and reads its beats — the same grid, no
    // extra count-in (Live has its own).
    if (clockBlocked) return;

    const beatSeconds = 60 / Math.max(1, song.bpm);
    const countInBeats = countInEnabled ? beatsPerBar : 0;

    if (clickEnabled) {
      // Schedule the count-in up front so it is metronomic rather than four
      // timer callbacks deep in jitter.
      for (let index = 0; index < countInBeats; index++) {
        click.clickAt(index * beatSeconds, index === 0);
      }
    }
    if (countInBeats > 0) {
      setCountIn(countInBeats);
      for (let index = 1; index <= countInBeats; index++) {
        timersRef.current.push(
          window.setTimeout(() => setCountIn(countInBeats - index), index * beatSeconds * 1000),
        );
      }
    }

    timersRef.current.push(
      window.setTimeout(() => {
        setCountIn(null);
        if (!capturingRef.current) return;
        if (clickEnabled) click.start();
        startedRef.current = true;
        transport.play(song, {
          startBeat: span.startBeat,
          ...(loop
            ? {
                loopStart: span.startBeat,
                loopEnd: span.startBeat + sectionBeats,
                forceLoop: true,
              }
            : {}),
        });
      }, countInBeats * beatSeconds * 1000),
    );
  }, [
    beatsPerBar,
    clickEnabled,
    clockBlocked,
    countInEnabled,
    loop,
    sectionBeats,
    song,
    span,
  ]);

  // The take ends when the transport does (song end), not only on the stop
  // button — otherwise the panel would sit armed forever. Under Live's clock
  // the take also begins when Live starts rolling.
  useEffect(() => {
    if (!capturing) return;
    return getSongTransport().onTick((tick) => {
      if (tick.isPlaying) startedRef.current = true;
      else if (startedRef.current) stopCapture(tick.beat);
    });
  }, [capturing, stopCapture]);

  // Leaving the section or the page mid-take must silence the click.
  useEffect(() => {
    return () => {
      if (capturingRef.current) {
        capturingRef.current = false;
        getSongTransport().stop();
        clickRef.current?.stop();
      }
      for (const timer of timersRef.current) window.clearTimeout(timer);
      timersRef.current = [];
      clickRef.current?.dispose();
      clickRef.current = null;
    };
  }, []);

  useEffect(() => {
    setTake(null);
    setNotice(null);
    if (capturingRef.current) stopCaptureRef.current();
  }, [section.id]);

  /** A recognized shape written as a section chord, numeral included. */
  function makeChord(recognized: RecognizedChord, beats: number, next: Chord | null): Chord {
    const draft: Chord = {
      id: uuid(),
      root: recognizedRootName(recognized, keyName),
      quality: recognized.quality,
      beats,
      romanNumeral: "",
    };
    const derived = deriveEvent(draft, next, { key: keyName, scale, startBeat: 0 });
    return { ...draft, romanNumeral: derived.roman };
  }

  function replaceSelected(recognized: RecognizedChord) {
    const index = section.chords.findIndex((chord) => chord.id === selectedChordId);
    if (index < 0) return;
    const existing = section.chords[index]!;
    const next = section.chords[index + 1] ?? null;
    const replacement = makeChord(recognized, existing.beats, next);
    const updated: Chord = {
      ...replacement,
      id: existing.id,
      restBefore: existing.restBefore,
      restAfter: existing.restAfter,
    };
    onChangeChords(section.chords.map((chord, at) => (at === index ? updated : chord)));
    onPreviewChord?.(updated);
    setNotice(`replaced ${chordName(pitchClass(existing.root), existing.quality, keyName)} with ${recognizedChordName(recognized, keyName)}`);
  }

  function placeAtCursor(recognized: RecognizedChord) {
    const cursorBeat =
      playheadBeat !== null && playheadBeat !== undefined && span
        ? Math.max(0, Math.min(sectionBeats - 0.5, playheadBeat - span.startBeat))
        : 0;
    const chord = makeChord(recognized, Math.max(gridBeats, beatsPerBar), null);
    onChangeChords(insertChordAt(section.chords, cursorBeat, chord, chord.beats));
    onSelectChord(chord.id);
    onPreviewChord?.(chord);
    setNotice(null);
  }

  function applyTake(mode: "replace" | "append") {
    if (!take) return;
    onChangeChords(mode === "replace" ? take : [...section.chords, ...take]);
    setNotice(
      `wrote ${take.length} chord${take.length === 1 ? "" : "s"}${mode === "append" ? " onto the end" : ""} — undo to go back`,
    );
    setTake(null);
  }

  const liveName = midi.chord ? recognizedChordName(midi.chord, keyName) : null;
  const heldPitches = midi.heldNotes;

  return (
    <div className="space-y-2 p-2 font-mono text-[10px] text-inkMuted">
      <div className="flex flex-wrap items-center gap-2">
        {!midi.supported ? (
          <span className="text-danger">
            no Web MIDI in this browser — use Chrome, Edge, or the desktop app
          </span>
        ) : midi.enabled ? (
          <>
            <span className="text-accent">
              {midi.connecting ? "opening…" : midi.inputs.length > 0 ? "listening" : "no ports found"}
            </span>
            {midi.inputs.length > 0 && (
              <span className="truncate text-inkMuted/70" title={midi.inputs.map((input) => input.name).join(", ")}>
                {midi.inputs.map((input) => input.name).join(" · ")}
              </span>
            )}
            <button
              type="button"
              onClick={midi.disable}
              className="ml-auto rounded border border-edge px-1.5 py-0.5 hover:text-ink"
            >
              stop
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={midi.enable}
            className="rounded border border-accent bg-accent px-1.5 py-0.5 text-accentInk hover:opacity-90"
            title="Ask the browser for the MIDI inputs — every connected keyboard starts talking to this panel"
          >
            enable MIDI in
          </button>
        )}
      </div>

      {midi.error && <p className="text-danger">{midi.error}</p>}

      <div className="rounded border border-edge bg-panelAlt px-2 py-1.5">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <span className="text-lg leading-none text-ink">{liveName ?? "—"}</span>
          {midi.chord && (
            <span className="text-inkMuted/60">
              {midi.chord.quality}
              {midi.chord.score < 0.9 && " · best guess"}
            </span>
          )}
          <span className="ml-auto flex flex-wrap gap-1">
            {heldPitches.length === 0 && <span className="text-inkMuted/50">hold a chord on any keyboard</span>}
            {heldPitches.map((pitch) => (
              <span
                key={pitch}
                className="rounded border border-edge px-1 text-[9px] text-ink"
                title={`MIDI ${pitch}`}
              >
                {noteName(midiToPitchClass(pitch), keyName)}
              </span>
            ))}
          </span>
        </div>

        <div className="mt-1.5 flex flex-wrap items-center gap-1">
          <button
            type="button"
            disabled={!midi.chord}
            onClick={() => midi.chord && placeAtCursor(midi.chord)}
            className="rounded border border-edge px-1.5 py-0.5 hover:text-ink disabled:opacity-40"
            title="Write the held chord at the playhead (a bar's worth unless the cursor is inside a chord)"
          >
            place at playhead
          </button>
          <button
            type="button"
            disabled={!midi.chord || !selectedChordId}
            onClick={() => midi.chord && replaceSelected(midi.chord)}
            className="rounded border border-edge px-1.5 py-0.5 hover:text-ink disabled:opacity-40"
            title="Swap the selected chord's root and quality for what you are holding, keeping its length"
          >
            replace selected
          </button>
        </div>
      </div>

      <div className="rounded border border-edge px-2 py-1.5">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-ink">play the progression</span>
          <span className="text-inkMuted/60">grid</span>
          <span className="flex overflow-hidden rounded border border-edge">
            {GRID_CHOICES.map((choice) => (
              <button
                key={choice.label}
                type="button"
                aria-pressed={gridBeats === choice.beats}
                onClick={() => setGridBeats(choice.beats)}
                className={`border-r border-edge px-1.5 py-0.5 last:border-r-0 ${
                  gridBeats === choice.beats ? "bg-accent text-accentInk" : "hover:text-ink"
                }`}
                title={`Snap chord changes to ${choice.label} notes`}
              >
                {choice.label}
              </button>
            ))}
          </span>
          <Toggle
            on={clickEnabled}
            onClick={() => setClickEnabled((value) => !value)}
            disabled={clockBlocked}
            title={clockBlocked ? "Live supplies the click — the app's own metronome stays out of the way" : "Audible click on every beat while you play"}
          >
            click
          </Toggle>
          <Toggle
            on={countInEnabled}
            onClick={() => setCountInEnabled((value) => !value)}
            disabled={clockBlocked}
            title={clockBlocked ? "Count in from Live, not from here" : "One bar of clicks before the section starts"}
          >
            count-in
          </Toggle>
          <Toggle on={loop} onClick={() => setLoop((value) => !value)} title="Repeat the section — later passes fold back onto the same grid">
            loop
          </Toggle>
        </div>

        <div className="mt-1.5 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={capturing ? () => stopCapture() : startCapture}
            disabled={sectionBeats <= 0}
            className={`rounded border px-2 py-0.5 font-semibold ${
              sectionBeats <= 0
                ? "cursor-not-allowed border-edge/60 text-inkMuted/40"
                : capturing
                  ? "border-danger bg-danger/15 text-danger"
                  : "border-accent text-accent hover:bg-accent/10"
            }`}
            title={
              clockBlocked
                ? "Live is the clock: arm, press play in Live, then play each chord change — the take is read on Live's beats."
                : "Start the click, then play each chord change in time. Stop to read the take back."
            }
          >
            {capturing ? "■ stop" : clockBlocked ? "● arm capture" : "● record progression"}
          </button>
          {countIn !== null && (
            <span className="text-[13px] font-semibold tabular-nums text-accent" title="Count-in">
              {countIn}
            </span>
          )}
          {capturing && (
            <span className="text-inkMuted/70">
              {changeCount === 0 ? "listening…" : `${changeCount} change${changeCount === 1 ? "" : "s"}`}
            </span>
          )}
          {clockBlocked && (
            <span className="text-inkMuted/60">
              {capturing ? "armed — press play in Live" : "Live is the clock"}
            </span>
          )}
          {notice && <span className="text-accent">{notice}</span>}
        </div>

        {take && (
          <div className="mt-2 rounded border border-accent/60 bg-accent/5 px-2 py-1.5">
            <div className="flex flex-wrap items-baseline gap-1">
              <span className="text-ink">you played</span>
              {take.map((chord) => (
                <span key={chord.id} className="rounded border border-edge bg-panel px-1 text-ink">
                  {chordName(pitchClass(chord.root), chord.quality, keyName)}
                  <span className="ml-1 text-inkMuted/60 tabular-nums">{chord.beats}</span>
                </span>
              ))}
            </div>
            <div className="mt-1 flex flex-wrap gap-1">
              <button
                type="button"
                onClick={() => applyTake("replace")}
                className="rounded border border-accent bg-accent px-1.5 py-0.5 font-semibold text-accentInk"
                title="Replace this section's progression with the take (one undo step)"
              >
                write progression
              </button>
              <button
                type="button"
                onClick={() => applyTake("append")}
                className="rounded border border-edge px-1.5 py-0.5 hover:text-ink"
                title="Keep the existing chords and put the take after them"
              >
                append
              </button>
              <button
                type="button"
                onClick={() => setTake(null)}
                className="rounded border border-edge px-1.5 py-0.5 hover:text-ink"
              >
                discard
              </button>
            </div>
          </div>
        )}
      </div>

      <p className="text-inkMuted/50">
        The take is quantized to the grid, and the last chord ends where you let
        go — so a short cycle loops to fill the section instead of stretching
        its final chord. Nothing is written until you say so.
      </p>
    </div>
  );
}

function Toggle({
  on,
  onClick,
  title,
  disabled,
  children,
}: {
  on: boolean;
  onClick: () => void;
  title?: string;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      title={title}
      disabled={disabled}
      className={`rounded border px-1.5 py-0.5 disabled:cursor-not-allowed disabled:opacity-40 ${
        on ? "border-accent bg-accent/15 text-accent" : "border-edge text-inkMuted/60 hover:text-ink"
      }`}
    >
      {children}
    </button>
  );
}
