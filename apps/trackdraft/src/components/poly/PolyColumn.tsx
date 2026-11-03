import {
  memo,
  useEffect,
  useMemo,
  useRef,
  type PointerEvent as ReactPointerEvent,
} from "react";
import type { DrumLaneId } from "@drum/library";
import type { RoleStyle } from "../../lib/roleColors";
import { LONG_PRESS_MS, useLongPress } from "../../hooks/useLongPress";
import type { BlueprintSection } from "../../types/blueprint";
import type { PolySongSlice } from "../../lib/poly/songSlice";
import { clockLabel, type PolyLod } from "../../lib/poly/lod";
import {
  polyChords,
  polyColor,
  polyDrumPattern,
  polyDrums,
  polyLyrics,
  type PolyDrumRow,
} from "../../lib/poly/content";
import type { DrumStepAuthored } from "../../lib/poly/drumSteps";
import { polyNoteFrame, type PolyNoteFrame } from "../../lib/poly/melody";
import { bassFrameFor, bassNotesFor } from "../../lib/poly/bass";
import {
  CLOCK_SCOPE,
  drumClockLabel,
  DRUM_LANE_LABEL,
  drumLaneInk,
  grooveChip,
  passVariance,
} from "../../lib/poly/drums";
import { driftLabel } from "../../lib/poly/drift";
import { modulationMarks } from "../../lib/poly/tonality";
import {
  POLY_SPINE_H,
  laneGeometry,
  polyContentScale,
  type PolyLaneGeometry,
  type PolyLaneId,
  type PolyNode,
} from "../../lib/poly/layout";

/** The lanes that carry editable notes. Both are the same geometry and the
 *  same gestures; only the field they write differs. */
export type PolyNoteLane = "melody" | "bass";

/** The designed order — what a column uses unless the canvas passes its own. */
const DEFAULT_GEOMETRY = laneGeometry();

/**
 * One section, drawn as a vertical band crossing every lane.
 *
 * ```
 *   lyric   ───────────────
 *   bass    ───────────────
 *   drums   ───────────────
 *  ═════════ NAME · #n ═════════   ← the time spine
 *   chords  ───────────────
 *   color   ───────────────
 *   melody  ───────────────
 * ```
 *
 * The band is the handle: click selects, double-click renames, drag moves,
 * right-click opens the role palette, and the edge resizes. Everything is
 * authored in SCREEN units and divided by the zoom, so text stays ~12px at
 * any scale.
 */
/** One decimal is all a note tooltip needs. */
const round = (value: number) => Math.round(value * 10) / 10;

export interface PolyColumnActions {
  select: (node: PolyNode) => void;
  hover: (key: string | null) => void;
  beginRename: (node: PolyNode) => void;
  rename: (node: PolyNode, name: string) => void;
  cancelRename: () => void;
  beginResize: (node: PolyNode, event: ReactPointerEvent<HTMLElement>) => void;
  beginMove: (node: PolyNode, event: ReactPointerEvent<HTMLElement>) => void;
  openMenu: (node: PolyNode, at: { clientX: number; clientY: number }) => void;
  pickLane: (
    node: PolyNode,
    lane: PolyLaneId,
    at?: { x: number; y: number },
  ) => void;
  pickChord: (node: PolyNode, chordId: string) => void;
  /** Double-click on a chord cell: retype its numeral in place. */
  beginChordEdit: (node: PolyNode, chordId: string) => void;
  /** Right-click on a chord cell: the harmony view's chord verbs (§S1). */
  openChordMenu: (
    node: PolyNode,
    chordId: string,
    event: React.MouseEvent<HTMLElement>,
  ) => void;
  /** Press and drag a chord cell sideways: move the chord in the progression.
   *  The cell centres travel with the call so the view can pick a target
   *  without re-measuring the layout it is about to change. */
  beginChordMove: (
    node: PolyNode,
    chordId: string,
    centres: { chordId: string; centreX: number }[],
    event: ReactPointerEvent<HTMLElement>,
  ) => void;
  /** Drag a chord cell's right edge: change how long that chord lasts. */
  beginChordResize: (
    node: PolyNode,
    chordId: string,
    event: ReactPointerEvent<HTMLElement>,
  ) => void;
  commitChordEdit: (node: PolyNode, chordId: string, text: string) => void;
  cancelChordEdit: () => void;
  toggleDrumLane: (lane: DrumLaneId, mode: "mute" | "solo") => void;
  /** Paint or clear one step of a lane's necklace. */
  toggleDrumStep: (
    node: PolyNode,
    lane: DrumLaneId,
    index: number,
    columns: number,
    on: boolean,
  ) => void;
  /** Right-click a painted step: hold, ratchet, flam, probability and clear. */
  openStepMenu: (
    node: PolyNode,
    lane: DrumLaneId,
    index: number,
    columns: number,
    event: React.MouseEvent<HTMLElement>,
  ) => void;
  /** ⇧-click a painted step: cycle its ratchet (×1 → ×4). */
  cycleDrumRatchet: (
    node: PolyNode,
    lane: DrumLaneId,
    index: number,
    columns: number,
  ) => void;
  /** ⌥-click a painted step: grace it (flam on / off). */
  toggleDrumFlam: (
    node: PolyNode,
    lane: DrumLaneId,
    index: number,
    columns: number,
  ) => void;
  /** Drag the right edge of a painted step: how long the hit holds. */
  beginDrumGate: (
    node: PolyNode,
    lane: DrumLaneId,
    index: number,
    columns: number,
    event: ReactPointerEvent<HTMLElement>,
  ) => void;
  /** Step the section's groove along the energy ladder (⌥ reverses). */
  stepGroove: (direction: 1 | -1) => void;
  /** Snap this section's clock to the 16th grid — the fix for drift. */
  snapClock: (sectionId: string) => void;
  /** Step through the current preset's baked variants. */
  stepVariant: (direction: 1 | -1) => void;
  /** Pointer down on a note: selects it and starts a pitch/time drag. */
  beginNote: (
    node: PolyNode,
    index: number,
    event: ReactPointerEvent<HTMLElement>,
    lane?: PolyNoteLane,
    mode?: "move" | "resize",
  ) => void;
  /** Double-click on empty lane space: drop a note where the pointer is. */
  addNote: (
    node: PolyNode,
    point: { x: number; y: number },
    lane?: PolyNoteLane,
  ) => void;
  beginLyric: (node: PolyNode) => void;
  commitLyric: (node: PolyNode, text: string) => void;
  cancelLyric: () => void;
}

interface Props {
  node: PolyNode;
  section: BlueprintSection;
  /** Only the eight song-level fields a column reads (§S1.6) — the whole song
   *  made every column's memo miss on any edit. */
  song: PolySongSlice;
  /** The AUTHORED section, for comparing this pass against it (§P4.4). Passed
   *  separately because `section` may be a pass with overrides applied. */
  authored?: BlueprintSection;
  role: RoleStyle;
  lod: PolyLod;
  inverseZoom: number;
  selected: boolean;
  hovered: boolean;
  editingName: boolean;
  editingLyric: boolean;
  /** The melody note currently held, if any — drawn with an accent ring. */
  selectedNote: number | null;
  /** The bass note currently held, same convention. */
  selectedBassNote?: number | null;
  /** The chord cell being retyped, if any. */
  editingChordId: string | null;
  /** A drum gate being dragged: drawn live, committed on release (§S1.8). */
  gateDraft?: { lane: DrumLaneId; index: number; beats: number } | null;
  /** Lifted off the spine: drawn dashed, tethered to where it still plays. */
  placed: boolean;
  /** Lane order and offsets — a reading preference, so it comes from above. */
  lanes?: PolyLaneGeometry;
  /** Numeral or chord name in the chords and colour lanes. */
  chordLabels?: "roman" | "letter";
  actions: PolyColumnActions;
}

/** The feel of an authored step, as a suffix for a tooltip: " · ×2 · flam". */
function feelSuffix(authored: DrumStepAuthored | null | undefined): string {
  if (!authored) return "";
  const parts: string[] = [];
  if (authored.ratchet > 1) parts.push(`×${authored.ratchet}`);
  if (authored.flam) parts.push("flam");
  if (authored.prob < 1) parts.push(`${Math.round(authored.prob * 100)}%`);
  return parts.length > 0 ? ` · ${parts.join(" · ")}` : "";
}

/**
 * One drum hit, drawn as the thing it plays: a bar for its gate, split into the
 * sub-hits of its ratchet, with a grace tick in front when it is a flam (§S1.9).
 *
 * A ratchet and a flam are only visible in the resolved hits as "more onsets in
 * this cell", which is also what two generated hits look like — so the marks come
 * from the AUTHORED step, not from counting notes.
 */
function DrumHitBar({
  ink,
  ratchet,
  flam,
  u,
}: {
  ink: string;
  ratchet: number;
  flam: boolean;
  u: number;
}) {
  const parts = Math.max(1, Math.min(4, Math.round(ratchet)));
  return (
    <>
      {flam ? (
        <span
          aria-hidden
          style={{
            position: "absolute",
            left: "-24%",
            width: "20%",
            top: "18%",
            bottom: "18%",
            borderRadius: 0.5 * u,
            background: ink,
            opacity: 0.55,
          }}
        />
      ) : null}
      <span
        aria-hidden
        className="flex"
        style={{
          position: "absolute",
          inset: 0,
          gap: parts > 1 ? Math.max(1, 1.5 * u) : 0,
        }}
      >
        {Array.from({ length: parts }, (_, part) => (
          <span
            key={part}
            style={{
              flex: 1,
              borderRadius: 0.5 * u,
              background: ink,
              // The last sub-hit is quieter, so a roll reads as a gesture rather
              // than as four equal steps.
              opacity: parts > 1 && part > 0 ? 0.82 : 1,
            }}
          />
        ))}
      </span>
    </>
  );
}

/**
 * How many cells a drum hit's gate spans, in cells (never under 1).
 *
 * A hit's length is in beats, the row is in cells, and the two are only the same
 * number when a cell happens to be a beat. This is the conversion both the
 * selected and the inert drawings need, so it lives in one place — and it reads
 * the LIVE draft first, so the bar grows under the pointer instead of on release.
 */
function heldCells(
  row: PolyDrumRow,
  index: number,
  node: { durationBeats: number },
  draft?: { lane: DrumLaneId; index: number; beats: number } | null,
): number {
  const columns = row.cells.length;
  const cellBeats = node.durationBeats / Math.max(1, columns);
  if (!(cellBeats > 0)) return 1;
  const beats =
    draft && draft.lane === row.lane && draft.index === index
      ? draft.beats
      : (row.gates?.[index] ?? 0);
  // A zero/absent gate is a hit whose planner gave no length — draw it as the
  // cell it occupies rather than as nothing.
  if (!(beats > 0)) return 1;
  return Math.max(1, beats / cellBeats);
}

/** The gate as a phrase a screen reader (and a tooltip) can read back: the
 *  value a drag is changing, in beats, with its length in plain words. */
function heldLabel(
  row: PolyDrumRow,
  index: number,
  node: { durationBeats: number },
  draft?: { lane: DrumLaneId; index: number; beats: number } | null,
): string {
  const cells = heldCells(row, index, node, draft);
  const beats = Math.round(cells * 100) / 100;
  return `${beats} ${beats === 1 ? "step" : "steps"}`;
}

/** Where a clocked section's notes actually sound, drawn dim under the stored
 *  bars (§P3.7). The lane edits the written line; this is the reading of it. */
function NoteGhosts({ frame, u }: { frame: PolyNoteFrame; u: number }) {
  if (!frame.ghost?.length) return null;
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0">
      {frame.ghost.map((mark, index) => (
        <span
          key={index}
          style={{
            position: "absolute",
            left: `${mark.x * 100}%`,
            width: `max(${3 * u}px, ${mark.w * 100}%)`,
            top: `calc(${mark.y * 100}% - ${2.5 * u}px)`,
            height: 5 * u,
            borderRadius: 1 * u,
            border: `${1 * u}px dashed rgb(var(--c-ink) / 0.45)`,
            boxSizing: "border-box",
          }}
        />
      ))}
    </div>
  );
}

function PolyColumn({
  node,
  section,
  song,
  authored,
  role,
  lod,
  inverseZoom,
  selected,
  hovered,
  editingName,
  editingLyric,
  selectedNote,
  selectedBassNote = null,
  editingChordId,
  gateDraft = null,
  placed,
  lanes = DEFAULT_GEOMETRY,
  chordLabels = "roman",
  actions,
}: Props) {
  // Content inside a lane is authored in screen pixels (`inverseZoom` turns a
  // pixel into world units), so on its own it would ignore how tall the row is
  // and taller rows would be pure padding. `polyContentScale` lets it grow into
  // the space the rows bought, and stops — see §0.13.
  const u = inverseZoom * polyContentScale(node.h / inverseZoom);
  const withLanes = lod === "full" || lod === "detail";
  const bassLine = useMemo(() => bassNotesFor(section, song), [section, song]);
  const bassFrame = useMemo(() => bassFrameFor(section, song), [section, song]);
  const bassAuthored = bassLine.authored;

  // Holding the column opens the role palette — the same place right-click
  // goes, for pointers that have no right button. A moving press is a drag, so
  // the timer cancels itself the moment the pointer travels.
  const bandHold = useLongPress(
    ({ x, y }) => actions.openMenu(node, { clientX: x, clientY: y }),
    {
      delay: LONG_PRESS_MS,
    },
  );
  // Holding the groove chip steps it back — the `⌥`-click action, without the
  // modifier. The chip itself stays a click = busier, which is the common move.
  const grooveHold = useLongPress(() => actions.stepGroove(-1), {
    delay: LONG_PRESS_MS,
    enabled: selected && withLanes,
  });
  const variantHold = useLongPress(() => actions.stepVariant(-1), {
    delay: LONG_PRESS_MS,
    enabled: selected && withLanes,
  });
  const deep = lod === "detail";

  const chords = useMemo(
    () => (withLanes ? polyChords(section, song, node.durationBeats) : []),
    [withLanes, section, song, node.durationBeats],
  );
  const lyricLines = useMemo(
    () => (withLanes ? polyLyrics(section) : []),
    [withLanes, section],
  );
  const drums = useMemo(
    () =>
      withLanes ? polyDrumPattern(section, song, node.occurrenceIndex) : [],
    [withLanes, section, song, node.occurrenceIndex],
  );
  // Where those cells SOUND, with the clock applied — the same grid's hits, for
  // the drift readout only. The lane draws `drums` (pattern space) because a
  // paint has to write the cell it looks like it writes.
  const clockedDrums = useMemo(
    () => (withLanes ? polyDrums(section, song, node.occurrenceIndex) : []),
    [withLanes, section, song, node.occurrenceIndex],
  );
  const groove = useMemo(() => grooveChip(section), [section]);
  const clockBadge = useMemo(() => drumClockLabel(section), [section]);
  /** What makes THIS pass different from the section it came from (§P4.4) — so
   *  three near-identical columns do not need three menus opened to tell apart. */
  const variance = useMemo(() => {
    // A column is often rendered against a partial song (tests, the perf lab):
    // no sections means "nothing to compare to", not a crash.
    if (!authored) return passVariance(undefined, undefined);
    return passVariance(authored, section);
  }, [authored, section]);
  // What the clock did to the hits: how many it pushed off the 16th grid, and
  // how many it pushed past the end of the section.
  const clockDrift = useMemo(
    () =>
      clockedDrums.reduce(
        (total, row) => ({
          offGrid: total.offGrid + row.offGrid,
          worst: Math.max(total.worst, row.worstDrift),
          dropped: total.dropped + row.dropped,
        }),
        { offGrid: 0, worst: 0, dropped: 0 },
      ),
    [clockedDrums],
  );
  // Every element is on the standard view: 50% is the zoom the canvas is
  // designed around, so a lane must not be empty just because the face is
  // "only" full. `deep` now buys the band's facts line, nothing structural.
  const color = useMemo(
    () => (withLanes ? polyColor(section, song) : []),
    [withLanes, section, song],
  );
  const melody = useMemo<PolyNoteFrame | null>(
    () => (withLanes ? polyNoteFrame(section) : null),
    [withLanes, section],
  );

  // The editor is opened by a click gesture, so focus has to be claimed
  // explicitly once it mounts — and a blur that happens before that is not a
  // commit, it is the gesture finishing.
  const lyricRef = useRef<HTMLTextAreaElement | null>(null);
  const lyricFocused = useRef(false);
  useEffect(() => {
    if (!editingLyric) {
      lyricFocused.current = false;
      return;
    }
    const el = lyricRef.current;
    if (!el) return;
    el.focus();
    el.select();
    lyricFocused.current = true;
  }, [editingLyric]);

  // Same rule as the lyric editor: the editor is opened by a gesture, so it
  // must claim focus itself, and a blur before that is the gesture ending
  // rather than a commit.
  const chordRef = useRef<HTMLInputElement | null>(null);
  const chordFocused = useRef(false);
  useEffect(() => {
    if (!editingChordId) {
      chordFocused.current = false;
      return;
    }
    const el = chordRef.current;
    if (!el) return;
    el.focus();
    el.select();
    chordFocused.current = true;
  }, [editingChordId]);

  const spineTop = -node.y - POLY_SPINE_H / 2;
  const laneTop = (id: PolyLaneId) => {
    const rect = lanes.byId.get(id);
    return rect ? rect.y - node.y : 0;
  };
  const laneHeight = (id: PolyLaneId) => lanes.byId.get(id)?.h ?? 0;

  // Only when it is news: a section in another key, or one that modulates
  // inside itself. The numerals already follow whichever home is in force.
  // Where the key changes inside this section, so the `+N` badge has a place
  // as well as a count.
  const modulationTicks =
    lod === "dot" || lod === "compact"
      ? []
      : modulationMarks(
          section,
          node.durationBeats,
          node.durationBeats / Math.max(1, node.bars),
        );

  const tonalityBadge = (() => {
    const tonality = node.tonality;
    if (!tonality || (!tonality.own && tonality.modulations === 0)) return null;
    const home = `${tonality.key} ${tonality.scale}`;
    const shifts =
      tonality.modulations > 0 ? `, ${tonality.modulations} key change(s)` : "";
    return {
      label: `${home}${tonality.modulations > 0 ? ` +${tonality.modulations}` : ""}`,
      title: tonality.own
        ? `Read in ${home} — not the song's key${shifts}`
        : `${home}${shifts} inside this section`,
    };
  })();

  const summary = [
    `${node.bars}b`,
    node.facts.meter,
    node.startSeconds != null ? clockLabel(node.startSeconds) : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const editable = lod !== "dot";

  return (
    <div
      className="absolute"
      style={{
        left: node.x,
        top: node.y,
        width: node.w,
        height: node.h,
        pointerEvents: "none",
      }}
    >
      {/* One target for the whole column: click selects, double-click renames,
          drag moves it along the spine, right-click opens the role palette. */}
      <button
        type="button"
        aria-label={`${node.name}, ${node.bars} bars, ${node.facts.meter}${placed ? ", lifted off the spine" : ""}`}
        aria-pressed={selected}
        onClick={() => actions.select(node)}
        onDoubleClick={() => actions.beginRename(node)}
        onPointerDown={(event) => {
          // ⌥ is not excluded any more: it means "drop a copy here" (§0.17).
          if (event.button !== 0 || event.metaKey || event.ctrlKey) return;
          bandHold.onPointerDown(event);
          actions.beginMove(node, event);
        }}
        onPointerMove={bandHold.onPointerMove}
        onPointerUp={bandHold.onPointerUp}
        onPointerLeave={bandHold.onPointerLeave}
        onContextMenu={(event) => {
          event.preventDefault();
          actions.openMenu(node, event);
        }}
        onMouseEnter={() => actions.hover(node.key)}
        onMouseLeave={() => actions.hover(null)}
        className="absolute inset-0"
        style={{
          pointerEvents: "auto",
          background: selected
            ? "rgb(var(--c-accent) / 0.07)"
            : hovered
              ? "rgb(var(--c-ink) / 0.035)"
              : lod === "dot"
                ? role.bg
                : `${role.bg}1f`,
          opacity: lod === "dot" && !selected ? 0.85 : 1,
          border:
            lod === "dot"
              ? `${2 * u}px solid ${selected ? "rgb(var(--c-accent))" : "rgb(var(--c-edge))"}`
              : undefined,
          borderRadius: lod === "dot" ? 2 * u : 0,
        }}
      />

      {editable ? (
        <>
          {/* One transparent hit strip per lane: clicking a lane selects the
              section AND opens that element's tools. Empty lanes are the
              point — "there is nothing here" is a place to click. */}
          {withLanes
            ? lanes.rects.map((rect) => (
                <div
                  key={`hit-${rect.id}`}
                  data-poly-lane={rect.id}
                  aria-hidden
                  onClick={(event) => {
                    event.stopPropagation();
                    actions.select(node);
                    actions.pickLane(node, rect.id, {
                      x: event.clientX,
                      y: event.clientY,
                    });
                  }}
                  onDoubleClick={
                    rect.id === "lyric"
                      ? (event) => {
                          event.stopPropagation();
                          actions.beginLyric(node);
                        }
                      : undefined
                  }
                  style={{
                    position: "absolute",
                    top: rect.y - node.y,
                    height: rect.h,
                    left: 0,
                    right: 0,
                    pointerEvents: "auto",
                    cursor: rect.id === "lyric" ? "text" : "pointer",
                  }}
                />
              ))
            : null}

          {/* Lyric ------------------------------------------------------- */}
          {laneHeight("lyric") > 0 ? (
            <div
              className="absolute flex flex-col justify-center overflow-hidden"
              style={{
                top: laneTop("lyric"),
                height: laneHeight("lyric"),
                left: 3 * u,
                right: 3 * u,
              }}
            >
              {editingLyric ? (
                <textarea
                  ref={lyricRef}
                  defaultValue={section.lyrics ?? ""}
                  aria-label={`Edit lyrics for ${node.name}`}
                  onClick={(event) => event.stopPropagation()}
                  onPointerDown={(event) => event.stopPropagation()}
                  onKeyDown={(event) => {
                    event.stopPropagation();
                    if (event.key === "Escape") actions.cancelLyric();
                    else if (
                      event.key === "Enter" &&
                      (event.metaKey || event.ctrlKey)
                    ) {
                      actions.commitLyric(node, event.currentTarget.value);
                    }
                  }}
                  onBlur={() => {
                    if (lyricFocused.current)
                      actions.commitLyric(node, lyricRef.current?.value ?? "");
                  }}
                  className="w-full resize-none rounded-sm bg-canvas px-1 text-ink outline-none"
                  style={{
                    fontSize: 10 * u,
                    lineHeight: 1.35,
                    height: "100%",
                    pointerEvents: "auto",
                  }}
                />
              ) : lyricLines.length > 0 ? (
                lyricLines.slice(0, 3).map((line, index) => (
                  <div
                    key={index}
                    className="truncate italic text-inkMuted"
                    style={{ fontSize: 10 * u, lineHeight: 1.4 }}
                  >
                    {line}
                  </div>
                ))
              ) : null}
            </div>
          ) : null}

          {/* Bass --------------------------------------------------------
              Real notes, like the melody lane: this is the lane you drag, so it
              has to be the thing that is true. A section with no authored line
              draws its generated one, and the first drag writes that line into
              `bassNotes` with your change applied — you never start from
              silence. */}
          {bassFrame.notes.length > 0 ? (
            <div
              className="absolute"
              data-poly-bass={node.sectionId}
              onDoubleClick={(event) => {
                event.stopPropagation();
                const box = event.currentTarget.getBoundingClientRect();
                if (box.width <= 0 || box.height <= 0) return;
                actions.addNote(
                  node,
                  {
                    x: (event.clientX - box.left) / box.width,
                    y: (event.clientY - box.top) / box.height,
                  },
                  "bass",
                );
              }}
              onClick={(event) => {
                actions.select(node);
                // Empty space in the lane is also the way to the line's
                // controls; a click on a note is that note's, not the panel's.
                if (event.target === event.currentTarget)
                  actions.pickLane(node, "bass", {
                    x: event.clientX,
                    y: event.clientY,
                  });
              }}
              style={{
                top: laneTop("bass"),
                height: laneHeight("bass"),
                left: 0,
                right: 0,
                pointerEvents: "auto",
              }}
            >
              <NoteGhosts frame={bassFrame} u={u} />
              {bassFrame.notes.map((note) => {
                const held = selectedBassNote === note.index;
                return (
                  <button
                    key={note.index}
                    type="button"
                    data-poly-bass-note={note.index}
                    aria-label={`Bass note ${note.index + 1}, pitch ${note.pitch}, beat ${round(note.startTime)}`}
                    title={`Pitch ${note.pitch} · ${round(note.duration)} beat(s) · drag to move${bassAuthored ? "" : " · editing writes your own line"}`}
                    onPointerDown={(event) => {
                      if (event.button !== 0 || event.altKey) return;
                      event.stopPropagation();
                      event.preventDefault();
                      actions.beginNote(node, note.index, event, "bass");
                    }}
                    onDoubleClick={(event) => event.stopPropagation()}
                    style={{
                      position: "absolute",
                      left: `${note.x * 100}%`,
                      width: `max(${6 * u}px, ${note.w * 100}%)`,
                      top: `calc(${note.y * 100}% - ${2.5 * u}px)`,
                      height: 5 * u,
                      borderRadius: 1 * u,
                      border: held
                        ? `${1.5 * u}px solid rgb(var(--c-accent))`
                        : undefined,
                      background: held
                        ? "rgb(var(--c-accent))"
                        : bassAuthored
                          ? "rgb(var(--c-ink) / 0.72)"
                          : "rgb(var(--c-ink) / 0.55)",
                      pointerEvents: "auto",
                      cursor: "ns-resize",
                    }}
                  />
                );
              })}
              {bassFrame.notes.map((note) => (
                <span
                  key={`len-${note.index}`}
                  role="separator"
                  aria-label={`Lengthen or shorten bass note ${note.index + 1}`}
                  title="Drag to change how long this note lasts"
                  onPointerDown={(event) => {
                    if (event.button !== 0 || event.altKey) return;
                    event.stopPropagation();
                    event.preventDefault();
                    actions.beginNote(
                      node,
                      note.index,
                      event,
                      "bass",
                      "resize",
                    );
                  }}
                  onDoubleClick={(event) => event.stopPropagation()}
                  style={{
                    position: "absolute",
                    // The edge itself: a 6-unit-wide grab zone centred on the
                    // note's right end, so it is reachable at any zoom.
                    left: `calc(${(note.x + note.w) * 100}% - ${3 * u}px)`,
                    width: 6 * u,
                    top: `calc(${note.y * 100}% - ${3.5 * u}px)`,
                    height: 7 * u,
                    cursor: "ew-resize",
                    pointerEvents: "auto",
                  }}
                />
              ))}
            </div>
          ) : null}

          {/* Drums ------------------------------------------------------- */}
          {drums.length > 0 ? (
            <div
              className="absolute flex flex-col justify-center"
              style={{
                top: laneTop("drums"),
                height: laneHeight("drums"),
                left: 2 * u,
                right: 2 * u,
                gap: 2 * u,
              }}
            >
              {drums.map((row) => (
                <div
                  key={row.lane}
                  className="relative"
                  style={{
                    pointerEvents: "auto",
                    opacity: row.silent ? 0.45 : 1,
                  }}
                >
                  {/* Overlaid, NOT laid out: the glyph used to sit in the flex
                      row and push the grid right, so the cells no longer lined
                      up with the section's beats (S1: "the KSH header moves the
                      block over"). It floats on top of the grid's first cells
                      instead, which are empty on every kit. */}
                  <span
                    className="absolute"
                    style={{
                      left: 0,
                      top: 0,
                      bottom: 0,
                      display: "flex",
                      alignItems: "center",
                      zIndex: 2,
                    }}
                  >
                    <DrumLaneGlyph
                      label={DRUM_LANE_LABEL[row.lane]}
                      glyph={row.glyph}
                      muted={row.muted}
                      scale={u}
                      onToggle={(solo) =>
                        actions.toggleDrumLane(row.lane, solo ? "solo" : "mute")
                      }
                    />
                  </span>
                  {/* Where the pattern SOUNDS, when a clock moved it: the cells
                      above are the pattern you edit, this is the reading of it
                      (§P3.7), so a half-time pass does not look like a
                      song-time one. */}
                  {clockBadge !== "song time" ? (
                    <div
                      aria-hidden
                      className="pointer-events-none absolute"
                      style={{
                        left: 0,
                        right: 0,
                        bottom: -2 * u,
                        height: 2 * u,
                      }}
                    >
                      {(
                        clockedDrums.find((entry) => entry.lane === row.lane)
                          ?.cells ?? []
                      ).map((on, index, all) =>
                        on ? (
                          <span
                            key={index}
                            style={{
                              position: "absolute",
                              left: `${(index / all.length) * 100}%`,
                              width: `${100 / all.length}%`,
                              top: 0,
                              bottom: 0,
                              background: "rgb(var(--c-ink) / 0.35)",
                            }}
                          />
                        ) : null,
                      )}
                    </div>
                  ) : null}
                  {!selected ? (
                    // §S1.5: an unselected column is a picture, not an editor.
                    // One mark per HIT instead of one button per cell — a 12-bar
                    // verse is 48 cells × up to 6 rows, and nothing in it is
                    // clickable anyway.
                    <div
                      aria-hidden
                      className="relative w-full"
                      style={{
                        height: Math.max(5 * u, laneHeight("drums") * 0.11),
                      }}
                    >
                      {row.cells.map((on, index, all) =>
                        on ? (
                          <span
                            key={index}
                            style={{
                              position: "absolute",
                              left: `${(index / all.length) * 100}%`,
                              // A hit that holds is WIDER than its cell (§S1.8) —
                              // otherwise a held crash and a 16th tick are the
                              // same rectangle, which is why the drums read as a
                              // solid block.
                              width: `${
                                (100 / all.length) *
                                heldCells(row, index, node, gateDraft)
                              }%`,
                              top: 0,
                              bottom: 0,
                            }}
                          >
                            <DrumHitBar
                              ink={
                                row.silent
                                  ? `color-mix(in srgb, ${drumLaneInk(row.lane)} 30%, transparent)`
                                  : drumLaneInk(row.lane)
                              }
                              ratchet={row.authored?.[index]?.ratchet ?? 1}
                              flam={row.authored?.[index]?.flam ?? false}
                              u={u}
                            />
                          </span>
                        ) : null,
                      )}
                    </div>
                  ) : (
                    <div
                      role="group"
                      aria-label={`${DRUM_LANE_LABEL[row.lane]} steps — click a step to add or clear it${
                        clockBadge !== "song time"
                          ? ` (the pattern; this section plays it at ${clockBadge})`
                          : ""
                      }`}
                      className="flex w-full items-center"
                      // A dense grid drops the gap: 48 cells with a gap each is
                      // 47 gaps of dead space and cells you cannot see, let alone
                      // hit. Above 32 cells the colour does the separating.
                      style={{ gap: row.cells.length > 32 ? 0 : 1 * u }}
                    >
                      {row.cells.map((on, index) => (
                        <button
                          key={index}
                          type="button"
                          aria-label={`${DRUM_LANE_LABEL[row.lane]} step ${index + 1} of ${row.cells.length} — ${on ? "clear" : "add"}${feelSuffix(row.authored?.[index])}`}
                          aria-pressed={on}
                          title={`${on ? "Clear" : "Add"} ${DRUM_LANE_LABEL[row.lane].toLowerCase()} on step ${index + 1}${feelSuffix(row.authored?.[index])}${
                            row.authored?.[index]
                              ? " · ⇧-click to roll, ⌥-click to flam, right-click for more"
                              : ""
                          }${
                            clockBadge !== "song time"
                              ? ` — the pattern is played at ${clockBadge}, so this cell sounds somewhere else`
                              : ""
                          }`}
                          onClick={(event) => {
                            event.stopPropagation();
                            // The feel verbs only exist on an AUTHORED step:
                            // there is no note on a generated hit to roll.
                            if (row.authored?.[index] && event.shiftKey) {
                              actions.cycleDrumRatchet(
                                node,
                                row.lane,
                                index,
                                row.cells.length,
                              );
                              return;
                            }
                            if (row.authored?.[index] && event.altKey) {
                              actions.toggleDrumFlam(
                                node,
                                row.lane,
                                index,
                                row.cells.length,
                              );
                              return;
                            }
                            actions.toggleDrumStep(
                              node,
                              row.lane,
                              index,
                              row.cells.length,
                              !on,
                            );
                          }}
                          onDoubleClick={(event) => event.stopPropagation()}
                          onContextMenu={
                            row.authored?.[index]
                              ? (event) => {
                                  event.preventDefault();
                                  event.stopPropagation();
                                  actions.openStepMenu(
                                    node,
                                    row.lane,
                                    index,
                                    row.cells.length,
                                    event,
                                  );
                                }
                              : undefined
                          }
                          style={{
                            flex: 1,
                            position: "relative",
                            height: Math.max(5 * u, laneHeight("drums") * 0.11),
                            borderRadius: 0.5 * u,
                            border: "none",
                            padding: 0,
                            cursor: "pointer",
                            // The hit is drawn as an inner bar rather than as the
                            // button's own fill, because a gate can be LONGER than
                            // the cell it starts in (§S1.8) and only an absolutely
                            // positioned child can spill into the next one.
                            background: "rgb(0 0 0 / 0.18)",
                          }}
                        >
                          {on ? (
                            <span
                              aria-hidden
                              style={{
                                position: "absolute",
                                left: 0,
                                top: 0,
                                bottom: 0,
                                pointerEvents: "none",
                                width: `${heldCells(row, index, node, gateDraft) * 100}%`,
                              }}
                            >
                              <DrumHitBar
                                ink={
                                  row.silent
                                    ? `color-mix(in srgb, ${drumLaneInk(row.lane)} 30%, transparent)`
                                    : drumLaneInk(row.lane)
                                }
                                ratchet={row.authored?.[index]?.ratchet ?? 1}
                                flam={row.authored?.[index]?.flam ?? false}
                                u={u}
                              />
                            </span>
                          ) : null}
                          {row.authored?.[index] ? (
                            <span
                              role="separator"
                              aria-label={`Hold ${DRUM_LANE_LABEL[row.lane].toLowerCase()} step ${index + 1} — ${heldLabel(row, index, node, gateDraft)} · drag to set how long it rings`}
                              title={`Hold ${heldLabel(row, index, node, gateDraft)} — drag to change, in whole steps`}
                              onPointerDown={(event) => {
                                event.stopPropagation();
                                event.preventDefault();
                                actions.beginDrumGate(
                                  node,
                                  row.lane,
                                  index,
                                  row.cells.length,
                                  event,
                                );
                              }}
                              onDoubleClick={(event) => event.stopPropagation()}
                              style={{
                                position: "absolute",
                                right: -1 * u,
                                top: -1 * u,
                                bottom: -1 * u,
                                width: Math.max(3, 4 * u),
                                cursor: "ew-resize",
                                borderRadius: 1 * u,
                                background: "rgb(var(--c-ink) / 0.6)",
                              }}
                            />
                          ) : null}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          ) : null}

          {/* The groove, on the lane it belongs to. Only the focused column
              carries it: a pattern name on every column would be wallpaper,
              and a 44px lane has no room for wallpaper. */}
          {withLanes &&
          (variance.labels.length > 0 || (selected && groove.steppable)) ? (
            <div
              className="absolute flex items-center"
              style={{
                top: laneTop("drums") - 1 * u,
                left: 0,
                height: 11 * u,
                width: "max-content",
                gap: 1 * u,
                fontSize: 8 * u,
                lineHeight: 1,
                whiteSpace: "nowrap",
                pointerEvents: "auto",
                zIndex: 2,
              }}
            >
              {variance.labels.length > 0 ? (
                <span
                  aria-label={variance.detail}
                  title={variance.detail}
                  className="rounded-sm border border-edge bg-panel font-mono text-ink"
                  style={{ padding: `0 ${3 * u}px`, opacity: 0.9 }}
                >
                  ≠ {variance.labels.join(" · ")}
                </span>
              ) : null}
              {selected && groove.steppable ? (
                <button
                  type="button"
                  aria-label={`Groove ${groove.label} — click for the next pattern, hold or ${"⌥"}-click for the previous`}
                  title={`${groove.label} · click = busier, hold or ⌥-click = sparser`}
                  {...grooveHold.handlers}
                  onClick={(event) => {
                    event.stopPropagation();
                    if (grooveHold.suppressClick()) return;
                    actions.stepGroove(event.altKey ? -1 : 1);
                  }}
                  onDoubleClick={(event) => event.stopPropagation()}
                  className="rounded-sm border border-edge bg-panel font-mono text-ink hover:border-inkMuted"
                  style={{
                    pointerEvents: "auto",
                    cursor: "pointer",
                    padding: `0 ${3 * u}px`,
                  }}
                >
                  {groove.label}
                </button>
              ) : null}
              {clockBadge !== "song time" ? (
                // A snap fixes drift; it cannot bring back a note the clock
                // pushed past the end, so that case stays a readout.
                clockDrift.offGrid > 0 ? (
                  <button
                    type="button"
                    aria-label={`Clock ${clockBadge}: ${driftLabel(clockDrift, clockDrift.dropped)} — moves ${CLOCK_SCOPE}; click to snap to sixteenths`}
                    title={`${driftLabel(clockDrift, clockDrift.dropped)} · moves ${CLOCK_SCOPE} · click to snap the clock to sixteenths`}
                    onClick={(event) => {
                      event.stopPropagation();
                      actions.snapClock(node.sectionId);
                    }}
                    className="rounded-sm border border-edge bg-panel font-mono text-ink hover:border-inkMuted"
                    style={{
                      padding: `0 ${3 * u}px`,
                      cursor: "pointer",
                      pointerEvents: "auto",
                    }}
                  >
                    {clockBadge} · {clockDrift.offGrid}
                  </button>
                ) : (
                  <span
                    title={
                      clockDrift.dropped > 0
                        ? `Own clock: ${clockBadge} — ${driftLabel(clockDrift, clockDrift.dropped)} · moves ${CLOCK_SCOPE}`
                        : `This section runs on its own clock: ${clockBadge} · moves ${CLOCK_SCOPE}`
                    }
                    className="rounded-sm border border-edge bg-panel font-mono text-ink"
                    style={{ padding: `0 ${3 * u}px`, opacity: 0.9 }}
                  >
                    {clockBadge}
                    {clockDrift.dropped > 0
                      ? ` · ${clockDrift.dropped} lost`
                      : ""}
                  </span>
                )
              ) : null}
              {groove.variants > 1 ? (
                <button
                  type="button"
                  aria-label={`Variant ${groove.variant + 1} of ${groove.variants} — click for the next, hold for the previous`}
                  title={`variant ${groove.variant + 1}/${groove.variants} · hold or ⌥-click for the previous`}
                  {...variantHold.handlers}
                  onClick={(event) => {
                    event.stopPropagation();
                    if (variantHold.suppressClick()) return;
                    actions.stepVariant(event.altKey ? -1 : 1);
                  }}
                  onDoubleClick={(event) => event.stopPropagation()}
                  className="rounded-sm border border-edge bg-panel font-mono text-inkMuted hover:text-ink"
                  style={{
                    pointerEvents: "auto",
                    cursor: "pointer",
                    padding: `0 ${3 * u}px`,
                  }}
                >
                  v{groove.variant + 1}
                </button>
              ) : null}
            </div>
          ) : null}

          {/* Chords ------------------------------------------------------ */}
          {chords.length > 0 ? (
            <div
              className="absolute flex overflow-hidden rounded-sm"
              style={{
                top:
                  laneTop("chords") +
                  (laneHeight("chords") -
                    Math.min(laneHeight("chords") - 16 * u, 36 * u)) /
                    2,
                height: Math.min(laneHeight("chords") - 16 * u, 36 * u),
                left: 0,
                right: 0,
                borderTop: `${1 * u}px solid rgb(var(--c-edge))`,
                borderBottom: `${1 * u}px solid rgb(var(--c-edge))`,
              }}
            >
              {chords.map((cell, cellIndex) => {
                const screenWidth = (cell.share * node.w) / u;
                // A lap of the progression repeats the SAME chord, so only the
                // first cell of a chord hosts the editor — one definition, one
                // box, even though every lap shows the result.
                return (
                  <span
                    key={cell.id}
                    title={
                      cell.chordId
                        ? `${cell.roman} — ${cell.name} · double-click to retype`
                        : `${cell.roman} — ${cell.name}`
                    }
                    onPointerDown={(event) => {
                      if (!cell.chordId || event.button !== 0 || event.altKey)
                        return;
                      const row = event.currentTarget.parentElement;
                      if (!row) return;
                      const centres = [...row.children]
                        .map((child) => child.getAttribute("data-chord-id"))
                        .map((id, index) =>
                          id
                            ? {
                                chordId: id,
                                centreX:
                                  row.children[index].getBoundingClientRect()
                                    .left +
                                  row.children[index].getBoundingClientRect()
                                    .width /
                                    2,
                              }
                            : null,
                        )
                        .filter(
                          (
                            entry,
                          ): entry is { chordId: string; centreX: number } =>
                            Boolean(entry),
                        );
                      actions.beginChordMove(
                        node,
                        cell.chordId,
                        centres,
                        event,
                      );
                    }}
                    data-chord-id={cell.chordId || undefined}
                    onClick={(event) => {
                      if (!cell.chordId) return;
                      event.stopPropagation();
                      actions.pickChord(node, cell.chordId);
                    }}
                    onDoubleClick={(event) => {
                      if (!cell.chordId) return;
                      event.stopPropagation();
                      actions.beginChordEdit(node, cell.chordId);
                    }}
                    onContextMenu={(event) => {
                      // §S1: the harmony view can re-quality, invert and delete
                      // a chord; the canvas could only retype one.
                      if (!cell.chordId) return;
                      event.preventDefault();
                      event.stopPropagation();
                      actions.openChordMenu(node, cell.chordId, event);
                    }}
                    className="flex items-center justify-center overflow-hidden truncate font-mono"
                    style={{
                      flexGrow: cell.share,
                      flexBasis: 0,
                      minWidth: 1 * u,
                      fontSize: 11 * u,
                      color: cell.merged
                        ? "rgb(var(--c-inkMuted))"
                        : "rgb(var(--c-ink))",
                      background: cell.seam ? `${role.bg}3a` : "transparent",
                      borderLeft: `${1 * u}px solid ${
                        cell.seam
                          ? "rgb(var(--c-accent) / 0.45)"
                          : "rgb(var(--c-edge))"
                      }`,
                      paddingLeft: 2 * u,
                      paddingRight: 2 * u,
                      pointerEvents: cell.chordId ? "auto" : "none",
                      cursor: cell.chordId ? "pointer" : "default",
                      position: "relative",
                    }}
                  >
                    {editingChordId === cell.chordId &&
                    cell.chordId &&
                    chords.findIndex(
                      (entry) => entry.chordId === cell.chordId,
                    ) === cellIndex ? (
                      <input
                        ref={chordRef}
                        defaultValue={cell.roman}
                        aria-label={`Retype ${cell.roman}, ${cell.name}`}
                        onClick={(event) => event.stopPropagation()}
                        onDoubleClick={(event) => event.stopPropagation()}
                        onKeyDown={(event) => {
                          event.stopPropagation();
                          if (event.key === "Enter") {
                            actions.commitChordEdit(
                              node,
                              cell.chordId,
                              event.currentTarget.value,
                            );
                          } else if (event.key === "Escape") {
                            actions.cancelChordEdit();
                          }
                        }}
                        onBlur={(event) => {
                          if (!chordFocused.current) return;
                          chordFocused.current = false;
                          const text = event.currentTarget.value;
                          if (text.trim() === cell.roman)
                            actions.cancelChordEdit();
                          else
                            actions.commitChordEdit(node, cell.chordId, text);
                        }}
                        className="w-full min-w-0 bg-canvas text-center text-ink outline-none"
                        style={{
                          fontSize: 10 * u,
                          lineHeight: 1.2,
                          pointerEvents: "auto",
                        }}
                      />
                    ) : screenWidth >= 20 ? (
                      chordLabels === "letter" ? (
                        cell.name
                      ) : (
                        cell.roman
                      )
                    ) : (
                      ""
                    )}
                    {cell.chordId && screenWidth >= 16 ? (
                      <span
                        role="separator"
                        aria-label={`Re-time ${cell.roman} — drag to change how long it lasts`}
                        onPointerDown={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          actions.beginChordResize(node, cell.chordId, event);
                        }}
                        onDoubleClick={(event) => event.stopPropagation()}
                        style={{
                          position: "absolute",
                          top: 0,
                          bottom: 0,
                          right: -3 * u,
                          width: 6 * u,
                          cursor: "ew-resize",
                          pointerEvents: "auto",
                        }}
                      />
                    ) : null}
                  </span>
                );
              })}
            </div>
          ) : null}

          {/* Colour ------------------------------------------------------ */}
          {color.length > 0 ? (
            <div
              className="absolute"
              style={{
                top: laneTop("color"),
                height: laneHeight("color"),
                left: 0,
                right: 0,
              }}
            >
              {color.map((note, index) => {
                const screenWidth = (note.w * node.w) / u;
                return (
                  <span
                    key={index}
                    title={`${note.name ?? note.label} — colour`}
                    className="absolute flex items-center overflow-hidden"
                    style={{
                      left: `${note.x * 100}%`,
                      width: `calc(${note.w * 100}% - ${3 * u}px)`,
                      top: laneHeight("color") * 0.28,
                      height: laneHeight("color") * 0.44,
                      background: "rgb(var(--c-accent) / 0.16)",
                      borderTop: `${1 * u}px solid rgb(var(--c-accent) / 0.55)`,
                      borderLeft: `${1 * u}px solid rgb(var(--c-accent) / 0.35)`,
                      paddingLeft: 2 * u,
                      fontSize: 8 * u,
                      color: "rgb(var(--c-accent))",
                    }}
                  >
                    {screenWidth >= 26 ? (note.name ?? "") : ""}
                  </span>
                );
              })}
            </div>
          ) : null}

          {/* Melody ------------------------------------------------------
              Real note bars, not a contour sketch: the lane is the thing you
              drag, so it has to be the thing that is true. The line through
              them is only the contour the phrase makes. */}
          {melody ? (
            <div
              className="absolute"
              data-poly-melody={node.sectionId}
              onDoubleClick={(event) => {
                event.stopPropagation();
                const box = event.currentTarget.getBoundingClientRect();
                if (box.width <= 0 || box.height <= 0) return;
                actions.addNote(node, {
                  x: (event.clientX - box.left) / box.width,
                  y: (event.clientY - box.top) / box.height,
                });
              }}
              onClick={() => actions.select(node)}
              style={{
                top: laneTop("melody"),
                height: laneHeight("melody"),
                left: 0,
                right: 0,
                // The lane is a place to click, not just a backdrop: this is
                // where a phrase gets started on a section that has none.
                pointerEvents: "auto",
              }}
            >
              <NoteGhosts frame={melody} u={u} />
              {melody.notes.length > 1 ? (
                <svg
                  aria-hidden
                  className="absolute inset-0 h-full w-full"
                  viewBox="0 0 100 100"
                  preserveAspectRatio="none"
                >
                  <polyline
                    points={melody.notes
                      .map(
                        (note) =>
                          `${(note.x + note.w / 2) * 100},${note.y * 100}`,
                      )
                      .join(" ")}
                    fill="none"
                    stroke="rgb(var(--c-inkMuted))"
                    strokeWidth={1}
                    strokeLinejoin="round"
                    vectorEffect="non-scaling-stroke"
                    opacity={0.35}
                  />
                </svg>
              ) : null}
              {melody.notes.map((note) => {
                const held = selectedNote === note.index;
                return (
                  <button
                    key={note.index}
                    type="button"
                    data-poly-note={note.index}
                    aria-label={`Melody note ${note.index + 1}, pitch ${note.pitch}, beat ${round(note.startTime)}`}
                    title={`Pitch ${note.pitch} · ${round(note.duration)} beat(s) · drag to move`}
                    onPointerDown={(event) => {
                      if (event.button !== 0 || event.altKey) return;
                      event.stopPropagation();
                      event.preventDefault();
                      actions.beginNote(node, note.index, event);
                    }}
                    onDoubleClick={(event) => event.stopPropagation()}
                    style={{
                      position: "absolute",
                      left: `${note.x * 100}%`,
                      width: `max(${6 * u}px, ${note.w * 100}%)`,
                      top: `calc(${note.y * 100}% - ${3 * u}px)`,
                      height: 6 * u,
                      borderRadius: 1.5 * u,
                      border: held
                        ? `${1.5 * u}px solid rgb(var(--c-accent))`
                        : "none",
                      background: held
                        ? "rgb(var(--c-accent))"
                        : "rgb(var(--c-ink) / 0.75)",
                      pointerEvents: "auto",
                      cursor: "ns-resize",
                    }}
                  />
                );
              })}
              {melody.notes.map((note) => (
                <span
                  key={`len-${note.index}`}
                  role="separator"
                  aria-label={`Lengthen or shorten melody note ${note.index + 1}`}
                  title="Drag to change how long this note lasts"
                  onPointerDown={(event) => {
                    if (event.button !== 0 || event.altKey) return;
                    event.stopPropagation();
                    event.preventDefault();
                    actions.beginNote(
                      node,
                      note.index,
                      event,
                      "melody",
                      "resize",
                    );
                  }}
                  onDoubleClick={(event) => event.stopPropagation()}
                  style={{
                    position: "absolute",
                    left: `calc(${(note.x + note.w) * 100}% - ${3 * u}px)`,
                    width: 6 * u,
                    top: `calc(${note.y * 100}% - ${4 * u}px)`,
                    height: 8 * u,
                    cursor: "ew-resize",
                    pointerEvents: "auto",
                  }}
                />
              ))}
            </div>
          ) : null}

          {/* The spine band — identity, and the handle. */}
          <div
            className="absolute flex items-center justify-center overflow-hidden"
            style={{
              top: spineTop,
              height: POLY_SPINE_H,
              left: 0,
              right: 0,
              borderRadius: 2 * u,
              background: role.bg,
              color: role.text,
              paddingLeft: 5 * u,
              paddingRight: 4 * u,
              gap: 6 * u,
              border: `${1 * u}px solid ${selected ? "rgb(var(--c-accent))" : "rgb(var(--c-edge) / 0.8)"}`,
              boxShadow: selected
                ? `inset 0 0 0 ${1.5 * u}px rgb(var(--c-accent) / 0.85)`
                : hovered
                  ? `inset 0 0 0 ${1 * u}px rgb(var(--c-ink) / 0.22)`
                  : undefined,
            }}
          >
            {lod === "compact" ? null : (
              <>
                {editingName ? (
                  <input
                    autoFocus
                    defaultValue={node.name}
                    aria-label={`Rename ${node.name}`}
                    onClick={(event) => event.stopPropagation()}
                    onPointerDown={(event) => event.stopPropagation()}
                    onKeyDown={(event) => {
                      event.stopPropagation();
                      if (event.key === "Enter")
                        actions.rename(node, event.currentTarget.value);
                      else if (event.key === "Escape") actions.cancelRename();
                    }}
                    onBlur={(event) =>
                      actions.rename(node, event.currentTarget.value)
                    }
                    className="min-w-0 flex-1 rounded-sm bg-canvas px-1 text-ink outline-none"
                    style={{
                      fontSize: 11 * u,
                      lineHeight: 1.2,
                      pointerEvents: "auto",
                    }}
                  />
                ) : (
                  <span
                    className="truncate font-medium"
                    style={{ fontSize: 11 * u, lineHeight: 1 }}
                  >
                    {node.name}
                  </span>
                )}
                <span
                  className="shrink-0 font-mono"
                  style={{ fontSize: 8 * u, lineHeight: 1, opacity: 0.75 }}
                >
                  #{node.ordinal}
                </span>
                {deep ? (
                  <span
                    className="shrink-0 font-mono"
                    style={{ fontSize: 8 * u, opacity: 0.8 }}
                  >
                    {summary}
                  </span>
                ) : null}
                {/* Only when it is news: a section in another key, or one that
                    modulates inside itself. The numerals already follow it.
                    Shown from `full` up, not just at `detail`: the standard
                    view is exactly where you need to notice it. */}
                {tonalityBadge ? (
                  <span
                    className="shrink-0 rounded border font-mono"
                    style={{
                      fontSize: 8 * u,
                      lineHeight: 1.2,
                      padding: `0 ${2 * u}px`,
                      // `currentColor` is the band's own ink: the spine band is
                      // painted in the role colour, so an accent-coloured badge
                      // here would be invisible on most roles.
                      borderColor: "currentColor",
                      opacity: 0.8,
                    }}
                    title={tonalityBadge.title}
                  >
                    {tonalityBadge.label}
                  </span>
                ) : null}
                {modulationTicks.map((mark) => (
                  <span
                    key={`${mark.bar}-${mark.key}`}
                    title={mark.title}
                    aria-hidden
                    className="absolute border-l border-dashed"
                    style={{
                      left: mark.at * node.w,
                      top: 0,
                      bottom: 0,
                      borderColor: "currentColor",
                      opacity: 0.55,
                    }}
                  >
                    <span
                      className="absolute font-mono"
                      style={{
                        left: 1 * u,
                        top: 1 * u,
                        fontSize: 7 * u,
                        lineHeight: 1,
                        opacity: 0.9,
                      }}
                    >
                      {mark.label}
                    </span>
                  </span>
                ))}
              </>
            )}
          </div>

          {/* The resize handle sits in the gap at the column's right edge. */}
          <div
            role="separator"
            aria-label={`Resize ${node.name} — drag left or right to change its bars`}
            onPointerDown={(event) => {
              event.preventDefault();
              event.stopPropagation();
              actions.beginResize(node, event);
            }}
            style={{
              position: "absolute",
              top: spineTop,
              height: POLY_SPINE_H,
              right: -6 * u,
              width: 12 * u,
              pointerEvents: "auto",
              cursor: "ew-resize",
            }}
          />

          {/* Below the full face the band is only a few pixels tall, so the
              name sits just under it — a section must never be anonymous at a
              zoom the user actually works at. */}
          {lod === "compact" ? (
            <div
              className="absolute truncate text-center font-medium"
              style={{
                top: spineTop + POLY_SPINE_H + 3 * u,
                left: 2 * u,
                right: 2 * u,
                fontSize: 11 * u,
                lineHeight: 1.2,
                color: selected
                  ? "rgb(var(--c-accent))"
                  : "rgb(var(--c-inkMuted))",
              }}
            >
              {node.name}
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

/**
 * A drum lane's glyph: click mutes, click-again unmutes, and a HOLD solos —
 * the same action `⌥`-click performs, for pointers that have no option key.
 */
function DrumLaneGlyph({
  label,
  glyph,
  muted,
  scale,
  onToggle,
}: {
  label: string;
  glyph: string;
  muted: boolean;
  scale: number;
  onToggle: (solo: boolean) => void;
}) {
  const hold = useLongPress(() => onToggle(true), { delay: LONG_PRESS_MS });
  return (
    <button
      type="button"
      aria-label={`${label} — click to ${muted ? "unmute" : "mute"}, hold to solo`}
      aria-pressed={muted}
      title={`${label} · click to ${muted ? "unmute" : "mute"} · hold to solo`}
      {...hold.handlers}
      onClick={(event) => {
        event.stopPropagation();
        if (hold.suppressClick()) return;
        onToggle(event.altKey);
      }}
      onDoubleClick={(event) => event.stopPropagation()}
      className="shrink-0 font-mono text-inkMuted"
      style={{
        width: 10 * scale,
        fontSize: 6 * scale,
        opacity: 0.75,
        lineHeight: 1,
        background: "none",
        border: "none",
        padding: 0,
        cursor: "pointer",
        textDecoration: muted ? "line-through" : undefined,
      }}
    >
      {glyph}
    </button>
  );
}

export default memo(PolyColumn);
