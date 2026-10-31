/**
 * REAPER project export — rung 3 of the delivery ladder.
 *
 * A `.rpp` is a plain-text, chunked project file: tracks, items, MIDI sources,
 * tempo and regions, all writable by a browser with no process, no scripting
 * API and no licence. That makes REAPER the second DAW TrackDraft can hand a
 * *project* to (rather than a MIDI file the user then wires up by hand), and
 * the first proof that the Ableton commit is an adapter rather than the
 * product's identity.
 *
 * Format facts, taken from real projects rather than guessed — both of them
 * are silent-corruption traps:
 *
 *  - `POSITION` / `LENGTH` / `MARKER` are in **seconds**, not beats. Writing
 *    beats puts every item and region in the wrong place at any tempo ≠ 60.
 *  - `<SOURCE MIDI` declares its own resolution (`HASDATA 1 960 QN`) and then
 *    streams `E <deltaTicks> <status> <d1> <d2>` in hex, deltas relative to
 *    the previous event. Our file export is 480 PPQ; this writes 960, which is
 *    what REAPER itself writes.
 *
 * Everything is derived from the same `sectionSpans` + shared stem planners
 * the `.mid` export and the live stream use, so all three describe one song.
 */

import { sectionSpans, type SectionSpan } from "../arrangement";
import { planBassStem, planChordStem, planDrumStem, type MidiNote } from "../midiExport";
import { planColorStem } from "../colorStem";
import { planMelodyStem } from "../melody/melodyStem";
import { STEM_IDS, STEM_LABELS, type StemId } from "../stems";
import { pitchToWire, velocityToWire } from "../midi/wire";
import type { BlueprintSong } from "../../types/blueprint";

/** REAPER's own MIDI source resolution. */
const RPP_PPQ = 960;

/** The header every project starts with. */
const RPP_HEADER = '<REAPER_PROJECT 0.1 "6.82/OSX64"';

export interface RppOptions {
  /** Apply `song.outputOffsetBeats`, exactly as the `.mid` export does, so
   *  both handoffs place the music identically. */
  applyOutputOffset?: boolean;
}

/** One section's notes, as an item on the timeline. */
interface RppItem {
  name: string;
  startSec: number;
  lengthSec: number;
  notes: MidiNote[];
}

function escapeName(name: string): string {
  // RPP quoted strings: a bare `"` would end the name early.
  return name.replace(/"/g, "'").trim();
}

function guid(): string {
  // REAPER uses braced uppercase UUIDs. `crypto.randomUUID` is polyfilled for
  // plain-HTTP LAN origins at app start (lib/uuid.ts).
  return `{${crypto.randomUUID().toUpperCase()}}`;
}

function secondsAt(beat: number, bpm: number): number {
  return (beat * 60) / bpm;
}

/** Group a stem's notes into one item per section span, so the project reads
 *  as sections rather than one long clip. A note belongs to the span it
 *  STARTS in; its length may run past the section line, and the item grows to
 *  cover it so REAPER doesn't clip the tail.
 *
 *  Note times are rewritten relative to the item's own start: an item's MIDI
 *  source is its own timeline, so absolute song beats here would delay every
 *  event by the section's position.
 *
 *  A note that rings past the section line makes its item run past the next
 *  section's start, so consecutive items on one track overlap by exactly that
 *  tail. That is deliberate: clipping the item at the boundary would cut the
 *  sustain, and REAPER plays overlapping items on a track correctly. The
 *  content stays disjoint — every note's on and off live in the same item —
 *  so nothing double-triggers. */
function itemsFor(notes: MidiNote[], spans: SectionSpan[], bpm: number): RppItem[] {
  const items: RppItem[] = [];
  for (const span of spans) {
    const spanEnd = span.startBeat + span.durationBeats;
    const inside = notes.filter((n) => n.startTime >= span.startBeat && n.startTime < spanEnd);
    if (inside.length === 0) continue;

    const sorted = [...inside]
      .sort((a, b) => a.startTime - b.startTime || a.pitch - b.pitch)
      .map((n) => ({ ...n, startTime: n.startTime - span.startBeat }));
    // The length comes from the item's own last event *tick*, not from beat
    // arithmetic: notes round to ticks on the way out, and a length computed
    // any other way lands short of the note-off it is supposed to contain,
    // which REAPER clips. Deriving it from the ticks also means an item only
    // ever overruns its section when a note actually rings past the line.
    const lastEventTick = sorted.reduce((max, note) => {
      const start = Math.max(0, Math.round(note.startTime * RPP_PPQ));
      return Math.max(max, start + Math.max(1, Math.round(note.duration * RPP_PPQ)));
    }, Math.round(span.durationBeats * RPP_PPQ));
    items.push({
      name: span.section.name,
      startSec: secondsAt(span.startBeat, bpm),
      lengthSec: secondsAt(lastEventTick / RPP_PPQ, bpm),
      notes: sorted,
    });
  }
  return items;
}

/** `E` lines for one item: ons and offs in tick order, deltas relative to the
 *  previous event. Offs sort before ons at the same tick, so a retrigger is a
 *  clean off→on rather than an on→off pair on one tick. */
function midiSourceLines(notes: MidiNote[]): string[] {
  const prepared = notes
    .map((note) => {
      // Same tick maths as the `.mid` export, scaled to this source's PPQ.
      const startTick = Math.max(0, Math.round(note.startTime * RPP_PPQ));
      const durationTicks = Math.max(1, Math.round(note.duration * RPP_PPQ));
      return {
        pitch: pitchToWire(note.pitch),
        velocity: velocityToWire(note.velocity),
        startTick,
        endTick: startTick + durationTicks,
      };
    })
    .sort((a, b) => a.startTick - b.startTick || a.pitch - b.pitch);

  // Same-pitch overlaps are resolved exactly as the .mid export resolves them,
  // so the two files describe the same performance.
  const kept: typeof prepared = [];
  const sounding = new Map<number, (typeof prepared)[number]>();
  for (const note of prepared) {
    const previous = sounding.get(note.pitch);
    if (previous) {
      if (previous.startTick === note.startTick) continue;
      if (previous.endTick >= note.startTick) {
        previous.endTick = Math.max(previous.startTick + 1, note.startTick - 1);
      }
    }
    sounding.set(note.pitch, note);
    kept.push(note);
  }

  const events = kept
    .flatMap((note) => [
      { tick: note.startTick, on: true, pitch: note.pitch, velocity: note.velocity },
      { tick: note.endTick, on: false, pitch: note.pitch, velocity: 0 },
    ])
    .sort((a, b) => a.tick - b.tick || (a.on === b.on ? 0 : a.on ? 1 : -1));

  const lines: string[] = [];
  let previousTick = 0;
  for (const event of events) {
    const delta = event.tick - previousTick;
    previousTick = event.tick;
    const status = event.on ? 0x90 : 0x80;
    lines.push(
      `        E ${delta} ${status.toString(16)} ${event.pitch.toString(16)} ${event.velocity.toString(16)}`,
    );
  }
  return lines;
}

/** The song's sections as REAPER regions — the arrangement, readable on the
 *  timeline the moment the project opens. Repeat passes are numbered, matching
 *  the `.mid`'s per-occurrence naming and the Ableton cue points. */
function regionLines(spans: SectionSpan[], bpm: number): string[] {
  const seen = new Map<string, number>();
  return spans.map((span, index) => {
    const base = escapeName(span.section.name || `Section ${index + 1}`);
    const count = (seen.get(base) ?? 0) + 1;
    seen.set(base, count);
    const label = count > 1 ? `${base} (${count})` : base;
    const start = secondsAt(span.startBeat, bpm).toFixed(6);
    // `1` after the name marks a region rather than a point marker; the rest is
    // REAPER's own field order.
    return `  MARKER ${index + 1} ${start} "${label}" 1 0 1 B ${guid()} 0`;
  });
}

/** Notes for every stem, shifted by the song's render offset when asked. */
function stemNotes(
  song: BlueprintSong,
  spans: SectionSpan[],
  applyOutputOffset: boolean,
): Record<StemId, MidiNote[]> {
  const offset = applyOutputOffset ? (song.outputOffsetBeats ?? 0) : 0;
  const shift = (notes: MidiNote[]): MidiNote[] =>
    offset === 0 ? notes : notes.map((n) => ({ ...n, startTime: Math.max(0, n.startTime + offset) }));

  return {
    drums: shift(planDrumStem(spans, song)),
    bass: shift(planBassStem(spans, song)),
    chords: shift(planChordStem(spans, song)),
    color: shift(planColorStem(spans, song)),
    melody: shift(planMelodyStem(spans, song)),
  };
}

/**
 * The whole project, as text. Open it in REAPER and the song is there: five
 * named tracks, one item per section, the arrangement as regions, and the
 * song's tempo.
 */
export function songToRpp(song: BlueprintSong, opts: RppOptions = {}): string {
  const spans = sectionSpans(song);
  const bpm = song.bpm > 0 ? song.bpm : 120;
  const notes = stemNotes(song, spans, opts.applyOutputOffset ?? true);

  const out: string[] = [];
  out.push(`${RPP_HEADER} ${Math.floor(Date.now() / 1000)}`);
  out.push("  TIMEMODE 1 5 -1 30 0 0 -1"); // items are beats-locked, as REAPER writes them
  // The project tempo. This must be the flat `TEMPO` line, not a tempo
  // envelope: with only a `<TEMPOENVEX>` point, REAPER loads the project at
  // its default 120 — verified by round-tripping a 116 BPM song through
  // REAPER, which re-saved it as `TEMPO 120 4 4 0` and left every
  // seconds-based item sitting off the beat ruler.
  const meterNum = song.timeSignatureNumerator > 0 ? song.timeSignatureNumerator : 4;
  const meterDen = song.timeSignatureDenominator > 0 ? song.timeSignatureDenominator : 4;
  out.push(`  TEMPO ${bpm} ${meterNum} ${meterDen} 0`);
  out.push(...regionLines(spans, bpm));

  for (const stem of STEM_IDS) {
    const stemItems = itemsFor(notes[stem], spans, bpm);
    if (stemItems.length === 0) continue; // a part the song doesn't have

    out.push(`  <TRACK ${guid()}`);
    out.push(`    NAME "${escapeName(STEM_LABELS[stem])}"`);
    for (const item of stemItems) {
      out.push("    <ITEM");
      out.push(`      POSITION ${item.startSec.toFixed(6)}`);
      out.push(`      LENGTH ${Math.max(0.001, item.lengthSec).toFixed(6)}`);
      out.push(`      NAME "${escapeName(item.name)}"`);
      out.push("      SOFFS 0");
      out.push("      LOOP 0");
      // Item identity, which REAPER writes and keeps stable across reloads.
      out.push(`      IGUID ${guid()}`);
      out.push("      IID 1");
      out.push("      <SOURCE MIDI");
      out.push(`        HASDATA 1 ${RPP_PPQ} QN`);
      out.push("        CCINTERP 32");
      out.push(...midiSourceLines(item.notes));
      out.push("      >");
      out.push("    >");
    }
    out.push("  >");
  }

  out.push(">");
  return `${out.join("\n")}\n`;
}

/** Filename matching `downloadSongMidi`'s convention, minus edge dashes (a
 *  leading one would make the file hidden on macOS and Linux). */
export function rppFileName(title: string): string {
  const slug = title
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
  return `${slug || "song"}.rpp`;
}

/** Save the project to a file the user can open in REAPER. */
export function downloadSongRpp(song: BlueprintSong, opts: RppOptions = {}): void {
  const text = songToRpp(song, opts);
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = rppFileName(song.title);
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
