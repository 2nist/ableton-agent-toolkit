/**
 * The MIDI chord pad's brain: hold notes on a keyboard, get a chord name.
 *
 * A player rarely lands all the notes at once — the root speaks first, the
 * 3rd a few milliseconds later. Recognizing on every note-on would flash
 * "C" → "Cmaj" → "Cmaj7" and, in capture, write a chord change per finger.
 * So the hook waits a short settle window (55 ms, below the ~80 ms where a
 * chord starts to feel laggy) before naming what is held, and reports the
 * *first* note-on of that chord as its start time — that is the attack the
 * progression should be quantized against.
 *
 * Chord changes are only emitted when the recognized shape actually
 * changes, so holding a chord (or re-striking it) is one event.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { NoteName, ScaleType } from "@music-theory/core";
import {
  connectMidiInputs,
  midiInSupported,
  type MidiInputConnection,
  type MidiInputInfo,
  type MidiNoteMessage,
} from "../lib/playback/midiInput";
import {
  recognizeChordFromNotes,
  type RecognizedChord,
} from "../lib/harmony/chordRecognition";

/** How long after the last note-on a shape is considered complete. */
const SETTLE_MS = 55;

/**
 * 0-based channels the ATOM SQ uses for its User-mode encoders and display
 * buttons (1-based 10–17). Those arrive as note-ons and would otherwise be
 * read as a very discordant chord every time a button is pressed.
 */
const CONTROLLER_CHANNELS = [9, 10, 11, 12, 13, 14, 15, 16] as const;

export interface UseMidiChordInputOptions {
  keyName?: NoteName;
  scale?: ScaleType;
  /** A new chord has been recognized. `startedAtMs` is `performance.now()`
   *  of the first note-on that began it — use it, not the callback time, to
   *  place the change on the beat grid. */
  onChordStart?: (chord: RecognizedChord, startedAtMs: number) => void;
  /** Every note has been released — the moment the chord stopped sounding.
   *  Used to close the final chord of a take instead of letting it run to the
   *  end of the section. */
  onChordEnd?: (endedAtMs: number) => void;
  /** 0-based channels to ignore; defaults to the ATOM SQ's user block. */
  ignoreChannels?: readonly number[];
  /** Input port names to ignore — pass the selected output's name so a
   *  virtual bus the app plays through isn't also read back as input. */
  ignoreInputNames?: readonly string[];
}

export interface MidiChordInput {
  supported: boolean;
  enabled: boolean;
  connecting: boolean;
  error: string | null;
  inputs: MidiInputInfo[];
  /** MIDI pitches currently held, low to high. */
  heldNotes: number[];
  /** The chord under the fingers, or null when nothing (recognizable) is held. */
  chord: RecognizedChord | null;
  enable: () => void;
  disable: () => void;
}

export function useMidiChordInput(options: UseMidiChordInputOptions = {}): MidiChordInput {
  const supported = midiInSupported();
  const [enabled, setEnabled] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [inputs, setInputs] = useState<MidiInputInfo[]>([]);
  const [heldNotes, setHeldNotes] = useState<number[]>([]);
  const [chord, setChord] = useState<RecognizedChord | null>(null);

  const heldRef = useRef(new Map<number, number>());
  const pendingStartRef = useRef<number | null>(null);
  const settleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastEmittedRef = useRef<{ rootPc: number; quality: string } | null>(null);

  // Callbacks and key context follow the latest render without re-opening
  // the MIDI connection (which would re-prompt and drop notes).
  const onChordStartRef = useRef(options.onChordStart);
  onChordStartRef.current = options.onChordStart;
  const onChordEndRef = useRef(options.onChordEnd);
  onChordEndRef.current = options.onChordEnd;
  const keyRef = useRef({ keyName: options.keyName, scale: options.scale });
  keyRef.current = { keyName: options.keyName, scale: options.scale };
  const ignoreNamesRef = useRef(options.ignoreInputNames ?? []);
  ignoreNamesRef.current = options.ignoreInputNames ?? [];
  // A stable identity for the ignored-name list, so a port-name change
  // re-opens the connection while a new array literal does not.
  const ignoreNamesKey = (options.ignoreInputNames ?? []).join("|");

  const clearSettle = useCallback(() => {
    if (settleTimerRef.current !== null) {
      clearTimeout(settleTimerRef.current);
      settleTimerRef.current = null;
    }
  }, []);

  const settle = useCallback(() => {
    const pitches = Array.from(heldRef.current.keys());
    const recognized = recognizeChordFromNotes(pitches, keyRef.current);
    setChord(recognized);

    if (!recognized) {
      lastEmittedRef.current = null;
      return;
    }
    const previous = lastEmittedRef.current;
    if (previous && previous.rootPc === recognized.rootPc && previous.quality === recognized.quality) {
      return;
    }
    lastEmittedRef.current = { rootPc: recognized.rootPc, quality: recognized.quality };
    const startedAt = pendingStartRef.current ?? performance.now();
    pendingStartRef.current = null;
    onChordStartRef.current?.(recognized, startedAt);
  }, []);

  const scheduleSettle = useCallback(() => {
    clearSettle();
    settleTimerRef.current = setTimeout(() => {
      settleTimerRef.current = null;
      settle();
    }, SETTLE_MS);
  }, [clearSettle, settle]);

  const handleNote = useCallback(
    (message: MidiNoteMessage) => {
      if (message.kind === "on") {
        heldRef.current.set(message.pitch, message.velocity);
        if (pendingStartRef.current === null) pendingStartRef.current = performance.now();
      } else {
        heldRef.current.delete(message.pitch);
        if (heldRef.current.size === 0) {
          pendingStartRef.current = null;
          lastEmittedRef.current = null;
          clearSettle();
          setHeldNotes([]);
          setChord(null);
          onChordEndRef.current?.(performance.now());
          return;
        }
      }
      setHeldNotes(Array.from(heldRef.current.keys()).sort((a, b) => a - b));
      scheduleSettle();
    },
    [clearSettle, scheduleSettle],
  );

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let connection: MidiInputConnection | null = null;
    const held = heldRef.current;
    setConnecting(true);
    setError(null);

    void connectMidiInputs({
      onNote: handleNote,
      ignoreChannels: options.ignoreChannels ?? CONTROLLER_CHANNELS,
      ignoreInputNames: ignoreNamesRef.current,
      onInputsChanged: (next) => {
        if (!cancelled) setInputs(next);
      },
    })
      .then((opened) => {
        if (cancelled) {
          opened.dispose();
          return;
        }
        connection = opened;
        setInputs(opened.inputs);
        setConnecting(false);
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setConnecting(false);
        setEnabled(false);
        setError(
          cause instanceof Error && cause.message
            ? cause.message
            : "MIDI access was denied — allow MIDI for this page and try again.",
        );
      });

    return () => {
      cancelled = true;
      connection?.dispose();
      clearSettle();
      held.clear();
      pendingStartRef.current = null;
      lastEmittedRef.current = null;
      setHeldNotes([]);
      setChord(null);
    };
    // `handleNote` is stable; `options.ignoreChannels` is read once per
    // enable on purpose (changing it mid-session would drop held notes).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, handleNote, clearSettle, ignoreNamesKey]);

  const enable = useCallback(() => {
    if (!supported) {
      setError("This browser has no Web MIDI support — use Chrome, Edge, or the desktop app.");
      return;
    }
    setEnabled(true);
  }, [supported]);

  const disable = useCallback(() => {
    setEnabled(false);
    setInputs([]);
  }, []);

  return {
    supported,
    enabled,
    connecting,
    error,
    inputs,
    heldNotes,
    chord,
    enable,
    disable,
  };
}
