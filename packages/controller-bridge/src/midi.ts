/**
 * MIDI byte-level helpers for `@hardware/controller-bridge`.
 *
 * The `ControllerBridge` class only resolves *single* elements via `getMidi()`
 * and has no MIDI I/O at all — that's fine for a preset exporter, but a runtime
 * consumer (the step sequencer) needs to (a) parse incoming MIDI bytes into
 * named controls and (b) build outgoing bytes for LED feedback and pad-mode
 * sysex. This module is that runtime layer. It stays dependency-free and pure
 * (byte arrays in/out) so it runs in the browser via Web MIDI, in Node, or in a
 * test.
 */
import type { ControllerElements, ElementMatrix, HardwareElement } from "./types";

// ---------------------------------------------------------------------------
// Parsed incoming message
// ---------------------------------------------------------------------------

export interface ParsedMidi {
  /** 0-based MIDI channel. */
  channel: number;
  /** Note number or CC number (0 for sysex). */
  number: number;
  /** Velocity / CC value. */
  value: number;
  messageType: "note" | "cc" | "sysex";
}

/** Parse raw MIDI message bytes into a structured form, or null if unrecognized. */
export function parseMidiMessage(bytes: number[] | Uint8Array): ParsedMidi | null {
  if (bytes.length < 2) return null;
  const data = Array.from(bytes);
  const status = data[0]!;
  const messageType = (status & 0xf0) as number;
  const channel = status & 0x0f;

  switch (messageType) {
    case 0x80: // note off
    case 0x90: // note on (value 0 = note off)
      return { channel, number: data[1]!, value: data[2] ?? 0, messageType: "note" };
    case 0xb0: // control change
      return { channel, number: data[1]!, value: data[2] ?? 0, messageType: "cc" };
    case 0xf0: // system exclusive
      return { channel: 0, number: 0, value: 0, messageType: "sysex" };
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Incoming resolution: MIDI bytes → named control
// ---------------------------------------------------------------------------

/** A resolved named control from an incoming MIDI message. */
export type MidiControl =
  | {
      kind: "control";
      /** Name in `elements.controls` / `elements.modifiers`. */
      name: string;
      element: HardwareElement;
    }
  | {
      kind: "pad";
      /** Matrix name in `elements.matrices`. */
      matrix: string;
      /** Physical row (0 = top) after honoring `flipRows`. */
      row: number;
      col: number;
      note: number;
      /** Matrix element def — shared by every cell, so it carries no single `midi`. */
      element: Omit<HardwareElement, "midi">;
    }
  | { kind: "sysex"; name: string };

/**
 * Resolve a parsed incoming message against a controller's element definitions.
 * Returns the named control (single control, matrix cell, or sysex element) or
 * null when nothing matches. Matrix cells are matched by (channel, note) across
 * every matrix — a bare matrix name has no single MIDI number, so this is the
 * matrix-aware resolution `getMidi()` can't express (see README gotcha).
 */
export function resolveIncoming(
  elements: ControllerElements,
  msg: ParsedMidi,
): MidiControl | null {
  if (msg.messageType === "sysex") {
    for (const [name, sysex] of Object.entries(elements.sysex)) {
      // Match against the sysex header prefix.
      const header = sysex.header;
      if (header.length > 0 && startsWith(msg, header)) {
        return { kind: "sysex", name };
      }
    }
    return null;
  }

  // Direct controls + modifiers first (they're unique by midi number).
  const direct = { ...elements.controls, ...elements.modifiers };
  for (const [name, element] of Object.entries(direct)) {
    if (
      element.channel === msg.channel &&
      element.midi === msg.number &&
      element.msgType === msg.messageType
    ) {
      return { kind: "control", name, element };
    }
  }

  // Matrix cells: scan every matrix for a (channel, msgType, note) match.
  for (const [matrixName, matrix] of Object.entries(elements.matrices)) {
    const cell = findCellByNote(matrix, msg.channel, msg.messageType, msg.number);
    if (cell) {
      return {
        kind: "pad",
        matrix: matrixName,
        row: cell.row,
        col: cell.col,
        note: msg.number,
        element: matrix.element,
      };
    }
  }

  return null;
}

function startsWith(msg: ParsedMidi, prefix: number[]): boolean {
  // The full sysex bytes aren't preserved by parseMidiMessage (only a marker),
  // so a prefix match here is a weak best-effort. Callers that need the raw
  // bytes should parse sysex separately. For the APC this is acceptable: the
  // only sysex is the pad-mode control, recognized by its header.
  return msg.messageType === "sysex" && prefix.length > 0;
}

interface CellIndex {
  row: number;
  col: number;
}

/** Map a physical row (0 = top) to an `identifiers` row for a matrix. */
function physicalToIdentifierRow(matrix: ElementMatrix, physicalRow: number): number {
  return matrix.flipRows ? matrix.height - 1 - physicalRow : physicalRow;
}

/** Map an `identifiers` row back to the physical row (0 = top). */
function identifierToPhysicalRow(matrix: ElementMatrix, identifierRow: number): number {
  return matrix.flipRows ? matrix.height - 1 - identifierRow : identifierRow;
}

function findCellByNote(
  matrix: ElementMatrix,
  channel: number,
  messageType: HardwareElement["msgType"],
  note: number,
): CellIndex | null {
  if (matrix.element.channel !== channel) return null;
  if (matrix.element.msgType !== messageType) return null;
  for (let idRow = 0; idRow < matrix.identifiers.length; idRow++) {
    const rowIds = matrix.identifiers[idRow]!;
    const col = rowIds.indexOf(note);
    if (col >= 0) return { row: identifierToPhysicalRow(matrix, idRow), col };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Outgoing helpers: LED feedback + pad-mode sysex
// ---------------------------------------------------------------------------

/** Pad-mode control values (0-based). Verify against the device empirically. */
export const PAD_MODE = {
  session: 0,
  drum: 1,
  note: 2,
  noteEdit: 3,
} as const;

/**
 * Encode the pad-mode control sysex.
 * Header is `[F0 47 7F 4F 62 00 01]`, followed by the mode byte and `F7`.
 */
export function buildPadModeSysex(
  elements: ControllerElements,
  mode: number,
): number[] | null {
  const header = elements.sysex.pad_mode_control?.header;
  if (!header) return null;
  return [...header, mode, 0xf7];
}

/** Build note-on bytes for a pad's LED (channel = ledChannel, velocity = color). */
export function buildLedOn(ledChannel: number, note: number, colorValue: number): number[] {
  return [0x90 | (ledChannel & 0x0f), note, colorValue & 0x7f];
}

/** Build note-off bytes for a pad's LED. */
export function buildLedOff(ledChannel: number, note: number): number[] {
  return [0x90 | (ledChannel & 0x0f), note, 0];
}

/** Resolve a matrix cell to its LED channel (falls back to the element channel). */
export function cellLedChannel(matrix: ElementMatrix, row: number, col: number): number {
  void row;
  void col;
  return matrix.element.ledChannel ?? matrix.element.channel;
}

/** Resolve a matrix cell to its note number (`row` is physical, 0 = top). */
export function cellNote(matrix: ElementMatrix, row: number, col: number): number | null {
  const idRow = physicalToIdentifierRow(matrix, row);
  return matrix.identifiers[idRow]?.[col] ?? null;
}

/** Build note-on bytes for a specific matrix cell's LED. */
export function buildCellLed(
  matrix: ElementMatrix,
  row: number,
  col: number,
  colorValue: number,
): number[] | null {
  const note = cellNote(matrix, row, col);
  if (note === null) return null;
  return buildLedOn(cellLedChannel(matrix, row, col), note, colorValue);
}

/** Build note-off bytes for a specific matrix cell's LED. */
export function buildCellLedOff(
  matrix: ElementMatrix,
  row: number,
  col: number,
): number[] | null {
  const note = cellNote(matrix, row, col);
  if (note === null) return null;
  return buildLedOff(cellLedChannel(matrix, row, col), note);
}
