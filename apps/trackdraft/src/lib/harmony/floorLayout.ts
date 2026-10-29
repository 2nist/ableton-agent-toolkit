import type { Chord } from "../../types/blueprint";

/**
 * Where a chord sits on the floor, and how a gesture becomes schema.
 *
 * The schema stores a progression as a *sequence* — `beats` plus the silence
 * around it (`restAfter`, and `restBefore` on the first chord) — because the
 * generator loops that sequence to fill a section. The floor is a timeline:
 * you drag a box to a beat. This module is the only place that converts
 * between the two, and every floor edit goes through it.
 *
 * Two invariants keep it honest:
 *
 * - **Order is time order.** The chord array is the progression the app
 *   loops, so after any edit it is sorted by start beat. A swap therefore
 *   reorders the array, which is exactly what a reorder means here.
 * - **A gap has one owner.** Silence between two chords is written on the
 *   chord before it (`restAfter`); only the cycle's opening silence uses
 *   `restBefore`. No edit can write the same gap twice.
 */

/** One chord with its resolved beat position inside the cycle. */
export interface FloorSlot {
  chord: Chord;
  index: number;
  /** Beat the chord starts on, rests included. */
  start: number;
  /** Beat the chord stops sounding — its own length, so a rest after it is
   *  NOT part of this span (and never past the section's last bar). */
  end: number;
  /** Which loop pass this is: 0 the first time through the progression, 1 the
   *  second, and so on. See `floorSlotsFilled`. */
  pass?: number;
}

/** Half a beat — the floor's snap, and the shortest chord it will make. */
export const FLOOR_STEP = 0.5;

const gap = (value: number | undefined): number =>
  typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;

const length = (chord: Chord): number => Math.max(FLOOR_STEP, chord.beats);

const round = (value: number): number => Math.round(value * 1000) / 1000;

/** Round to the floor's grid. */
export const snap = (beat: number): number =>
  Math.round(beat / FLOOR_STEP) * FLOOR_STEP;

/** Every chord with the beat it starts on, gaps included. */
export function floorSlots(chords: readonly Chord[]): FloorSlot[] {
  const slots: FloorSlot[] = [];
  let cursor = 0;
  chords.forEach((chord, index) => {
    cursor += gap(chord.restBefore);
    const start = cursor;
    cursor += length(chord);
    slots.push({ chord, index, start, end: start + length(chord) });
    cursor += gap(chord.restAfter);
  });
  return slots;
}

/**
 * The progression laid out across a WHOLE SECTION, not one pass.
 *
 * A section's chord list is one pass through its progression: a 16-bar verse
 * built from a 4-bar progression lists only those four chords. Every generator
 * loops the list to fill the section (`loopChordsToFill` in @drum/library), so
 * a section is always as long as its bars say it is — never as long as the
 * chord list happens to add up to. The floor drew one pass, which is why a
 * 25-beat progression in a 7-bar section left the last three beats looking
 * empty while the players were already back on chord one.
 *
 * So: repeat the pass until the section is covered, truncating the final
 * repeat at the last bar exactly as the exports do. `pass` is how the plate
 * knows a box is the loop coming round rather than a new chord.
 */
export function floorSlotsFilled(
  chords: readonly Chord[],
  sectionBeats: number,
): FloorSlot[] {
  const pass = floorSlots(chords);
  if (pass.length === 0) return [];
  const cycle = floorLength(chords);
  if (cycle <= 0 || !Number.isFinite(sectionBeats)) return pass;
  const slots: FloorSlot[] = [];
  for (let index = 0; index * cycle < sectionBeats - 1e-6; index += 1) {
    const offset = index * cycle;
    for (const slot of pass) {
      const start = round(slot.start + offset);
      if (start >= sectionBeats - 1e-6) break;
      slots.push({
        chord: slot.chord,
        index: slot.index,
        start,
        end: Math.min(round(slot.end + offset), sectionBeats),
        pass: index,
      });
    }
  }
  return slots;
}

/** One full pass through the progression, trailing rest included — the beat
 *  the cycle repeats on. */
export function floorLength(chords: readonly Chord[]): number {
  return chords.reduce(
    (sum, chord) =>
      sum + gap(chord.restBefore) + length(chord) + gap(chord.restAfter),
    0,
  );
}

/** The silence on the floor: leading, between, and trailing. */
export function restsBetween(
  chords: readonly Chord[],
): { start: number; beats: number }[] {
  const slots = floorSlots(chords);
  const bands: { start: number; beats: number }[] = [];
  if (slots.length === 0) return bands;
  const leading = gap(chords[0].restBefore);
  if (leading > 0) bands.push({ start: 0, beats: leading });
  for (let index = 0; index < slots.length - 1; index += 1) {
    const beats = slots[index + 1].start - slots[index].end;
    if (beats > 0.001) bands.push({ start: slots[index].end, beats });
  }
  const trailing = gap(chords[chords.length - 1].restAfter);
  if (trailing > 0)
    bands.push({ start: slots[slots.length - 1].end, beats: trailing });
  return bands;
}

/**
 * Resolve desired start beats into the schema: sorted by time, pushed apart
 * so nothing overlaps, every gap written on exactly one chord. Every gesture
 * below funnels through here, so they cannot disagree about what a gap is.
 */
function applyStarts(
  chords: readonly Chord[],
  starts: readonly number[],
): Chord[] {
  const wanted = chords
    .map((chord, index) => ({
      chord,
      start: Math.max(0, round(starts[index] ?? 0)),
    }))
    .sort((left, right) => left.start - right.start);

  let cursor = 0;
  const placed = wanted.map(({ chord, start }) => {
    const resolved = Math.max(start, cursor);
    // The requested starts are the whole truth about placement: a stored
    // `restAfter` must not re-inflate a gap that a gesture just closed.
    cursor = resolved + length(chord);
    return { chord, start: resolved };
  });

  // Silence BEFORE a chord is owned by the chord before it, so the gap index
  // and the chord index are deliberately offset by one. Getting this wrong
  // loses the position on the round trip, which is exactly what a rest is.
  const resolved = placed.map(({ chord }) => {
    const { restBefore: _before, restAfter: _after, ...rest } = chord;
    return { ...rest } as Chord;
  });
  placed.forEach(({ start }, index) => {
    const before =
      index === 0
        ? start
        : start - (placed[index - 1].start + length(placed[index - 1].chord));
    if (before <= 0) return;
    if (index === 0) resolved[0].restBefore = round(before);
    else resolved[index - 1].restAfter = round(before);
  });
  // The last chord keeps whatever silence closes the cycle.
  const trailing = gap(placed[placed.length - 1]?.chord.restAfter);
  if (trailing > 0) resolved[resolved.length - 1].restAfter = trailing;
  return resolved;
}

/** The chord whose span contains `beat`, ignoring one id. */
function chordAt(
  slots: readonly FloorSlot[],
  beat: number,
  exceptId: string,
): FloorSlot | undefined {
  return slots.find(
    (slot) =>
      slot.chord.id !== exceptId &&
      beat + 0.001 >= slot.start &&
      beat < slot.end - 0.001,
  );
}

/** Move a chord to a beat. Landing on another chord trades places; landing in
 *  a gap leaves a rest behind. */
export function moveChordTo(
  chords: readonly Chord[],
  id: string,
  start: number,
): Chord[] {
  const slots = floorSlots(chords);
  const moving = slots.find((slot) => slot.chord.id === id);
  if (!moving) return [...chords];
  const target = Math.max(0, snap(start));
  const victim = chordAt(slots, target, id);
  const starts = slots.map((slot) => slot.start);
  if (victim) {
    starts[moving.index] = victim.start;
    starts[victim.index] = moving.start;
  } else {
    starts[moving.index] = target;
  }
  return applyStarts(chords, starts);
}

/**
 * Stretch or shrink from the end. Growing pushes what follows (the floor is a
 * timeline, not a fixed grid); shrinking leaves a rest behind.
 */
export function resizeChordTo(
  chords: readonly Chord[],
  id: string,
  end: number,
): Chord[] {
  const slots = floorSlots(chords);
  const slot = slots.find((candidate) => candidate.chord.id === id);
  if (!slot) return [...chords];
  const beats = Math.max(FLOOR_STEP, round(snap(end) - slot.start));
  const nextChords = chords.map((chord) =>
    chord.id === id ? { ...chord, beats } : chord,
  );
  return applyStarts(
    nextChords,
    slots.map((entry) => entry.start),
  );
}

/** Move the start, keeping the end — the space given up becomes a rest. */
export function trimChordTo(
  chords: readonly Chord[],
  id: string,
  start: number,
): Chord[] {
  const slots = floorSlots(chords);
  const slot = slots.find((candidate) => candidate.chord.id === id);
  if (!slot) return [...chords];
  const previous = slots[slot.index - 1];
  const lowest = previous ? previous.end : 0;
  const next = Math.max(lowest, Math.min(slot.end - FLOOR_STEP, snap(start)));
  const beats = round(slot.end - next);
  const nextChords = chords.map((chord) =>
    chord.id === id ? { ...chord, beats } : chord,
  );
  const starts = slots.map((entry) => entry.start);
  starts[slot.index] = next;
  return applyStarts(nextChords, starts);
}

/** Open (or close) silence after a chord, pushing the rest of the cycle. */
export function setRestAfter(
  chords: readonly Chord[],
  id: string,
  beats: number,
): Chord[] {
  const slots = floorSlots(chords);
  const slot = slots.find((candidate) => candidate.chord.id === id);
  if (!slot) return [...chords];
  const silence = Math.max(0, snap(beats));
  const delta = silence - gap(slot.chord.restAfter);
  const starts = slots.map((entry, index) =>
    index > slot.index ? entry.start + delta : entry.start,
  );
  const nextChords = chords.map((chord) => {
    if (chord.id !== id) return chord;
    const { restAfter: _drop, ...rest } = chord;
    return silence > 0 ? { ...rest, restAfter: silence } : rest;
  });
  return applyStarts(nextChords, starts);
}

/**
 * Insert a chord at a beat — the "run up to a chord" gesture.
 *
 * Landing inside a chord truncates that chord at the drop point and gives the
 * new chord the time it gave up; landing exactly on a chord's start borrows
 * from its front instead, so the chord you are running up to never moves.
 * Landing in a rest fills part of it and leaves the next chord where it was.
 */
export function insertChordAt(
  chords: readonly Chord[],
  beat: number,
  chord: Chord,
  span: number,
): Chord[] {
  const at = Math.max(0, round(snap(beat)));
  const slots = floorSlots(chords);
  const host = slots.find((slot) => at >= slot.start && at < slot.end - 0.001);
  const next = slots.find((slot) => slot.start > at);
  const room = host
    ? host.end - at
    : next
      ? next.start - at
      : Math.max(span, FLOOR_STEP);
  const wanted = Math.max(FLOOR_STEP, Math.max(FLOOR_STEP, span));

  // Inserting at the very front of a chord means taking its first beats, not
  // its last: the chord you are running up to keeps its place.
  const atFront = host !== undefined && at - host.start < FLOOR_STEP;
  const beats = atFront
    ? Math.max(FLOOR_STEP, Math.min(wanted, host.chord.beats - FLOOR_STEP))
    : Math.max(FLOOR_STEP, Math.min(wanted, room));

  const starts = slots.map((slot) => slot.start);
  const nextChords = chords.map((entry) => {
    if (!host || entry.id !== host.chord.id) return entry;
    if (atFront) {
      const shortened = round(entry.beats - beats);
      starts[host.index] = round(at + beats);
      return { ...entry, beats: Math.max(FLOOR_STEP, shortened) };
    }
    return { ...entry, beats: Math.max(FLOOR_STEP, round(at - host.start)) };
  });

  return applyStarts([...nextChords, { ...chord, beats }], [...starts, at]);
}

/** Close a rest, pulling everything after it earlier. */
export function closeRestAt(chords: readonly Chord[], beat: number): Chord[] {
  const band = restsBetween(chords).find(
    (rest) => beat >= rest.start - 0.001 && beat < rest.start + rest.beats,
  );
  if (!band) return [...chords];
  const slots = floorSlots(chords);
  const starts = slots.map((slot) =>
    slot.start > band.start ? slot.start - band.beats : slot.start,
  );
  return applyStarts(chords, starts);
}

/** Give a rest's time to the chord before it. */
export function extendIntoRestAt(
  chords: readonly Chord[],
  beat: number,
): Chord[] {
  const band = restsBetween(chords).find(
    (rest) => beat >= rest.start - 0.001 && beat < rest.start + rest.beats,
  );
  if (!band) return [...chords];
  const slots = floorSlots(chords);
  const before = [...slots]
    .reverse()
    .find((slot) => slot.end <= band.start + 0.001);
  if (!before) return [...chords];
  const nextChords = chords.map((chord) =>
    chord.id === before.chord.id
      ? { ...chord, beats: round(chord.beats + band.beats) }
      : chord,
  );
  return applyStarts(
    nextChords,
    slots.map((slot) => slot.start),
  );
}

/** Delete a chord; whatever it occupied closes up. */
export function removeChord(chords: readonly Chord[], id: string): Chord[] {
  return chords.filter((chord) => chord.id !== id);
}

/** Append a chord at the end of the cycle. */
export function appendChord(chords: readonly Chord[], chord: Chord): Chord[] {
  const slots = floorSlots(chords);
  const end =
    slots.length === 0
      ? 0
      : slots[slots.length - 1].end + gap(chords[chords.length - 1].restAfter);
  return applyStarts(
    [...chords, chord],
    [...slots.map((slot) => slot.start), end],
  );
}
