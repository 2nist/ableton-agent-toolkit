import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { useParams } from "react-router-dom";
import type { DrumLaneId } from "@drum/library";
import type { NoteName, ScaleType } from "@music-theory/core";
import { KEY_ROOTS } from "@music-theory/core";
import { SCALES } from "../../lib/scales";
import {
  beatsPerBar,
  sectionDurationBeats,
  type BlueprintSection,
  type BlueprintSong,
  type Chord,
  type DrumBlock,
  type DrumLaneKey,
  type MelodyNote,
  type SectionOverride,
  type TimeDomain,
} from "../../types/blueprint";
import BassSettings from "../harmony/BassSettings";
import {
  STEP_MENU_HOLDS,
  STEP_MENU_PROBS,
  STEP_MENU_RATCHETS,
  stepMenuTitle,
  withStepFlam,
  withStepGate,
  withStepProbability,
  withStepRatchet,
  withoutStep,
} from "../../lib/poly/drumStepMenu";
import {
  MIN_DRUM_GATE,
  authoredSteps,
  drumStepWindow,
  nextRatchet,
  paintedStep,
  patchPaintedStep,
  setDrumStepGate,
  toggleDrumStep as toggleDrumStepBlocks,
} from "../../lib/poly/drumSteps";
import { useGlobalKeys, KEY_PRIORITY } from "../../hooks/useGlobalKeys";
import { usePlayheadFrames } from "../../hooks/usePlayhead";
import { sectionSpans } from "../../lib/arrangement";
import { moveChord, retypeChord } from "../../lib/poly/chords";
import { DRUM_LANE_LABEL } from "../../lib/poly/drums";
import { polyDrumPattern } from "../../lib/poly/content";
import {
  materialCables,
  type MaterialCable,
  sectionMaterial,
} from "../../lib/poly/materialGraph";
import {
  seamCables,
  seamsAround,
  type SeamCable,
} from "../../lib/poly/seamGraph";
import { frameAround, frameLabel, nodesInFrame } from "../../lib/poly/frames";
import {
  PLACEMENT_THRESHOLD,
  clampPlacement,
  isPlaced,
  placedRect,
  resolvePlacement,
  snapPlacement,
  tetherLine,
  type PolyPlacement,
} from "../../lib/poly/placements";
import {
  grooveChip,
  groovePatchFor,
  nextVelocity,
  stepGroove as stepGrooveChoice,
  stepVariant as stepVariantChoice,
  velocityHint,
} from "../../lib/poly/drums";
import {
  applyGrooveChoice,
  type GrooveChoice,
} from "../../lib/drums/grooveModel";
import {
  beatGrid,
  insertNote,
  moveNote,
  polyNoteFrame,
  quantise,
  removeNote,
  withNotes,
  type PolyNoteFrame,
} from "../../lib/poly/melody";
import {
  addSection,
  clearPassOverride,
  copySectionTo,
  duplicateSection,
  insertSection,
  mergeWithNext,
  passOverrideFor,
  splitSectionAtBar,
  removeSection,
  reorderSections,
  removePass,
  repeatPassLike,
  repeatsFor,
  setPassOverride,
  updateRepeats,
  updateSection,
} from "../../lib/sections";
import { askConfirm } from "../../lib/confirm";
import { chordDisplayName } from "../../lib/harmony/chordBuilder";
import { laneEditorPath, laneEditorTitle } from "../../lib/poly/laneEditor";
import { polySongSlice, type PolySongSlice } from "../../lib/poly/songSlice";
import {
  chordLengthFromDrag,
  DEFAULT_STEPS_PER_BAR,
  GRID_LABEL,
  gridUnit,
  nextGrid,
  resizeNote,
} from "../../lib/poly/grid";
import { pitchClass } from "@music-theory/core";
import {
  CHORD_INVERSIONS,
  CHORD_MENU_QUALITIES,
  QUALITY_LABEL,
  chordById,
  withChordInversion,
  withChordQuality,
  withoutChord,
} from "../../lib/poly/chordMenu";
import {
  DEFAULT_CAMERA,
  STANDARD_ZOOM,
  ZOOM_STEP,
  centreOn,
  clampToWorld,
  fitRect,
  panByPixels,
  screenToWorld,
  visibleWorldRect,
  worldToScreen,
  zoomAt,
  type PolyCamera,
  type PolyViewport,
} from "../../lib/poly/camera";
import {
  POLY_LANES,
  POLY_GUTTER_W,
  POLY_SPINE_H,
  arrangeSections,
  laneGeometry,
  nodesInView,
  resizeToBars,
  worldBounds,
  type PolyLaneId,
  type PolyNode,
} from "../../lib/poly/layout";
import { useRoleStyle } from "../../lib/roleColors";
import { useFocusedSectionStore } from "../../store/focusedSectionStore";
import {
  useInspectorStore,
  type InspectorTab,
} from "../../store/inspectorStore";
import { useHarmonySelectionStore } from "../../store/harmonySelectionStore";
import { usePolyStore } from "../../store/polyStore";
import { useSongStore } from "../../store/songStore";
import { LOD_TIERS, stickyLodIndex } from "../../lib/poly/lod";
import { sectionMenuState } from "../../lib/poly/sectionMenu";
import {
  clockScopeHint,
  nextClock,
  nextLoop,
  previousClock,
} from "../../lib/poly/drums";
import { normaliseTimeDomain, toLocalBeats } from "@drum/library";
import {
  withSectionTonality,
  type TonalityPatch,
} from "../../lib/poly/tonality";
import PolyMinimap from "./PolyMinimap";
import PolySpanRuler, { POLY_RULER_H } from "./PolySpanRuler";
import PolyShelfStrip, {
  POLY_SHELF_H,
  type PolyShelfItem,
} from "./PolyShelfStrip";
import PolyClockChip from "./PolyClockChip";
import type { SectionRole } from "../../types/blueprint";
import PolyColumn, {
  type PolyColumnActions,
  type PolyNoteLane,
} from "./PolyColumn";
import {
  bassFrameFor,
  bassNotesFor,
  clearBassNotes,
  withBassNotes,
} from "../../lib/poly/bass";

/** Clicking a lane opens that element's tools. Melody and bass have no
 *  inspector facet: melody is edited in place, and the bass lane brings its own
 *  chips (see `pickLane`). Both still select, so the lane points at the right
 *  section. */
/** One row of the section menu: a name, an optional key hint, an optional
 *  danger tint. Small enough to keep the menu a list of words. */ function MenuItem({
  label,
  hint = "",
  disabled = false,
  danger = false,
  onClick,
}: {
  label: string;
  hint?: string;
  disabled?: boolean;
  danger?: boolean;
  /** The event is passed through so a row can read ⌥ — the clock row uses it to
   *  step backwards, the same idiom as the groove and variant chips (§g9). */
  onClick: (event: React.MouseEvent<HTMLButtonElement>) => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`flex w-full items-center gap-2 px-2 py-1 text-left text-[11px] enabled:hover:bg-panelAlt/70 disabled:opacity-35 ${
        danger ? "text-inkMuted enabled:hover:text-ink" : "text-ink"
      }`}
    >
      <span className="flex-1">{label}</span>
      {hint ? (
        <span className="font-mono text-[9px] text-inkMuted/60">{hint}</span>
      ) : null}
    </button>
  );
}

/** A stable empty list, so a song with an empty shelf does not re-render. */
const EMPTY_PARKED: string[] = [];

/** The section menu's box. Measured roughly so it can be kept inside the stage
 *  without waiting a frame for its real height. */
const POLY_MENU_W = 240;
const POLY_MENU_H = 268;

const ROLE_OPTIONS: { role: SectionRole }[] = (
  [
    "intro",
    "verse",
    "pre_chorus",
    "chorus",
    "bridge",
    "solo",
    "breakdown",
    "outro",
    "custom",
  ] as SectionRole[]
).map((role) => ({ role }));

const LANE_FACET: Record<PolyLaneId, InspectorTab | null> = {
  chords: "harmony",
  // The bass lane brings its own four chips onto the canvas, so opening the
  // Inspector as well would put two copies of the same controls on screen —
  // and, at the standard view, the Inspector covers the lane it just opened.
  bass: null,
  color: "mix",
  drums: "drums",
  lyric: "lyrics",
  melody: null,
};

/**
 * The Poly canvas — P0/P1: a spatial projection of `sectionSpans()` that can
 * now be edited in place (rename, resize, add, delete) through the same
 * store actions the workbench uses.
 *
 * It writes NOTHING to the song. Every edit still belongs to the existing
 * editors, so this surface cannot corrupt a library and can be deleted by
 * removing one route and one folder.
 *
 * Layout grammar: the shell supplies the Ribbon (top), views (left) and
 * Inspector (right) on every song route, so this component is the CENTRE
 * pane only — which is why it is a new surface rather than a copy of
 * `WorkbenchView`.
 */
export default function PolyView() {
  const { songId: routeSongId } = useParams<{ songId: string }>();
  const song = useSongStore((s) => s.currentSong());
  const focusedId = useFocusedSectionStore((s) => s.selectedSectionId);
  const focusedPass = useFocusedSectionStore((s) => s.focusedPass);
  const setFocusedPass = useFocusedSectionStore((s) => s.setFocusedPass);
  const setFocused = useFocusedSectionStore((s) => s.setSelectedSectionId);
  const setCamera = usePolyStore((s) => s.setCamera);
  const prefs = usePolyStore((s) => s.prefs);
  const cameraKey = song?.id ?? routeSongId;
  const camera = usePolyStore(
    (s) => (cameraKey ? s.cameras[cameraKey] : undefined) ?? DEFAULT_CAMERA,
  );
  const hasSavedCamera = usePolyStore((s) =>
    Boolean(cameraKey && s.cameras[cameraKey]),
  );
  const stage = usePolyStore((s) =>
    cameraKey ? s.stage[cameraKey] : undefined,
  );
  const placements = useMemo(() => stage ?? {}, [stage]);
  const parkedKeys = usePolyStore((s) =>
    cameraKey ? (s.parked[cameraKey] ?? EMPTY_PARKED) : EMPTY_PARKED,
  );
  const frames = usePolyStore((s) =>
    cameraKey ? s.frames[cameraKey] : undefined,
  );
  const songFrames = useMemo(() => frames ?? [], [frames]);

  const placementsRef = useRef(placements);
  placementsRef.current = placements;

  const updateCurrentSong = useSongStore((s) => s.updateCurrentSong);

  // A resize in flight is a DRAFT: the layout re-derives from it every frame
  // and one history step lands on release (the spine's own gesture rule).
  const [resizeDraft, setResizeDraft] = useState<{
    sectionId: string;
    bars: number;
  } | null>(null);
  const resizeDraftRef = useRef<{ sectionId: string; bars: number } | null>(
    null,
  );
  resizeDraftRef.current = resizeDraft;
  const resizeRef = useRef<{
    pointerId: number;
    sectionId: string;
    startX: number;
    startBars: number;
  } | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const editingRef = useRef<string | null>(null);

  const [lyricEditingId, setLyricEditingId] = useState<string | null>(null);
  const lyricRef = useRef<string | null>(null);

  const [moveDraft, setMoveDraft] = useState<{
    from: number;
    to: number;
    /** ⌥-drag: drop a COPY here instead of moving the section. */
    copy: boolean;
    /** The section a copy would be made from — the preview needs it. */
    sectionId: string;
  } | null>(null);
  // The ref is written synchronously by the drag handler: a release landing in
  // the same frame as the last move would otherwise read the previous draft.
  const moveDraftRef = useRef<{
    from: number;
    to: number;
    copy: boolean;
    /** Needed by the copy preview: a copy is made FROM this section. */
    sectionId: string;
  } | null>(null);
  const moveRef = useRef<{
    pointerId: number;
    sectionId: string;
    key: string;
    liftAll: boolean;
    /** ⌥ held at the press: this drag places a copy, it does not move. */
    copy: boolean;
    startPlacement: PolyPlacement | undefined;
    from: number;
    startX: number;
    startY: number;
    /** Undecided until the pointer says which axis the gesture is about. */
    mode: "undecided" | "reorder" | "place";
    active: boolean;
    columns: { sectionIndex: number; centreX: number }[];
  } | null>(null);

  // Melody: `noteHeld` is the selection (and the drag target), `noteDraft` is
  // the in-flight edit — the lane re-derives from it every frame and one
  // history step lands on release, exactly like a resize.
  const [noteHeld, setNoteHeld] = useState<{
    sectionId: string;
    index: number;
    lane: PolyNoteLane;
  } | null>(null);
  const [noteDraft, setNoteDraft] = useState<{
    sectionId: string;
    notes: MelodyNote[];
    lane: PolyNoteLane;
  } | null>(null);
  const noteDraftRef = useRef<{
    sectionId: string;
    notes: MelodyNote[];
    lane: PolyNoteLane;
  } | null>(null);
  const noteRef = useRef<{
    pointerId: number;
    sectionId: string;
    lane: PolyNoteLane;
    index: number;
    startX: number;
    startY: number;
    base: MelodyNote[];
    frame: PolyNoteFrame;
    pxPerBeat: number;
    pxPerSemitone: number;
    grid: number;
    /** True when the gesture is the note's RIGHT EDGE — a length, not a move
     *  (§S2.1). One pointer path, two meanings, decided at `beginNote`. */
    resizing: boolean;
    active: boolean;
  } | null>(null);

  // A placement in flight: the node is drawn at its offset while you drag, and
  // only the store is written on release (never the song).
  const [placementDraft, setPlacementDraft] = useState<{
    key: string;
    dx: number;
    dy: number;
  } | null>(null);
  const placementDraftRef = useRef<{
    key: string;
    dx: number;
    dy: number;
  } | null>(null);

  // A drum gate in flight (§S1.8): the cell's bar is drawn from the draft and
  // the store is written once, on release.
  const [gateDraft, setGateDraft] = useState<{
    lane: DrumLaneId;
    index: number;
    beats: number;
  } | null>(null);
  const gateDraftRef = useRef<{
    lane: DrumLaneId;
    index: number;
    beats: number;
  } | null>(null);
  const gateRef = useRef<{
    pointerId: number;
    sectionId: string;
    lane: DrumLaneId;
    index: number;
    startX: number;
    /** Beats per cell — the gate snaps in whole steps, because the cells ARE
     *  the drum grid the user is counting. */
    cellBeats: number;
    startBeats: number;
    window: { startBeat: number; endBeat: number };
    durationBeats: number;
    active: boolean;
  } | null>(null);

  const [chordEditingId, setChordEditingId] = useState<string | null>(null);
  // Dragging a chord cell's right edge re-times the harmonic rhythm: a draft
  // re-derives the layout every frame, one history step on release.
  const [chordDraft, setChordDraft] = useState<{
    sectionId: string;
    chordId: string;
    beats: number;
  } | null>(null);
  const chordDraftRef = useRef<{
    sectionId: string;
    chordId: string;
    beats: number;
  } | null>(null);
  const [chordMoveDraft, setChordMoveDraft] = useState<{
    sectionId: string;
    chords: Chord[];
  } | null>(null);
  const chordMoveDraftRef = useRef<{
    sectionId: string;
    chords: Chord[];
  } | null>(null);
  const chordMoveRef = useRef<{
    pointerId: number;
    sectionId: string;
    chordId: string;
    startX: number;
    active: boolean;
    base: Chord[];
    chords: Chord[];
    centres: { chordId: string; centreX: number }[];
  } | null>(null);
  /** The pass the user last touched — see `select`. */
  const lastNodeKeyRef = useRef<string | null>(null);

  /** The one node the section verbs act on: the focused PASS, not the first
   *  node that happens to share its section id (§P4.2). */
  const passNode = useCallback((): PolyNode | null => {
    const nodes = layoutRef.current.nodes;
    return (
      nodes.find(
        (node) =>
          node.sectionId === focusedId && node.occurrenceIndex === focusedPass,
      ) ??
      nodes.find((node) => node.sectionId === focusedId) ??
      null
    );
  }, [focusedId, focusedPass]);

  const chordResizeRef = useRef<{
    pointerId: number;
    sectionId: string;
    chordId: string;
    startX: number;
    startBeats: number;
    /** The section's clock when the drag began: the cell is drawn conducted,
     *  so the delta the pointer measures is in song beats. */
    clock: ReturnType<typeof normaliseTimeDomain>;
    /** The grid rung the drag started on (§S2.1), in local beats. */
    unit: number;
    pxPerBeat: number;
  } | null>(null);

  /** The snap rung, in steps per bar (§S2.1). A view preference, not a song
   *  field: it changes what a drag rounds to, never what is stored. Defaults to a
   *  beat, which is what every lane counted in before it existed. */
  const [stepsPerBar, setStepsPerBar] = useState(DEFAULT_STEPS_PER_BAR);

  /** Show the material wires (§P2.1) — the couplings a section already has.
   *  Off by default: it is a reading tool, not decoration. */
  const [showWires, setShowWires] = useState(false);

  /** A painted drum step's right-click menu (§S1.10) — hold, ratchet, flam,
   *  probability and clear. Probability needs a home that is not a modifier. */
  const [stepMenu, setStepMenu] = useState<{
    sectionId: string;
    lane: DrumLaneId;
    index: number;
    columns: number;
    x: number;
    y: number;
  } | null>(null);

  /** A chord's right-click menu (§S1) — the harmony view's verbs, on the canvas. */
  const [chordMenu, setChordMenu] = useState<{
    sectionId: string;
    chordId: string;
    x: number;
    y: number;
  } | null>(null);

  const [menu, setMenu] = useState<{
    sectionId: string;
    /** Which PASS of it (§P4.1). A section that plays three times is three
     *  nodes with one id, so the id alone cannot say which one was clicked. */
    nodeKey: string;
    x: number;
    y: number;
    /** The verbs list, or the section's tonality picker. One panel, two faces:
     *  a second floating box beside the first is a second thing to dismiss. */
    view: "verbs" | "tonality";
  } | null>(null);

  const effectiveSong = useMemo(() => {
    if (!song) return song;
    if (resizeDraft) {
      return updateSection(song, resizeDraft.sectionId, (section) => ({
        ...section,
        bars: resizeDraft.bars,
      }));
    }
    if (moveDraft) {
      return moveDraft.copy
        ? copySectionTo(song, moveDraft.sectionId, moveDraft.to)
        : reorderSections(song, moveDraft.from, moveDraft.to);
    }
    if (noteDraft) {
      return updateSection(song, noteDraft.sectionId, (section) =>
        noteDraft.lane === "bass"
          ? withBassNotes(section, noteDraft.notes)
          : withNotes(section, noteDraft.notes),
      );
    }
    if (chordMoveDraft) {
      return updateSection(song, chordMoveDraft.sectionId, (section) => ({
        ...section,
        chords: chordMoveDraft.chords,
      }));
    }
    if (chordDraft) {
      return updateSection(song, chordDraft.sectionId, (section) => ({
        ...section,
        chords: section.chords.map((chord) =>
          chord.id === chordDraft.chordId
            ? { ...chord, beats: chordDraft.beats }
            : chord,
        ),
      }));
    }
    return song;
  }, [song, resizeDraft, moveDraft, noteDraft, chordDraft, chordMoveDraft]);

  const spans = useMemo(
    () => (effectiveSong ? sectionSpans(effectiveSong) : []),
    [effectiveSong],
  );
  const layout = useMemo(
    () =>
      arrangeSections(spans, {
        bpm: effectiveSong?.bpm,
        // The chord numerals are already read in the section's own key
        // (`polyChords`); this is what lets the column say so.
        key: effectiveSong?.key,
        scale: effectiveSong?.scale,
      }),
    [spans, effectiveSong?.bpm, effectiveSong?.key, effectiveSong?.scale],
  );
  /** The section each node draws — a span carries the overrides already
   *  applied, so the canvas shows the pass as it will sound. */
  /** The eight song-level fields the columns read (§S1.6). Memoised on the
   *  fields themselves, so editing a SECTION does not invalidate it — which is
   *  what makes the per-column `memo` actually hit. */
  const songSlice = useMemo(
    () =>
      song
        ? polySongSlice(song)
        : ({
            key: "C",
            scale: "ionian",
            bpm: 120,
            title: "",
            concept: undefined,
            notes: undefined,
            bend: undefined,
            genre: undefined,
          } as PolySongSlice),
    // The fields, not the song: `POLY_SONG_SLICE_FIELDS` is the list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      song?.key,
      song?.scale,
      song?.bpm,
      song?.title,
      song?.concept,
      song?.notes,
      song?.bend,
      song?.genre,
    ],
  );

  const sectionByKey = useMemo(
    () =>
      new Map(
        spans.map((span) => [
          `${span.sectionId}#${span.occurrenceIndex}`,
          span.section,
        ]),
      ),
    [spans],
  );

  const stageRef = useRef<HTMLDivElement | null>(null);
  const [viewport, setViewport] = useState<PolyViewport>({
    width: 0,
    height: 0,
  });
  const [hovered, setHovered] = useState<string | null>(null);
  /** The bass lane's own controls, opened on the canvas next to the lane. */
  const [bassPanel, setBassPanel] = useState<{
    sectionId: string;
    x: number;
    y: number;
  } | null>(null);
  const [panning, setPanning] = useState(false);
  const [lodIndex, setLodIndex] = useState(() =>
    stickyLodIndex(camera.zoom, 0),
  );

  // Everything the imperative handlers read lives in refs: pan/zoom run at
  // pointer rate and must not re-bind a listener or wait for a render.
  const cameraRef = useRef(camera);
  cameraRef.current = camera;
  const viewportRef = useRef(viewport);
  viewportRef.current = viewport;
  const layoutRef = useRef(layout);
  layoutRef.current = layout;

  // Lane order is a reading preference (device-global), so the offsets every
  // lane is drawn at come from here rather than from module constants.
  const lanes = useMemo(() => laneGeometry(prefs.laneOrder), [prefs.laneOrder]);
  const lanesRef = useRef(lanes);
  lanesRef.current = lanes;

  // The canvas is a document whose extent is the song: it grows when the song
  // grows, and panning stops at its edges (§0.13).
  const world = useMemo(() => worldBounds(layout), [layout]);
  const worldRef = useRef(world);
  worldRef.current = world;

  /** Where a node is DRAWN. Its home column still owns the order; a placement
   *  only moves the drawing (Stage never writes Score). */
  const displayNode = useCallback(
    (
      node: PolyNode,
    ): { node: PolyNode; placed: boolean; placement: PolyPlacement | null } => {
      const draft =
        placementDraft && placementDraft.key === node.key
          ? { dx: placementDraft.dx, dy: placementDraft.dy }
          : undefined;
      const resolved = draft ?? resolvePlacement(placements, node);
      if (!isPlaced(resolved) || !resolved)
        return { node, placed: false, placement: null };
      // A placement saved before the canvas had edges may sit outside the
      // song. It is clamped where it is read, so it appears at the edge
      // instead of disappearing.
      const placement = clampPlacement(node, resolved, world);
      const rect = placedRect(node, placement);
      return {
        node: { ...node, x: rect.x, y: rect.y },
        placed: true,
        placement,
      };
    },
    [placementDraft, placements, world],
  );

  const roleStyle = useRoleStyle();

  useLayoutEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const measure = () =>
      setViewport({ width: el.clientWidth, height: el.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // First visit to a song opens at the STANDARD view: one section at 50%,
  // centred on the spine — the scale the canvas is designed around. `F` still
  // frames the whole song, and a remembered camera always wins.
  //
  // Re-run on every viewport change until the user takes control, because the
  // first measurement is taken while the shell is still laying out.
  const userMoved = useRef(false);
  useEffect(() => {
    userMoved.current = false;
  }, [cameraKey]);
  useEffect(() => {
    if (!cameraKey || viewport.width === 0 || layout.nodes.length === 0) return;
    if (userMoved.current) return;
    if (hasSavedCamera) {
      // A camera saved on a wider window — or before the canvas had edges —
      // can sit outside the song. Pull it back inside; a camera that needs
      // nothing is left completely alone.
      const settled = clampToWorld(
        camera,
        world,
        viewport,
        POLY_GUTTER_W,
        POLY_RULER_H,
      );
      if (settled !== camera) setCamera(cameraKey, settled);
      return;
    }
    const target =
      layout.nodes.find((node) => node.sectionId === focusedId) ??
      layout.nodes[0];
    setCamera(
      cameraKey,
      clampToWorld(
        { x: target.x + target.w / 2, y: 0, zoom: STANDARD_ZOOM },
        world,
        viewport,
        POLY_GUTTER_W,
        POLY_RULER_H,
      ),
    );
  }, [
    cameraKey,
    viewport,
    layout,
    world,
    hasSavedCamera,
    setCamera,
    focusedId,
    camera,
  ]);

  /** Open the chord menu at the pointer, clamped into the stage like the
   *  section menu. */
  const openChordMenu = useCallback(
    (
      node: { sectionId: string },
      chordId: string,
      event: React.MouseEvent<HTMLElement>,
    ) => {
      const rect = stageRef.current?.getBoundingClientRect();
      if (!rect) return;
      setMenu(null);
      setChordMenu({
        sectionId: node.sectionId,
        chordId,
        x: Math.max(4, Math.min(event.clientX - rect.left, rect.width - 210)),
        y: Math.max(4, Math.min(event.clientY - rect.top, rect.height - 170)),
      });
    },
    [],
  );

  /** Open the step menu at the pointer, clamped into the stage. */
  const openStepMenu = useCallback(
    (
      node: { sectionId: string },
      lane: DrumLaneId,
      index: number,
      columns: number,
      event: React.MouseEvent<HTMLElement>,
    ) => {
      const rect = stageRef.current?.getBoundingClientRect();
      if (!rect) return;
      setMenu(null);
      setChordMenu(null);
      setStepMenu({
        sectionId: node.sectionId,
        lane,
        index,
        columns,
        x: Math.max(4, Math.min(event.clientX - rect.left, rect.width - 216)),
        y: Math.max(4, Math.min(event.clientY - rect.top, rect.height - 150)),
      });
    },
    [],
  );

  /** Leave the canvas for the screen that owns a lane (§S1.2). The route comes
   *  from `laneEditor.ts`, which is the same table the view rail's paths are
   *  checked against — so "Drums" means one place in both surfaces. */
  const openLaneEditor = useCallback(
    (lane: PolyLaneId) => {
      if (!cameraKey) return;
      window.location.assign(laneEditorPath(cameraKey, lane));
    },
    [cameraKey],
  );

  /**
   * The material wires for the focused section (§P2.1), in WORLD coordinates.
   *
   * Only the focused section: a graph drawn on all 64 columns is wallpaper, and
   * the question this answers ("what does this depend on?") is asked one section
   * at a time. The line runs down the column's left gutter from the source lane's
   * centre to the target lane's centre, so it reads as a cable between two rows
   * rather than as a floating annotation.
   */
  /** `${sectionId}#${pass}` → the section as that pass plays it. Declared up
   *  here so the keyboard map can read it; assigned where `sectionByKey` is. */
  const sectionByKeyRef = useRef<Map<string, BlueprintSection>>(new Map());

  const wireCables = useMemo(() => {
    if (!showWires || !focusedId) return [] as MaterialCable[];
    const node = layout.nodes.find((entry) => entry.sectionId === focusedId);
    const section = (song?.sections ?? []).find(
      (entry) => entry.id === focusedId,
    );
    const geometry = lanesRef.current.byId;
    if (!node || !section || geometry.size === 0) return [] as MaterialCable[];
    // Whether the drums are actually drawn: the lane resolver knows, and it is
    // one section's worth of work while the overlay is on.
    const hasDrums =
      polyDrumPattern(section, songSlice, node.occurrenceIndex ?? 0).length > 0;
    const graph = sectionMaterial(section, { hasDrums });
    const gutter = node.x + Math.max(3, 4 / Math.max(0.2, camera.zoom));
    return materialCables(graph, geometry, gutter);
  }, [showWires, focusedId, layout.nodes, song, songSlice, camera.zoom]);

  /**
   * The seams either side of the focused section (§P2.2).
   *
   * Only the two boundaries that touch it: a seam cable on all 84 is a fringe,
   * and the question ("what changes when this hands over?") is asked about one
   * section at a time. Order comes from `sectionSpans`, so a section that plays
   * three times is three boundaries, not one.
   */
  const seamCablesForFocus = useMemo(() => {
    if (!showWires || !focusedId || !song) return [] as SeamCable[];
    const spans = sectionSpans(song);
    const index = spans.findIndex(
      (span) =>
        span.sectionId === focusedId && span.occurrenceIndex === focusedPass,
    );
    if (index < 0) return [] as SeamCable[];
    const nodeByKey = new Map(layout.nodes.map((node) => [node.key, node]));
    const seamY = -POLY_SPINE_H / 2 - 6 / Math.max(0.05, camera.zoom);
    const out: SeamCable[] = [];
    for (const boundary of seamsAround(spans, index, song)) {
      const from = spans[boundary.fromIndex];
      const to = spans[boundary.toIndex];
      const fromNode = nodeByKey.get(
        `${from.sectionId}#${from.occurrenceIndex}`,
      );
      const toNode = nodeByKey.get(`${to.sectionId}#${to.occurrenceIndex}`);
      if (!fromNode || !toNode) continue;
      out.push(
        ...seamCables(boundary.facts, fromNode.x + fromNode.w, toNode.x, seamY),
      );
    }
    return out;
  }, [showWires, focusedId, focusedPass, song, layout.nodes, camera.zoom]);

  const markMoved = useCallback(() => {
    userMoved.current = true;
  }, []);

  // The canvas needs somewhere sensible selected for the Inspector, exactly
  // like a direct route into the workbench does.
  useEffect(() => {
    if (layout.nodes.length === 0) return;
    if (layout.nodes.some((node) => node.sectionId === focusedId)) return;
    setFocused(layout.nodes[0].sectionId);
  }, [layout, focusedId, setFocused]);

  // Face tier, with hysteresis so a node on a threshold cannot flicker.
  useEffect(() => {
    setLodIndex((current) => stickyLodIndex(camera.zoom, current));
  }, [camera.zoom]);
  const lod = LOD_TIERS[lodIndex];

  /**
   * Every camera write goes through here, so there is exactly one place that
   * knows the canvas has edges. Pan, wheel, fit, focus, walk, the minimap and
   * the shelf all land in the same clamp.
   */
  const applyCamera = useCallback(
    (next: PolyCamera) => {
      if (!cameraKey) return;
      setCamera(
        cameraKey,
        clampToWorld(
          next,
          worldRef.current,
          viewportRef.current,
          POLY_GUTTER_W,
        ),
      );
    },
    [cameraKey, setCamera],
  );

  const settle = useCallback(
    (next: PolyCamera) => applyCamera(next),
    [applyCamera],
  );

  const fitAll = useCallback(() => {
    const vp = viewportRef.current;
    const nodes = layoutRef.current.nodes;
    if (nodes.length === 0) return;
    markMoved();
    // The arrangement, and only the arrangement: parked sections are on the
    // shelf, not on the canvas, so fitting has nothing else to include.
    settle(fitRect(layoutRef.current.bounds, vp));
  }, [markMoved, settle]);

  const zoomBy = useCallback(
    (factor: number) => {
      const vp = viewportRef.current;
      if (vp.width === 0) return;
      markMoved();
      applyCamera(
        zoomAt(
          cameraRef.current,
          vp,
          { x: vp.width / 2, y: vp.height / 2 },
          factor,
        ),
      );
    },
    [applyCamera, markMoved],
  );

  const beginRename = useCallback((node: { sectionId: string }) => {
    editingRef.current = node.sectionId;
    setEditingId(node.sectionId);
  }, []);

  const commitRename = useCallback(
    (node: { sectionId: string; name: string }, name: string) => {
      if (editingRef.current !== node.sectionId) return; // already committed or cancelled
      editingRef.current = null;
      setEditingId(null);
      const trimmed = name.trim();
      if (!trimmed || trimmed === node.name) return;
      updateCurrentSong((s) =>
        updateSection(s, node.sectionId, (section) => ({
          ...section,
          name: trimmed,
        })),
      );
    },
    [updateCurrentSong],
  );

  const cancelRename = useCallback(() => {
    editingRef.current = null;
    setEditingId(null);
  }, []);

  const beginResize = useCallback(
    (
      node: { sectionId: string; bars: number },
      event: ReactPointerEvent<HTMLElement>,
    ) => {
      stageRef.current?.setPointerCapture(event.pointerId);
      resizeRef.current = {
        pointerId: event.pointerId,
        sectionId: node.sectionId,
        startX: event.clientX,
        startBars: node.bars,
      };
      setResizeDraft({ sectionId: node.sectionId, bars: node.bars });
      markMoved();
    },
    [markMoved],
  );

  /** Press and drag a chord cell sideways: move it within the progression.
   *  The preview re-orders every frame, so the chord is under the pointer the
   *  whole time; one history step lands on release. */
  const beginChordMove = useCallback(
    (
      node: { sectionId: string },
      chordId: string,
      centres: { chordId: string; centreX: number }[],
      event: ReactPointerEvent<HTMLElement>,
    ) => {
      const current = useSongStore.getState().currentSong();
      const section = current?.sections.find(
        (entry) => entry.id === node.sectionId,
      );
      if (!section || centres.length < 2) return;
      stageRef.current?.setPointerCapture(event.pointerId);
      chordMoveRef.current = {
        pointerId: event.pointerId,
        sectionId: node.sectionId,
        chordId,
        startX: event.clientX,
        active: false,
        base: section.chords,
        chords: section.chords,
        centres,
      };
      markMoved();
    },
    [markMoved],
  );

  /** Drag a chord cell's right edge: re-time that chord. The cell widths are
   *  shares of the section, so `pxPerBeat` comes from the column the cell sits
   *  in — a bar is a bar at any zoom. */
  const beginChordResize = useCallback(
    (
      node: { sectionId: string; w: number; durationBeats: number },
      chordId: string,
      event: ReactPointerEvent<HTMLElement>,
    ) => {
      const current = useSongStore.getState().currentSong();
      const section = current?.sections.find(
        (entry) => entry.id === node.sectionId,
      );
      const chord = section?.chords.find((entry) => entry.id === chordId);
      if (!section || !chord) return;
      const pxPerBeat = Math.max(
        1,
        (node.w * cameraRef.current.zoom) / Math.max(1, node.durationBeats),
      );
      stageRef.current?.setPointerCapture(event.pointerId);
      chordResizeRef.current = {
        pointerId: event.pointerId,
        sectionId: node.sectionId,
        chordId,
        startX: event.clientX,
        startBeats: chord.beats,
        // The cell is drawn conducted, so the drag has to know the rate.
        clock: normaliseTimeDomain(section.timeDomain),
        unit: gridUnit(beatsPerBar(section), DEFAULT_STEPS_PER_BAR),
        pxPerBeat,
      };
      markMoved();
    },
    [markMoved],
  );

  /** ⇧-click a painted step: walk its ratchet ×1 → ×4 → ×1.
   *
   *  The state comes from the note, not from the drawn row: a ratchet shows up in
   *  the resolved hits as more onsets in the same cell, which is also what the
   *  generated groove looks like, so the row cannot tell you what the author set. */
  const cycleDrumRatchet = useCallback(
    (
      node: { sectionId: string },
      lane: DrumLaneId,
      index: number,
      columns: number,
    ) => {
      updateCurrentSong((s) =>
        updateSection(s, node.sectionId, (section) => {
          const duration = sectionDurationBeats(section);
          const window = drumStepWindow(duration, columns, index);
          const note = paintedStep(
            section.drumBlocks as DrumBlock[] | undefined,
            lane,
            window,
          );
          if (!note) return section;
          const next = patchPaintedStep(
            section.drumBlocks as DrumBlock[] | undefined,
            {
              lane,
              ...window,
              patch: { ratchet: nextRatchet(note.ratchet) },
            },
          );
          return next ? { ...section, drumBlocks: next } : section;
        }),
      );
    },
    [updateCurrentSong],
  );

  /** ⌥-click a painted step: grace it. */
  const toggleDrumFlam = useCallback(
    (
      node: { sectionId: string },
      lane: DrumLaneId,
      index: number,
      columns: number,
    ) => {
      updateCurrentSong((s) =>
        updateSection(s, node.sectionId, (section) => {
          const duration = sectionDurationBeats(section);
          const window = drumStepWindow(duration, columns, index);
          const note = paintedStep(
            section.drumBlocks as DrumBlock[] | undefined,
            lane,
            window,
          );
          if (!note) return section;
          const next = patchPaintedStep(
            section.drumBlocks as DrumBlock[] | undefined,
            {
              lane,
              ...window,
              patch: { flam: note.flam !== true },
            },
          );
          return next ? { ...section, drumBlocks: next } : section;
        }),
      );
    },
    [updateCurrentSong],
  );

  /** Pointer down on a painted step's right edge: drag how long it holds.
   *
   *  The gate snaps in WHOLE CELLS, not in sixteenths. The cells are the drum
   *  grid — a cell is a beat at 4-per-bar — so "hold it two more steps" is the
   *  gesture a drummer makes, and it stays correct when §S1.4 changes the rung.
   *  The write is on release, so one drag is one undo. */
  const beginDrumGate = useCallback(
    (
      node: { sectionId: string; w: number; durationBeats: number },
      lane: DrumLaneId,
      index: number,
      columns: number,
      event: ReactPointerEvent<HTMLElement>,
    ) => {
      const current = useSongStore.getState().currentSong();
      const section = current?.sections.find(
        (entry) => entry.id === node.sectionId,
      );
      if (!section) return;
      const duration = sectionDurationBeats(section);
      const window = drumStepWindow(duration, columns, index);
      const note = paintedStep(
        section.drumBlocks as DrumBlock[] | undefined,
        lane,
        window,
      );
      // No authored note, no length to change. `paintedSteps` only offers the
      // handle there, so this is the belt to its braces. Note this asks whether
      // a NOTE exists, not whether it has a `durBeats`: a freshly painted step
      // holds for the block grid, which is a gate of one step, and that is the
      // number a drag has to start from.
      if (!note) return;
      stageRef.current?.setPointerCapture(event.pointerId);
      gateRef.current = {
        pointerId: event.pointerId,
        sectionId: node.sectionId,
        lane,
        index,
        startX: event.clientX,
        cellBeats: window.endBeat - window.startBeat || 1,
        startBeats: note.durBeats ?? window.endBeat - window.startBeat,
        window,
        durationBeats: duration,
        active: false,
      };
      markMoved();
    },
    [markMoved],
  );

  const pickLane = useCallback(
    (
      node: { sectionId: string },
      lane: PolyLaneId,
      at?: { x: number; y: number },
    ) => {
      setFocused(node.sectionId);
      const facet = LANE_FACET[lane];
      if (facet) useInspectorStore.getState().engage(facet);
      // The bass lane's controls are the ones the inspector is not showing: a
      // section's bassProfile is four chips, and they belong beside the line
      // they shape (§0.14).
      if (lane === "bass") {
        const rect = stageRef.current?.getBoundingClientRect();
        setBassPanel({
          sectionId: node.sectionId,
          x: at && rect ? Math.max(8, at.x - rect.left - 30) : 80,
          y: at && rect ? Math.max(8, at.y - rect.top + 14) : 120,
        });
      } else {
        setBassPanel(null);
      }
    },
    [setFocused],
  );

  const updateBass = useCallback(
    (
      sectionId: string,
      updater: (section: BlueprintSection) => BlueprintSection,
    ) => {
      updateCurrentSong((songNow) =>
        updateSection(songNow, sectionId, updater),
      );
    },
    [updateCurrentSong],
  );

  const beginMove = useCallback(
    (
      node: { sectionId: string; key: string },
      event: ReactPointerEvent<HTMLElement>,
    ) => {
      const current = useSongStore.getState().currentSong();
      if (!current) return;
      const from = current.sections.findIndex(
        (section) => section.id === node.sectionId,
      );
      if (from < 0) return;
      // Capture is claimed on the first real movement, not here: capturing on
      // pointerdown swallows the band's own click, which is what selects it.
      const columns = layoutRef.current.nodes
        .map((entry) => ({
          sectionIndex: current.sections.findIndex(
            (section) => section.id === entry.sectionId,
          ),
          centreX: entry.x + entry.w / 2,
        }))
        .filter((column) => column.sectionIndex >= 0);
      moveRef.current = {
        pointerId: event.pointerId,
        sectionId: node.sectionId,
        key: node.key,
        liftAll: event.shiftKey,
        copy: event.altKey,
        startPlacement: resolvePlacement(placementsRef.current, node),
        from,
        startX: event.clientX,
        startY: event.clientY,
        mode: "undecided",
        active: false,
        columns,
      };
      markMoved();
    },
    [markMoved],
  );

  /** Pointer down on a note bar: take the note and start a pitch/time drag.
   *  The lane's pixels-per-semitone come from the frame, so one row of drag is
   *  always one semitone however the section is scaled.
   *
   *  Bass draws its *resolved* line — the generated one when nothing is
   *  authored — so the base here is what the lane shows, and the commit writes
   *  it into `bassNotes`. That is the whole seeding rule: you start from what
   *  plays, never from an empty lane. */
  const beginNote = useCallback(
    (
      node: { sectionId: string; durationBeats: number; w: number },
      index: number,
      event: ReactPointerEvent<HTMLElement>,
      lane: PolyNoteLane = "melody",
      mode: "move" | "resize" = "move",
    ) => {
      const current = useSongStore.getState().currentSong();
      const section = current?.sections.find(
        (entry) => entry.id === node.sectionId,
      );
      if (!section) return;
      const base =
        lane === "bass"
          ? bassNotesFor(section, song ?? undefined).notes
          : (section.melody?.notes ?? []);
      if (!base[index]) return;
      const frame =
        lane === "bass"
          ? bassFrameFor(section, song ?? undefined)
          : polyNoteFrame(section);
      const laneH = lanesRef.current.byId.get(lane)?.h ?? 146;
      const pxPerSemitone = Math.max(
        1,
        (laneH * cameraRef.current.zoom) / Math.max(1, frame.high - frame.low),
      );
      const pxPerBeat = Math.max(
        1,
        (node.w * cameraRef.current.zoom) / Math.max(1, frame.beats),
      );
      stageRef.current?.setPointerCapture(event.pointerId);
      noteRef.current = {
        pointerId: event.pointerId,
        sectionId: node.sectionId,
        lane,
        index,
        startX: event.clientX,
        startY: event.clientY,
        base,
        frame,
        pxPerBeat,
        pxPerSemitone,
        // The view's own rung (§S2.1): the same number a chord edge snaps to.
        grid: gridUnit(beatsPerBar(section), stepsPerBar),
        resizing: mode === "resize",
        active: false,
      };
      setFocused(node.sectionId);
      setNoteHeld({ sectionId: node.sectionId, index, lane });
      markMoved();
    },
    [markMoved, setFocused, song, stepsPerBar],
  );

  /** Double-click on empty lane space: drop a note where the pointer is. */
  const addNote = useCallback(
    (
      node: { sectionId: string },
      point: { x: number; y: number },
      lane: PolyNoteLane = "melody",
    ) => {
      const studioSong = song ?? undefined;
      updateCurrentSong((s) =>
        updateSection(s, node.sectionId, (section) => {
          const base =
            lane === "bass"
              ? bassNotesFor(section, studioSong).notes
              : (section.melody?.notes ?? []);
          const frame =
            lane === "bass"
              ? bassFrameFor(section, studioSong)
              : polyNoteFrame(section);
          const notes = insertNote(
            base,
            frame,
            point,
            beatGrid(beatsPerBar(section)),
          );
          return lane === "bass"
            ? withBassNotes(section, notes)
            : withNotes(section, notes);
        }),
      );
    },
    [song, updateCurrentSong],
  );

  const deleteNote = useCallback(() => {
    const held = noteHeld;
    if (!held) return;
    setNoteHeld(null);
    const studioSong = song ?? undefined;
    updateCurrentSong((s) =>
      updateSection(s, held.sectionId, (section) => {
        const base =
          held.lane === "bass"
            ? bassNotesFor(section, studioSong).notes
            : (section.melody?.notes ?? []);
        const notes = removeNote(base, held.index);
        return held.lane === "bass"
          ? withBassNotes(section, notes)
          : withNotes(section, notes);
      }),
    );
  }, [noteHeld, song, updateCurrentSong]);

  /** Hand a section's bass back to its generated line. */
  const resetBassLine = useCallback(
    (sectionId: string) => {
      updateCurrentSong((s) => updateSection(s, sectionId, clearBassNotes));
    },
    [updateCurrentSong],
  );

  /** Opened by right-click, or by holding the column — a finger has no
   *  secondary button, and the role palette is not a modifier's secret. */
  const openMenu = useCallback(
    (
      node: { sectionId: string; key: string },
      at: { clientX: number; clientY: number },
    ) => {
      const rect = stageRef.current?.getBoundingClientRect();
      if (!rect) return;
      // Stage-local coordinates, clamped into the stage on both axes: the
      // panel is taller than the space below a section that sits low in the
      // window, and a menu whose last rows are off-screen is a menu with no
      // way to park — the very thing it is for.
      setMenu({
        sectionId: node.sectionId,
        nodeKey: node.key,
        view: "verbs",
        x: Math.max(
          4,
          Math.min(at.clientX - rect.left, rect.width - POLY_MENU_W - 4),
        ),
        y: Math.max(
          4,
          Math.min(at.clientY - rect.top, rect.height - POLY_MENU_H - 4),
        ),
      });
    },
    [],
  );

  const applyRole = useCallback(
    (role: SectionRole) => {
      const target = menu?.sectionId;
      setMenu(null);
      if (!target) return;
      updateCurrentSong((s) =>
        updateSection(s, target, (section) => ({ ...section, role })),
      );
    },
    [menu?.sectionId, updateCurrentSong],
  );

  const pickChord = useCallback(
    (node: { sectionId: string }, chordId: string) => {
      setFocused(node.sectionId);
      useHarmonySelectionStore.getState().setSelectedChordId(chordId);
      useInspectorStore.getState().engage("harmony");
    },
    [setFocused],
  );

  /** Retyping a chord: the numeral is the field a cell shows, so it is the
   *  field you can change. Parsing and the id/timing rules live in
   *  `lib/poly/chords`, so the canvas cannot invent a second chord grammar. */
  const beginChordEdit = useCallback(
    (node: { sectionId: string }, chordId: string) => {
      setFocused(node.sectionId);
      useHarmonySelectionStore.getState().setSelectedChordId(chordId);
      setChordEditingId(chordId);
    },
    [setFocused],
  );

  const cancelChordEdit = useCallback(() => setChordEditingId(null), []);

  const commitChordEdit = useCallback(
    (node: { sectionId: string }, chordId: string, text: string) => {
      setChordEditingId(null);
      const current = useSongStore.getState().currentSong();
      const section = current?.sections.find(
        (entry) => entry.id === node.sectionId,
      );
      if (!current || !section) return;
      const result = retypeChord(section, chordId, text, current);
      // A numeral the chart vocabulary cannot read is left alone rather than
      // silently replaced with something that sounds different.
      if (!result) return;
      updateCurrentSong((s) =>
        updateSection(s, node.sectionId, (entry) => ({
          ...entry,
          chords: result.chords,
        })),
      );
    },
    [updateCurrentSong],
  );

  /** Step the focused section's groove along the energy ladder / its variants.
   *  Written through `applyGrooveChoice`, the same writer the drums tab uses,
   *  so FX blocks survive and an authored outline is never silently replaced. */
  const nudgeGroove = useCallback(
    (step: (section: BlueprintSection) => GrooveChoice | null) => {
      const target = focusedId;
      if (!target) return;
      updateCurrentSong((s) =>
        updateSection(s, target, (section) => {
          const choice = step(section);
          return choice ? applyGrooveChoice(section, choice) : section;
        }),
      );
    },
    [focusedId, updateCurrentSong],
  );

  const stepGroove = useCallback(
    (direction: 1 | -1) =>
      nudgeGroove((section) => stepGrooveChoice(section, direction)),
    [nudgeGroove],
  );

  const stepVariant = useCallback(
    (direction: 1 | -1) =>
      nudgeGroove((section) => stepVariantChoice(section, direction)),
    [nudgeGroove],
  );

  /** Mute or solo one drum lane. Writes the SAME fields the drums tab writes,
   *  so preview, export and the Ableton bridge all follow (they share
   *  `audibleLanes`), and the canvas keeps the row on screen struck through
   *  so the toggle is reversible from here. */
  const toggleDrumLane = useCallback(
    (lane: DrumLaneId, mode: "mute" | "solo") => {
      const target = focusedId;
      if (!target) return;
      updateCurrentSong((s) =>
        updateSection(s, target, (section) => {
          const field = mode === "mute" ? "drumLaneMute" : "drumLaneSolo";
          const current = new Set(section[field] ?? []);
          if (current.has(lane)) current.delete(lane);
          else current.add(lane);
          const next = [...current] as DrumLaneKey[];
          return { ...section, [field]: next.length > 0 ? next : undefined };
        }),
      );
    },
    [focusedId, updateCurrentSong],
  );

  /**
   * Painting a step authors a `steps` drumBlock over exactly that step's beat
   * window — the same authored layer the Drum Blocks surface writes, so a
   * painted cell previews and exports through the pipeline that already exists
   * (see lib/poly/drumSteps.ts for why the window is a block).
   */
  const toggleDrumStep = useCallback(
    (
      node: PolyNode,
      lane: DrumLaneId,
      index: number,
      columns: number,
      on: boolean,
    ) => {
      updateCurrentSong((s) =>
        updateSection(s, node.sectionId, (section) => {
          // The lane draws the PATTERN (§P3.6), so a painted step writes the
          // cell it looks like it writes even when a clock moves where those
          // hits sound. This used to return the section untouched, which made
          // every click under a clock a silent no-op.
          // The window comes from the section's own length — the same number
          // `polyDrumPattern` divided into cells, so a click edits the cell it hit.
          const window = drumStepWindow(
            sectionDurationBeats(section),
            columns,
            index,
          );
          return {
            ...section,
            drumBlocks: toggleDrumStepBlocks(section.drumBlocks, {
              lane,
              ...window,
              on,
            }),
          };
        }),
      );
    },
    [updateCurrentSong],
  );

  const beginLyric = useCallback((node: { sectionId: string }) => {
    lyricRef.current = node.sectionId;
    setLyricEditingId(node.sectionId);
  }, []);

  const commitLyric = useCallback(
    (node: { sectionId: string }, text: string) => {
      if (lyricRef.current !== node.sectionId) return;
      lyricRef.current = null;
      setLyricEditingId(null);
      const clean = text.replace(/\r\n/g, "\n");
      const current = useSongStore.getState().currentSong();
      const target = current?.sections.find(
        (section) => section.id === node.sectionId,
      );
      if (!target || (target.lyrics ?? "") === clean) return;
      updateCurrentSong((s) =>
        updateSection(s, node.sectionId, (section) => ({
          ...section,
          lyrics: clean,
        })),
      );
    },
    [updateCurrentSong],
  );

  const cancelLyric = useCallback(() => {
    lyricRef.current = null;
    setLyricEditingId(null);
  }, []);

  /** Fold the section's material: loop its first N beats for the whole span
   *  (§P3.4). Off by default; a four-beat riff over an eight-bar section is
   *  what this is for. */
  const cycleLoop = useCallback(
    (sectionId: string) => {
      const current = useSongStore.getState().currentSong();
      if (!current) return;
      const section = current.sections.find((entry) => entry.id === sectionId);
      if (!section) return;
      const beats = sectionDurationBeats(section);
      const loop = nextLoop(section.timeDomain?.cycle, beats);
      updateCurrentSong((songNow) =>
        updateSection(songNow, sectionId, (target) => {
          const domain = target.timeDomain ?? { rate: 1 };
          const next = { ...domain, cycle: loop };
          return {
            ...target,
            // A loop of `0` means "the whole section": if that leaves nothing
            // else set, the domain goes away rather than sitting there inert.
            timeDomain: normaliseTimeDomain(next) ? next : undefined,
          };
        }),
      );
    },
    [updateCurrentSong],
  );

  /** Snap a section's clock to the 16th grid — the one-click fix for the drift
   *  a swing or an odd rate introduces (§P3.3). */
  const snapClock = useCallback(
    (sectionId: string) => {
      updateCurrentSong((songNow) =>
        updateSection(songNow, sectionId, (section) =>
          section.timeDomain
            ? {
                ...section,
                timeDomain: { ...section.timeDomain, quantizeTo: 0.25 },
              }
            : section,
        ),
      );
    },
    [updateCurrentSong],
  );

  const columnActions = useMemo<PolyColumnActions>(
    () => ({
      select: (node) => {
        setMenu(null);
        setNoteHeld(null);
        // Remember WHICH pass was clicked: a section that plays three times is
        // three nodes with one id, and the keyboard verbs (`M`, `⌫`, `S`) have
        // to act on the one under the pointer, not the first one in the song.
        lastNodeKeyRef.current = node.key;
        setFocusedPass(node.occurrenceIndex);
        setFocused(node.sectionId);
      },
      hover: setHovered,
      beginRename,
      rename: commitRename,
      cancelRename,
      beginResize,
      beginMove,
      openMenu,
      pickLane,
      pickChord,
      beginChordEdit,
      beginChordMove,
      openChordMenu,
      beginChordResize,
      commitChordEdit,
      cancelChordEdit,
      toggleDrumLane,
      toggleDrumStep,
      beginDrumGate,
      cycleDrumRatchet,
      toggleDrumFlam,
      openStepMenu,
      snapClock,
      stepGroove,
      stepVariant,
      beginNote,
      addNote,
      beginLyric,
      commitLyric,
      cancelLyric,
    }),
    [
      addNote,
      beginChordEdit,
      beginChordMove,
      beginChordResize,
      openChordMenu,
      beginLyric,
      beginMove,
      beginNote,
      beginRename,
      beginResize,
      cancelLyric,
      cancelRename,
      cancelChordEdit,
      commitChordEdit,
      commitLyric,
      commitRename,
      openMenu,
      pickChord,
      pickLane,
      setFocused,
      setFocusedPass,
      snapClock,
      stepGroove,
      stepVariant,
      toggleDrumLane,
      toggleDrumStep,
      beginDrumGate,
      cycleDrumRatchet,
      toggleDrumFlam,
      openStepMenu,
    ],
  );

  /** Bring a section into view. Used after creating one: the thing you just
   *  made has to be the thing you are looking at, and "＋ Section" used to
   *  select a column that had scrolled off the right edge. Runs the layout's
   *  own pipeline on the song as it will be, so nothing here re-derives where
   *  a section starts. */
  const revealSection = useCallback(
    (songAfter: BlueprintSong, sectionId: string) => {
      const { nodes } = arrangeSections(sectionSpans(songAfter), {
        bpm: songAfter.bpm,
        key: songAfter.key,
        scale: songAfter.scale,
      });
      const node = nodes.find((entry) => entry.sectionId === sectionId);
      if (!node) return;
      settle({ x: node.x + node.w / 2, y: 0, zoom: STANDARD_ZOOM });
    },
    [settle],
  );

  const addSectionAtEnd = useCallback(() => {
    const current = useSongStore.getState().currentSong();
    if (!current) return;
    const next = addSection(current, "verse");
    const created = next.sections[next.sections.length - 1];
    markMoved();
    updateCurrentSong(() => next);
    if (created) {
      setFocused(created.id);
      revealSection(next, created.id);
    }
  }, [markMoved, revealSection, setFocused, updateCurrentSong]);

  /** R: how many times this section plays in a row. Repeats are the Score's
   *  own "instance" — the same section, several passes — which is also what
   *  makes a per-pass placement mean anything. */
  const cycleRepeats = useCallback(() => {
    const target = focusedId;
    if (!target) return;
    const current = useSongStore.getState().currentSong();
    if (!current) return;
    const next = (repeatsFor(current, target) % 4) + 1;
    updateCurrentSong((s) => updateRepeats(s, target, next));
  }, [focusedId, updateCurrentSong]);

  /** S: park the focused section in the docked shelf, or bring it back.
   *
   *  Parking is a place OFF the canvas now (§0.16): the section leaves the
   *  arrangement's drawing but keeps its position in the song, and the shelf
   *  strip along the bottom says what is waiting there. */
  const parkNode = useCallback(
    (target: { key: string; sectionId: string }) => {
      if (!cameraKey) return;
      const store = usePolyStore.getState();
      if (store.isParked(cameraKey, target.key)) {
        store.unparkSection(cameraKey, target.key);
      } else {
        // Parked and lifted are two different places; a column cannot be in both.
        store.clearSectionPlacements(cameraKey, target.sectionId);
        store.parkSection(cameraKey, target.key);
      }
      markMoved();
    },
    [cameraKey, markMoved],
  );

  const toggleParked = useCallback(() => {
    const target = passNode();
    if (target) parkNode(target);
  }, [parkNode, passNode]);

  /** Insert a blank section beside the one the menu is for, and select it.
   *  `addSection` only appends and ⌥-drag only copies, so "I need a chorus
   *  here" had no verb: you built the song backwards from the end. */
  /** Step the focused section along the clock ladder (§P3): the song's time,
   *  half time, double time, then two degrees of swing. One undo each.
   *
   *  §P4.1: when the section plays more than once the clock belongs to the
   *  PASS you pressed it on, not to the section — "the last chorus is half
   *  time" is the whole reason instances exist. `step` reads the pass's own
   *  current value (`current`), so the ladder keeps walking from where it is. */
  const cycleClock = useCallback(
    (
      sectionId: string,
      pass: number,
      repeats: number,
      current?: TimeDomain,
      direction: 1 | -1 = 1,
    ) => {
      const next = direction > 0 ? nextClock(current) : previousClock(current);
      updateCurrentSong((songNow) =>
        repeats > 1
          ? setPassOverride(songNow, sectionId, pass, {
              timeDomain: next ?? undefined,
            })
          : updateSection(songNow, sectionId, (section) => ({
              ...section,
              timeDomain: next ?? undefined,
            })),
      );
    },
    [updateCurrentSong],
  );

  /** One chord write, as one undo step. */
  const editChord = useCallback(
    (
      patch: (section: BlueprintSection, chordId: string) => BlueprintSection,
    ) => {
      const target = chordMenu;
      setChordMenu(null);
      if (!target) return;
      updateCurrentSong((songNow) =>
        updateSection(songNow, target.sectionId, (section) =>
          patch(section, target.chordId),
        ),
      );
    },
    [chordMenu, updateCurrentSong],
  );

  /** Write a field to the pass the menu is for — or to the section when it
   *  plays once, where a pass override would only add a layer (§P4.3). */
  const writePassField = useCallback(
    (
      sectionId: string,
      pass: number,
      repeats: number,
      patch: SectionOverride,
    ) => {
      updateCurrentSong((songNow) =>
        repeats > 1
          ? setPassOverride(songNow, sectionId, pass, patch)
          : updateSection(songNow, sectionId, (section) => ({
              ...section,
              ...patch,
            })),
      );
    },
    [updateCurrentSong],
  );

  /** One more pass, behaving like the one you are on (§P4.4): the gesture that
   *  makes "the last two choruses are both half time and loud" one press instead
   *  of two overrides set twice. */
  const repeatLike = useCallback(
    (sectionId: string, pass: number) => {
      updateCurrentSong((songNow) => repeatPassLike(songNow, sectionId, pass));
    },
    [updateCurrentSong],
  );

  /** Give every pass of the section one clock again. */
  const clearPassClock = useCallback(
    (sectionId: string, pass: number) => {
      updateCurrentSong((songNow) =>
        clearPassOverride(songNow, sectionId, pass),
      );
    },
    [updateCurrentSong],
  );

  /** Give the section its own key or mode, or clear the override so it reads
   *  the song's again. The numerals re-derive on the next render — nothing
   *  here rewrites a chord. */
  const setSectionTonality = useCallback(
    (patch: TonalityPatch) => {
      const target = menu?.sectionId;
      setMenu(null);
      if (!target) return;
      // Through `updateSection`, which is the same writer the harmony charts
      // use for a section key, so this is one undo step like any other edit.
      updateCurrentSong((current) =>
        updateSection(current, target, (section) =>
          withSectionTonality(section, patch),
        ),
      );
    },
    [menu?.sectionId, updateCurrentSong],
  );

  const insertBesideMenu = useCallback(
    (after: boolean) => {
      const node = menu
        ? layoutRef.current.nodes.find(
            (entry) => entry.sectionId === menu.sectionId,
          )
        : undefined;
      const current = useSongStore.getState().currentSong();
      if (!node || !current) return;
      const index = current.sections.findIndex(
        (section) => section.id === node.sectionId,
      );
      if (index < 0) return;
      const result = insertSection(current, after ? index + 1 : index);
      if (!result) return;
      markMoved();
      updateCurrentSong(() => result.song);
      setFocused(result.sectionId);
      revealSection(result.song, result.sectionId);
    },
    [markMoved, menu, revealSection, setFocused, updateCurrentSong],
  );

  const restoreFromShelf = useCallback(
    (key: string) => {
      if (cameraKey) usePolyStore.getState().unparkSection(cameraKey, key);
    },
    [cameraKey],
  );

  /** G: put a frame round everything currently lifted.
   *
   *  A frame is just a region — membership is whatever is inside it — so this
   *  is a Stage edit with nothing to invalidate: drag a column out and it
   *  leaves the group, drag it in and it joins. */
  const groupLifted = useCallback(() => {
    if (!cameraKey) return;
    const rects = layoutRef.current.nodes
      .map((node) => displayNode(node))
      .filter((entry) => entry.placed)
      .map((entry) => ({
        x: entry.node.x,
        y: entry.node.y,
        w: entry.node.w,
        h: entry.node.h,
      }));
    const box = frameAround(rects);
    if (!box) return;
    usePolyStore.getState().addFrame(cameraKey, {
      id: crypto.randomUUID(),
      label: `Ideas ${songFrames.length + 1}`,
      ...box,
    });
  }, [cameraKey, displayNode, songFrames.length]);

  /** ⌘/Ctrl-D: copy the focused section and select the copy. This is how a
   *  long song gets built — a form is repetition, and retyping the chords of
   *  "verse 2" is not composing. */
  const duplicateFocused = useCallback(() => {
    const target = focusedId;
    if (!target) return;
    const current = useSongStore.getState().currentSong();
    if (!current) return;
    const result = duplicateSection(current, target);
    if (!result) return;
    markMoved();
    updateCurrentSong(() => result.song);
    setFocused(result.sectionId);
  }, [focusedId, markMoved, setFocused, updateCurrentSong]);

  /** Split a section at the playhead, if the playhead is inside it.
   *
   *  `splitSectionAtBar` is the workbench's own writer (it handles a section
   *  whose bars are not all the same length), so the canvas cannot invent a
   *  second idea of where a bar ends. The cut is refused at bar 0 because it
   *  would leave an empty section in front of the material. */
  const splitAtPlayhead = useCallback(
    (sectionId: string) => {
      const node = layoutRef.current.nodes.find(
        (entry) => entry.sectionId === sectionId,
      );
      if (!node) return;
      const current = useSongStore.getState().currentSong();
      const section = current?.sections.find((entry) => entry.id === sectionId);
      if (!current || !section) return;
      const beat = lastBeatRef.current;
      if (beat <= node.startBeat || beat >= node.startBeat + node.durationBeats)
        return;
      const bar = Math.floor((beat - node.startBeat) / beatsPerBar(section));
      if (bar <= 0) return;
      markMoved();
      updateCurrentSong((s) => splitSectionAtBar(s, sectionId, bar));
    },
    [markMoved, updateCurrentSong],
  );

  const mergeFocused = useCallback(
    (sectionId: string) => {
      const list = layoutRef.current.nodes;
      if (list.findIndex((entry) => entry.sectionId === sectionId) < 0) return;
      markMoved();
      updateCurrentSong((s) => mergeWithNext(s, sectionId));
    },
    [markMoved, updateCurrentSong],
  );

  const removeNode = useCallback(
    async (node: {
      sectionId: string;
      name: string;
      occurrenceIndex: number;
    }) => {
      const current = useSongStore.getState().currentSong();
      const repeats = current ? repeatsFor(current, node.sectionId) : 1;
      // Three choruses are one section with three passes: ⌫ on the third should
      // take the third, not all three (§P4.2).
      const confirmed = await askConfirm(
        repeats > 1
          ? {
              title: "Remove this pass",
              message: `Remove pass ${node.occurrenceIndex + 1} of ${repeats} from "${node.name}"? The section and its other passes stay.`,
              confirmLabel: "Remove pass",
              danger: true,
            }
          : {
              title: "Delete section",
              message: `Delete "${node.name}"?`,
              confirmLabel: "Delete",
              danger: true,
            },
      );
      if (!confirmed) return;
      updateCurrentSong((s) =>
        repeats > 1
          ? removePass(s, node.sectionId, node.occurrenceIndex)
          : removeSection(s, node.sectionId),
      );
    },
    [updateCurrentSong],
  );

  const deleteFocused = useCallback(async () => {
    const node = passNode();
    if (node) await removeNode(node);
  }, [passNode, removeNode]);

  /** Bring a section to the standard view — centred on the spine at 50%,
   *  the same scale the canvas opens at, so "go to this section" always
   *  lands somewhere familiar. */
  const focusSection = useCallback(
    (index: number) => {
      const node = layoutRef.current.nodes[index];
      if (!node) return;
      // The PASS too: "go to this node" means this pass, and the verbs read the
      // pass — omitting it made ⌫ on pass 2 offer to remove pass 1 (§P4.2).
      setFocused(node.sectionId);
      setFocusedPass(node.occurrenceIndex);
      lastNodeKeyRef.current = node.key;
      markMoved();
      // Centring is enough to clear the gutter now that the canvas has edges:
      // the world's left edge IS the song's first bar, and the clamp stops it
      // under the frozen gutter.
      settle({ x: node.x + node.w / 2, y: 0, zoom: STANDARD_ZOOM });
    },
    [markMoved, setFocused, setFocusedPass, settle],
  );

  const walk = useCallback(
    (direction: 1 | -1) => {
      const nodes = layoutRef.current.nodes;
      if (nodes.length === 0) return;
      const current = nodes.findIndex(
        (node) =>
          node.sectionId === focusedId && node.occurrenceIndex === focusedPass,
      );
      focusSection(
        Math.max(
          0,
          Math.min(nodes.length - 1, (current < 0 ? 0 : current) + direction),
        ),
      );
    },
    [focusedId, focusedPass, focusSection],
  );

  useGlobalKeys(({ event, typing }) => {
    if (typing) return;
    // ⌘/Ctrl-D duplicates a section. It has to be claimed before the modifier
    // guard below, or the browser's "bookmark this page" wins.
    if (
      (event.metaKey || event.ctrlKey) &&
      (event.key === "d" || event.key === "D")
    ) {
      event.preventDefault();
      duplicateFocused();
      return true;
    }
    // ⌥C steps the clock BACK, the same idiom the groove and variant rows use
    // ("click = busier, ⌥ = sparser"). It has to be claimed before the modifier
    // guard below, or ⌥ returns early and the key does nothing (§g9).
    if (event.altKey && (event.key === "c" || event.key === "C")) {
      event.preventDefault();
      if (focusedId) {
        cycleClock(
          focusedId,
          focusedPass,
          song ? repeatsFor(song, focusedId) : 1,
          sectionByKeyRef.current.get(`${focusedId}#${focusedPass}`)
            ?.timeDomain,
          -1,
        );
      }
      return true;
    }
    if (event.shiftKey && event.key === "F10") {
      const node =
        layoutRef.current.nodes.find(
          (entry) => entry.key === lastNodeKeyRef.current,
        ) ??
        layoutRef.current.nodes.find((entry) => entry.sectionId === focusedId);
      const rect = stageRef.current?.getBoundingClientRect();
      if (node && rect) {
        const centre = worldToScreen(cameraRef.current, viewportRef.current, {
          x: node.x + node.w / 2,
          y: 0,
        });
        openMenu(node, {
          clientX: rect.left + centre.x,
          clientY: rect.top + Math.max(60, centre.y),
        });
      }
      return true;
    }
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    switch (event.key) {
      case "c":
      case "C": {
        // The clock, on the focused PASS — the same write the section menu's
        // Clock row makes, so a keyboard user and a pointer user reach the same
        // states in the same order (§g9). It also unblocks anything that needs a
        // clock difference to exist (the §P2.2 seam cables).
        if (!focusedId) return true;
        const passSection = sectionByKeyRef.current.get(
          `${focusedId}#${focusedPass}`,
        );
        cycleClock(
          focusedId,
          focusedPass,
          song ? repeatsFor(song, focusedId) : 1,
          passSection?.timeDomain,
          1,
        );
        return true;
      }
      case "w":
      case "W":
        // The material graph is a READING of the song, so it is a toggle over the
        // canvas rather than another lane (§P2.1).
        setShowWires((on) => !on);
        return true;
      case "s":
      case "S":
        toggleParked();
        return true;
      case "m":
      case "M":
      case "ContextMenu":
        // "Tell me about this section": the menu carries split/merge/park/
        // duplicate, so it cannot be pointer-only. `M` is the memorable key;
        // the menu key is what a keyboard-only user would reach for.
        {
          const node =
            layoutRef.current.nodes.find(
              (entry) => entry.key === lastNodeKeyRef.current,
            ) ??
            layoutRef.current.nodes.find(
              (entry) => entry.sectionId === focusedId,
            );
          const rect = stageRef.current?.getBoundingClientRect();
          if (!node || !rect) return;
          const centre = worldToScreen(cameraRef.current, viewportRef.current, {
            x: node.x + node.w / 2,
            y: 0,
          });
          openMenu(node, {
            clientX: rect.left + centre.x,
            clientY: rect.top + Math.max(60, centre.y),
          });
        }
        return true;
      case "g":
      case "G":
        groupLifted();
        return true;
      case "r":
      case "R":
        cycleRepeats();
        return true;
      case "t":
      case "T":
        // Tidy: the way home from any placement, for the whole song. One key,
        // no selection to think about — the point is that the exit is cheap.
        if (cameraKey) usePolyStore.getState().clearStage(cameraKey);
        return true;
      case "f":
      case "F":
        fitAll();
        return true;
      case "z":
      case "Z": {
        const index = layoutRef.current.nodes.findIndex(
          (node) => node.sectionId === focusedId,
        );
        if (index >= 0) focusSection(index);
        return true;
      }
      case "[":
        zoomBy(1 / ZOOM_STEP);
        return true;
      case "]":
        zoomBy(ZOOM_STEP);
        return true;
      case "ArrowLeft":
        walk(-1);
        return true;
      case "ArrowRight":
        walk(1);
        return true;
      case "Delete":
      case "Backspace":
        // A held note is the more specific target: Delete means "this note"
        // until nothing is held, and only then "this section".
        if (noteHeld) deleteNote();
        else void deleteFocused();
        return true;
      case "Escape":
        if (noteHeld) {
          setNoteHeld(null);
          return true;
        }
        if (menu) {
          setMenu(null);
          return true;
        }
        if (bassPanel) {
          setBassPanel(null);
          return true;
        }
        if (stepMenu) {
          setStepMenu(null);
          return true;
        }
        if (chordMenu) {
          setChordMenu(null);
          return true;
        }
        if (resizeRef.current) {
          resizeRef.current = null;
          setResizeDraft(null);
          return true;
        }
        return;
    }
  }, KEY_PRIORITY.surface);

  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const onWheel = (event: WheelEvent) => {
      if (!cameraKey) return;
      const vp = viewportRef.current;
      const cam = cameraRef.current;
      markMoved();
      if (event.ctrlKey || event.metaKey) {
        // Trackpad pinch arrives as ctrl+wheel; the cursor is the anchor.
        const rect = el.getBoundingClientRect();
        const focal = {
          x: event.clientX - rect.left,
          y: event.clientY - rect.top,
        };
        applyCamera(zoomAt(cam, vp, focal, Math.exp(-event.deltaY * 0.002)));
      } else {
        applyCamera(panByPixels(cam, -event.deltaX, -event.deltaY));
      }
      event.preventDefault();
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [cameraKey, markMoved, applyCamera]);

  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    camera: PolyCamera;
  } | null>(null);

  function onPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    const onBackground = event.target === event.currentTarget;
    // Any press outside the panel closes it, not just one that starts a pan:
    // the menu floats over the lanes, so the thing you meant to click is often
    // a chord right underneath it.
    if (menu) setMenu(null);
    // NOT `if (stepMenu) setStepMenu(null)` on every press: the step menu lives
    // INSIDE the stage, so an unguarded clear unmounts the panel on the press
    // that was about to click one of its rows — the row then never receives its
    // click and the menu simply vanishes (§S1.10). Only a press that started on
    // the background dismisses it.
    if (stepMenu && onBackground) setStepMenu(null);
    const wantsPan =
      event.button === 1 ||
      event.altKey ||
      (onBackground && event.button === 0);
    if (!wantsPan) return;
    if (bassPanel) setBassPanel(null);
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      camera,
    };
    setPanning(true);
  }

  function onPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const resize = resizeRef.current;
    if (resize && resize.pointerId === event.pointerId) {
      const bars = resizeToBars(
        resize.startBars,
        event.clientX - resize.startX,
        cameraRef.current.zoom,
      );
      setResizeDraft((draft) =>
        draft && draft.sectionId === resize.sectionId && draft.bars === bars
          ? draft
          : { sectionId: resize.sectionId, bars },
      );
      return;
    }
    const chordMove = chordMoveRef.current;
    if (chordMove && chordMove.pointerId === event.pointerId) {
      if (!chordMove.active) {
        if (Math.abs(event.clientX - chordMove.startX) < 6) return;
        chordMove.active = true;
      }
      let target = chordMove.chordId;
      let best = Number.POSITIVE_INFINITY;
      for (const cell of chordMove.centres) {
        const distance = Math.abs(cell.centreX - event.clientX);
        if (distance < best) {
          best = distance;
          target = cell.chordId;
        }
      }
      const chords = moveChord(chordMove.base, chordMove.chordId, target);
      if (!chords) return;
      chordMove.chords = chords;
      const draft = { sectionId: chordMove.sectionId, chords };
      chordMoveDraftRef.current = draft;
      setChordMoveDraft(draft);
      return;
    }

    const chordResize = chordResizeRef.current;
    if (chordResize && chordResize.pointerId === event.pointerId) {
      // The cell is drawn where the clock plays it, but `beats` is stored in
      // local beats — so the drag's SONG-beat delta is converted before it is
      // written. Without this a half-time section resized at half the speed the
      // pointer moved (§P3.7).
      // §S2.1: the same grid every other lane snaps to. The drag is in SONG
      // beats (the cells are drawn conducted), so the delta is converted first,
      // then snapped — a half-time section used to resize at half speed.
      const localDelta = toLocalBeats(
        (event.clientX - chordResize.startX) / chordResize.pxPerBeat,
        chordResize.clock,
      );
      // The helper speaks pixels; here the delta is already in beats, so a
      // pixel-per-beat of 1 means "one pixel is one beat".
      const beats = chordLengthFromDrag(0, localDelta, 1, chordResize.unit);
      const draft = {
        sectionId: chordResize.sectionId,
        chordId: chordResize.chordId,
        beats,
      };
      chordDraftRef.current = draft;
      setChordDraft(draft);
      return;
    }

    const gateDrag = gateRef.current;
    if (gateDrag && gateDrag.pointerId === event.pointerId) {
      const dx = event.clientX - gateDrag.startX;
      if (!gateDrag.active) {
        if (Math.abs(dx) < 3) return;
        gateDrag.active = true;
      }
      // Pixels → cells → beats, snapped to whole cells. `pxPerCell` comes from
      // the column's own width so the drag tracks the pointer at any zoom.
      const node = layoutRef.current.nodes.find(
        (entry) => entry.sectionId === gateDrag.sectionId,
      );
      const pxPerCell = Math.max(
        1,
        ((node?.w ?? 0) * cameraRef.current.zoom) /
          Math.max(1, gateDrag.durationBeats / gateDrag.cellBeats),
      );
      const cells = Math.round(dx / pxPerCell);
      const beats = Math.max(
        MIN_DRUM_GATE,
        Math.min(
          gateDrag.durationBeats - gateDrag.window.startBeat,
          gateDrag.startBeats + cells * gateDrag.cellBeats,
        ),
      );
      const draft = { lane: gateDrag.lane, index: gateDrag.index, beats };
      gateDraftRef.current = draft;
      setGateDraft(draft);
      return;
    }

    const note = noteRef.current;
    if (note && note.pointerId === event.pointerId) {
      const dx = event.clientX - note.startX;
      const dy = event.clientY - note.startY;
      if (!note.active) {
        if (Math.abs(dx) < 3 && Math.abs(dy) < 3) return;
        note.active = true;
      }
      const notes = note.resizing
        ? // A length: where does the right edge land, in section beats?
          resizeNote(
            note.base,
            note.index,
            note.base[note.index].startTime + dx / note.pxPerBeat,
            note.grid,
            note.frame.beats,
          )
        : moveNote(note.base, note.index, note.frame, {
            semitones: Math.round(-dy / note.pxPerSemitone),
            beats: quantise(dx / note.pxPerBeat, note.grid),
          });
      const draft = { sectionId: note.sectionId, notes, lane: note.lane };
      noteDraftRef.current = draft;
      setNoteDraft(draft);
      return;
    }

    const move = moveRef.current;
    if (move && move.pointerId === event.pointerId) {
      const dx = event.clientX - move.startX;
      const dy = event.clientY - move.startY;
      if (!move.active) {
        if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return;
        move.active = true;
        stageRef.current?.setPointerCapture(move.pointerId);
      }
      // Which axis is this gesture about? Along the spine it reorders (a Score
      // edit); away from it, it lifts the section off the spine (a Stage edit).
      if (move.mode === "undecided") {
        const vertical =
          Math.abs(dy) > PLACEMENT_THRESHOLD && Math.abs(dy) > Math.abs(dx);
        move.mode = vertical ? "place" : "reorder";
      }
      if (move.mode === "place") {
        // The node follows the pointer: a second drag ADDS to where it already
        // sits rather than snapping it to the drag distance.
        const origin = move.startPlacement ?? { dx: 0, dy: 0 };
        const node = layoutRef.current.nodes.find(
          (entry) => entry.key === move.key,
        );
        const snapped = snapPlacement(
          origin.dx + dx / cameraRef.current.zoom,
          origin.dy + dy / cameraRef.current.zoom,
        );
        // A lift stops at the lane stack; past that is the shelf, which is a
        // different place entirely (the drop is what parks it).
        const draft = node
          ? clampPlacement(node, snapped, worldRef.current)
          : snapped;
        placementDraftRef.current = {
          key: move.liftAll ? move.sectionId : move.key,
          ...draft,
        };
        setPlacementDraft(placementDraftRef.current);
        return;
      }
      const rect = stageRef.current?.getBoundingClientRect();
      if (!rect) return;
      const worldX = screenToWorld(cameraRef.current, viewportRef.current, {
        x: event.clientX - rect.left,
        y: 0,
      }).x;
      let to = move.from;
      let best = Number.POSITIVE_INFINITY;
      for (const column of move.columns) {
        const distance = Math.abs(column.centreX - worldX);
        if (distance < best) {
          best = distance;
          to = column.sectionIndex;
        }
      }
      const draft = moveDraftRef.current;
      if (
        !draft ||
        draft.from !== move.from ||
        draft.to !== to ||
        draft.copy !== move.copy
      ) {
        moveDraftRef.current = {
          from: move.from,
          to,
          copy: move.copy,
          sectionId: move.sectionId,
        };
        setMoveDraft(moveDraftRef.current);
      }
      return;
    }

    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    markMoved();
    applyCamera(
      panByPixels(
        drag.camera,
        event.clientX - drag.startX,
        event.clientY - drag.startY,
      ),
    );
  }

  function endDrag(event: ReactPointerEvent<HTMLDivElement>) {
    const chordMove = chordMoveRef.current;
    if (chordMove && chordMove.pointerId === event.pointerId) {
      chordMoveRef.current = null;
      const draft = chordMoveDraftRef.current;
      chordMoveDraftRef.current = null;
      setChordMoveDraft(null);
      if (chordMove.active && draft && draft.chords !== chordMove.base) {
        updateCurrentSong((s) =>
          updateSection(s, draft.sectionId, (section) => ({
            ...section,
            chords: draft.chords,
          })),
        );
      }
      return;
    }

    const gateDrag = gateRef.current;
    if (gateDrag && gateDrag.pointerId === event.pointerId) {
      gateRef.current = null;
      const draft = gateDraftRef.current;
      gateDraftRef.current = null;
      setGateDraft(null);
      if (gateDrag.active && draft && draft.beats !== gateDrag.startBeats) {
        updateCurrentSong((s) =>
          updateSection(s, gateDrag.sectionId, (section) => {
            const next = setDrumStepGate(
              section.drumBlocks as DrumBlock[] | undefined,
              {
                lane: gateDrag.lane,
                startBeat: gateDrag.window.startBeat,
                endBeat: gateDrag.window.endBeat,
                beats: draft.beats,
                limitBeats: gateDrag.durationBeats,
              },
            );
            return next ? { ...section, drumBlocks: next } : section;
          }),
        );
      }
      return;
    }

    const chordResize = chordResizeRef.current;
    if (chordResize && chordResize.pointerId === event.pointerId) {
      chordResizeRef.current = null;
      const draft = chordDraftRef.current;
      chordDraftRef.current = null;
      setChordDraft(null);
      if (draft && draft.beats !== chordResize.startBeats) {
        updateCurrentSong((s) =>
          updateSection(s, draft.sectionId, (section) => ({
            ...section,
            chords: section.chords.map((chord) =>
              chord.id === draft.chordId
                ? { ...chord, beats: draft.beats }
                : chord,
            ),
          })),
        );
      }
      return;
    }

    const note = noteRef.current;
    if (note && note.pointerId === event.pointerId) {
      noteRef.current = null;
      const draft = noteDraftRef.current;
      noteDraftRef.current = null;
      setNoteDraft(null);
      if (note.active && draft) {
        const moved = draft.notes.find(
          (entry) =>
            entry.startTime !== note.base[note.index].startTime ||
            entry.pitch !== note.base[note.index].pitch ||
            entry.duration !== note.base[note.index].duration,
        );
        updateCurrentSong((s) =>
          updateSection(s, note.sectionId, (section) =>
            note.lane === "bass"
              ? withBassNotes(section, draft.notes)
              : withNotes(section, draft.notes),
          ),
        );
        if (moved) {
          const index = draft.notes.indexOf(moved);
          setNoteHeld(
            index >= 0
              ? { sectionId: note.sectionId, index, lane: note.lane }
              : null,
          );
        }
      }
      return;
    }

    const resize = resizeRef.current;
    if (resize && resize.pointerId === event.pointerId) {
      resizeRef.current = null;
      const draft = resizeDraftRef.current;
      if (draft && draft.bars !== resize.startBars) {
        updateCurrentSong((s) =>
          updateSection(s, resize.sectionId, (section) => ({
            ...section,
            bars: draft.bars,
          })),
        );
      }
      setResizeDraft(null);
      return;
    }
    const move = moveRef.current;
    if (move && move.pointerId === event.pointerId) {
      moveRef.current = null;
      const placed = placementDraftRef.current;
      placementDraftRef.current = null;
      setPlacementDraft(null);
      if (move.mode === "place") {
        // A Stage edit: the song's order is untouched, only where it is drawn.
        //
        // A drop over the shelf band at the bottom of the canvas is not a
        // placement at all — it parks the section, which is a different place
        // (off the canvas) with a different way home (the strip).
        const rect = stageRef.current?.getBoundingClientRect();
        const overShelf =
          move.active &&
          rect != null &&
          event.clientY > rect.bottom - POLY_SHELF_H;
        if (overShelf && placed && cameraKey) {
          const store = usePolyStore.getState();
          store.clearSectionPlacements(cameraKey, move.sectionId);
          store.parkSection(cameraKey, placed.key);
          return;
        }
        if (move.active && placed && cameraKey) {
          const store = usePolyStore.getState();
          // Lift-all rewrites the section-wide key, so any per-pass keys for
          // it would win over that and leave one pass where it was.
          if (move.liftAll)
            store.clearSectionPlacements(cameraKey, move.sectionId);
          else store.clearPlacement(cameraKey, move.sectionId);
          store.placeSection(cameraKey, placed.key, placed.dx, placed.dy);
        }
        return;
      }
      const draft = moveDraftRef.current;
      if (move.active && draft) {
        // The preview and the commit run the SAME function, so what you let go
        // of is what you get — including a copy, which is a different edit
        // (a new section) rather than a move.
        if (draft.copy) {
          updateCurrentSong((s) => copySectionTo(s, move.sectionId, draft.to));
        } else if (draft.to !== draft.from) {
          updateCurrentSong((s) => reorderSections(s, draft.from, draft.to));
        }
      }
      moveDraftRef.current = null;
      setMoveDraft(null);
      return;
    }
    if (dragRef.current?.pointerId !== event.pointerId) return;
    dragRef.current = null;
    setPanning(false);
  }

  // The playhead is written straight to the DOM: at 60fps a React render per
  // frame would re-render every visible chip.
  const playheadRef = useRef<HTMLDivElement | null>(null);
  const lastBeatRef = useRef(0);
  const placePlayhead = useCallback((beat: number) => {
    const el = playheadRef.current;
    const vp = viewportRef.current;
    if (!el || vp.width === 0) return;
    const cam = cameraRef.current;
    const worldX = layoutRef.current.beatToX(beat);
    const screenX = (worldX - cam.x) * cam.zoom + vp.width / 2;
    const visible = screenX >= 0 && screenX <= vp.width;
    el.style.transform = `translate3d(${screenX}px,0,0)`;
    el.style.opacity = visible ? "1" : "0";
  }, []);

  /** Which span the view last jumped to (§S1). `-1` means "not following yet",
   *  so the first frame of a song always lands on the section it is playing. */
  const followedSpanRef = useRef(-1);

  usePlayheadFrames((beat) => {
    lastBeatRef.current = beat;
    placePlayhead(beat);
    // Step the VIEW section by section, not continuously. A smooth scroll keeps
    // the playhead pinned to the middle of the screen, which means the section
    // you are editing slides away every bar; a jump when the playhead crosses
    // into the next section keeps a whole column in view for its whole duration
    // and reads as "we are in the chorus now". Manual panning or a drag stops
    // it: `markMoved` sets `userMoved`, and the user's view wins from then on.
    if (userMoved.current) return;
    const spans = layoutRef.current.nodes;
    const at = spans.findIndex(
      (node) =>
        beat >= node.startBeat - 1e-6 &&
        beat < node.startBeat + node.durationBeats - 1e-6,
    );
    if (at < 0 || at === followedSpanRef.current) return;
    const node = spans[at];
    followedSpanRef.current = at;
    // `settle` without `markMoved`: this is the canvas moving itself, not the
    // user, so following stays on.
    settle(centreOn(cameraRef.current, { x: node.x + node.w / 2, y: 0 }));
  });

  useLayoutEffect(() => {
    placePlayhead(lastBeatRef.current);
  }, [camera, viewport, layout, placePlayhead]);

  const parkedSet = useMemo(() => new Set(parkedKeys), [parkedKeys]);

  const visibleNodes = useMemo(() => {
    const drawable = layout.nodes.filter((node) => !parkedSet.has(node.key));
    if (viewport.width === 0) return drawable;
    return nodesInView(
      drawable,
      visibleWorldRect(camera, viewport),
      camera.zoom,
    );
  }, [layout.nodes, parkedSet, camera, viewport]);

  /** The dashed line from a lifted section back to where it plays. */
  const tethers = useMemo(
    () =>
      visibleNodes
        .map((node) => displayNode(node))
        .filter(
          (
            entry,
          ): entry is {
            node: PolyNode;
            placed: true;
            placement: PolyPlacement;
          } => entry.placed,
        )
        .map((entry) => {
          const home =
            layout.nodes.find((node) => node.key === entry.node.key) ??
            entry.node;
          return { key: entry.node.key, ...tetherLine(home, entry.node, 0) };
        }),
    [visibleNodes, displayNode, layout.nodes],
  );

  /** What the shelf strip lists: parked passes, with the facts that name them. */
  const shelfItems = useMemo<PolyShelfItem[]>(() => {
    const byKey = new Map(layout.nodes.map((node) => [node.key, node]));
    return parkedKeys.flatMap((key) => {
      const node = byKey.get(key);
      if (!node) return [];
      return [
        {
          key,
          name: node.name,
          role: roleStyle(node.role),
          summary: `${node.bars}b · ${node.facts.meter}`,
          ordinal: node.ordinal,
        },
      ];
    });
  }, [parkedKeys, layout.nodes, roleStyle]);

  const liftedCount = useMemo(
    () => layout.nodes.filter((node) => displayNode(node).placed).length,
    [layout.nodes, displayNode],
  );

  const positionByKey = useMemo(
    () => new Map(layout.nodes.map((node, index) => [node.key, index])),
    [layout.nodes],
  );

  const focusedNode = layout.nodes.find(
    (node) =>
      node.sectionId === focusedId && node.occurrenceIndex === focusedPass,
  );

  const inverseZoom = 1 / camera.zoom;

  const worldTransform = `translate3d(${viewport.width / 2 - camera.x * camera.zoom}px, ${
    viewport.height / 2 - camera.y * camera.zoom
  }px, 0) scale(${camera.zoom})`;

  if (!song) {
    return (
      <div className="h-full grid place-items-center text-xs text-inkMuted">
        No song is open — pick one from the library.
      </div>
    );
  }

  // What the section menu needs to know about the section it is for. Read at
  // render: the menu is opened on demand, so this is the state at that moment.
  const menuNode = menu
    ? (layout.nodes.find((node) => node.key === menu.nodeKey) ??
      layout.nodes.find((node) => node.sectionId === menu.sectionId) ??
      null)
    : null;
  const menuSection =
    menu && song
      ? (song.sections.find((section) => section.id === menu.sectionId) ?? null)
      : null;
  /** What the Tonality row says on its face: the home the numerals are being
   *  read against, marked when it is the section's own rather than the song's. */
  /** What the Clock row says: "song time", or "½ · drums & melody" — the
   *  scope is on the row because a clock cannot move the harmony (§P3.5), and
   *  the moment you press it is the moment that matters. */
  const menuPassRepeats = menu ? repeatsFor(song ?? {}, menu.sectionId) : 1;
  const menuPassLabel =
    menuPassRepeats > 1 && menuNode
      ? `pass ${menuNode.occurrenceIndex + 1}/${menuPassRepeats}`
      : "";
  const menuPassOverride = menu
    ? passOverrideFor(
        song ?? {},
        menu.sectionId,
        menuNode?.occurrenceIndex ?? 0,
      )
    : null;
  // The clock a PASS actually plays: the resolved span, not the authored
  // section — the section may have no clock while this pass does.
  // The key handler runs long after this, but it is created earlier in the
  // component, so the map has to be reached through a ref (same reason the
  // camera and layout do).
  sectionByKeyRef.current = sectionByKey;
  const menuPassSection = menuNode ? sectionByKey.get(menuNode.key) : undefined;
  const menuClockHint = clockScopeHint(menuPassSection ?? menuSection ?? {});
  // The kit row only exists where stepping the groove is meaningful: an
  // authored outline, a muted section or an "auto" one has no ladder to walk.
  const menuKitStep = menuPassSection
    ? stepGrooveChoice(menuPassSection, 1) !== null
    : false;

  const menuTonalityHint = menuSection?.key
    ? `${menuSection.key}${menuSection.scale ? ` ${menuSection.scale}` : ""}`
    : "song key";

  const menuState = sectionMenuState({
    startBeat: menuNode?.startBeat ?? 0,
    bars: menuSection?.bars ?? 0,
    beatsPerBar: menuSection ? beatsPerBar(menuSection) : 0,
    playheadBeat: lastBeatRef.current,
    hasNext: menuNode
      ? layout.nodes.some((node) => node.ordinal === menuNode.ordinal + 1)
      : false,
    parked: menuNode ? parkedSet.has(menuNode.key) : false,
  });

  return (
    <div className="relative h-full min-h-0 overflow-hidden bg-canvas">
      <div
        ref={stageRef}
        role="group"
        aria-label="Poly canvas — sections laid out across the arrangement"
        title="Drag a section sideways to reorder, ⌥-drag to drop a copy there, down to lift it aside, onto the shelf to park it · M section menu · S shelf · F fit · Z centre · G frame · R repeat · T tidy · [ ] zoom · ← → walk · Alt-drag the background to pan · ⌘-scroll to zoom"
        className={`relative h-full w-full overflow-hidden ${panning ? "cursor-grabbing" : "cursor-grab"}`}
        style={{ touchAction: "none" }}
        onScroll={(event) => {
          // The world layer is wider than the stage, so it is *programmatically*
          // scrollable even under `overflow-hidden` — and focusing the lyric
          // editor would then slide the whole canvas sideways. Pin it.
          event.currentTarget.scrollLeft = 0;
          event.currentTarget.scrollTop = 0;
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        <div
          className="absolute left-0 top-0 origin-top-left pointer-events-none"
          style={{ transform: worldTransform }}
        >
          {/* Bar grid — a hairline per bar across every lane. The Ribbon above
              is the ruler; this is only enough to keep local time legible. */}
          <div aria-hidden>
            {layout.barTicks.map((tick) => (
              <div
                key={tick.bar}
                className="absolute"
                style={{
                  left: tick.x,
                  top: layout.bounds.y,
                  width: 1 * inverseZoom,
                  height: layout.bounds.h,
                  background: "rgb(var(--c-ink) / 0.055)",
                }}
              />
            ))}
          </div>

          {/* Lane rules — the horizontal half of the grid. Without them the
              lanes read as floating bands instead of rows. */}
          <div aria-hidden>
            {lanes.rects.map((rect) => (
              <div
                key={rect.id}
                className="absolute"
                style={{
                  left: 0,
                  width: layout.bounds.w,
                  top: rect.y - 0.5 * inverseZoom,
                  height: 1 * inverseZoom,
                  background: "rgb(var(--c-ink) / 0.05)",
                }}
              />
            ))}
            <div
              className="absolute"
              style={{
                left: 0,
                width: layout.bounds.w,
                top: layout.bounds.y + layout.bounds.h - 0.5 * inverseZoom,
                height: 1 * inverseZoom,
                background: "rgb(var(--c-ink) / 0.05)",
              }}
            />
          </div>

          {/* Material wires (§P2.1) — what feeds what inside the focused
              section. Drawn in world units with the columns, so they pan and
              zoom with them; `overflow: visible` lets a cable leave the box. */}
          {wireCables.length > 0 || seamCablesForFocus.length > 0 ? (
            <svg
              aria-hidden
              className="absolute"
              style={{
                left: layout.bounds.x,
                top: layout.bounds.y,
                width: Math.max(1, layout.bounds.w),
                height: Math.max(1, layout.bounds.h),
                overflow: "visible",
                pointerEvents: "none",
              }}
            >
              {wireCables.map((cable) => {
                const mid = (cable.y1 + cable.y2) / 2;
                const x = cable.x - layout.bounds.x;
                const y1 = cable.y1 - layout.bounds.y;
                const y2 = cable.y2 - layout.bounds.y;
                const glued = cable.kind === "glues" || cable.kind === "drives";
                // A glue/drive cable bows OUT to the left of the gutter: it is
                // an influence from another material, not a derivation, and the
                // shape should say so before the label does.
                const bow = glued ? 14 * inverseZoom : 0;
                return (
                  <g key={`${cable.from}-${cable.to}-${cable.kind}`}>
                    <title>{`${cable.from} → ${cable.to} · ${cable.kind} — ${cable.reason}`}</title>
                    <path
                      d={`M ${x} ${y1} C ${x - bow} ${mid}, ${x - bow} ${mid}, ${x} ${y2}`}
                      fill="none"
                      stroke="rgb(var(--c-ink))"
                      strokeWidth={1.2 * inverseZoom}
                      strokeOpacity={glued ? 0.75 : 0.4}
                      strokeDasharray={
                        glued
                          ? `${3 * inverseZoom} ${2.5 * inverseZoom}`
                          : undefined
                      }
                      strokeLinecap="round"
                    />
                  </g>
                );
              })}
              {seamCablesForFocus.map((cable) => {
                // A seam is drawn as a bracket over the gap: a flat line at the
                // spine would read as part of the spine.
                const x1 = cable.x1 - layout.bounds.x;
                const x2 = cable.x2 - layout.bounds.x;
                const y = cable.y - layout.bounds.y;
                const lift = 7 / Math.max(0.05, camera.zoom);
                return (
                  <g key={`${cable.kind}-${cable.x1}-${cable.x2}`}>
                    <title>{`${cable.kind} — ${cable.reason}`}</title>
                    <path
                      d={`M ${x1} ${y} C ${x1} ${y - lift}, ${x2} ${y - lift}, ${x2} ${y}`}
                      fill="none"
                      stroke="rgb(var(--c-ink))"
                      strokeWidth={1.4 / Math.max(0.05, camera.zoom)}
                      strokeOpacity={0.85}
                      strokeLinecap="round"
                    />
                  </g>
                );
              })}
            </svg>
          ) : null}

          {/* The spine itself — one line the whole arrangement hangs from. */}
          <div
            aria-hidden
            className="absolute"
            style={{
              left: layout.bounds.x - 240,
              width: layout.bounds.w + 480,
              top: -0.5 * inverseZoom,
              height: 1 * inverseZoom,
              background: "rgb(var(--c-edge))",
            }}
          />

          <button
            type="button"
            onClick={addSectionAtEnd}
            title="Add a section at the end of the song"
            className="absolute flex items-center rounded-full border border-edge bg-panel text-inkMuted hover:text-ink hover:border-inkMuted"
            style={{
              left: layout.bounds.w + 20,
              top: -POLY_SPINE_H / 2,
              height: POLY_SPINE_H,
              paddingLeft: 10 * inverseZoom,
              paddingRight: 12 * inverseZoom,
              fontSize: 10 * inverseZoom,
              pointerEvents: "auto",
            }}
          >
            + Section
          </button>

          {/* Frames sit furthest back: they are a region, not the thing in it.
              Membership is derived from geometry (`nodesInFrame`), so a column
              dragged out of the box simply stops belonging. */}
          {songFrames.map((frame) => {
            const label = frameLabel(frame, camera.zoom);
            const members = nodesInFrame(
              frame,
              layout.nodes.map((node) => {
                const drawn = displayNode(node);
                return {
                  key: node.key,
                  x: drawn.node.x,
                  y: drawn.node.y,
                  w: node.w,
                  h: node.h,
                };
              }),
            );
            return (
              <div key={frame.id}>
                <div
                  aria-hidden
                  className="absolute rounded-lg border border-dashed"
                  style={{
                    left: frame.x,
                    top: frame.y,
                    width: frame.w,
                    height: frame.h,
                    borderColor: "rgb(var(--c-accent) / 0.35)",
                    background: "rgb(var(--c-accent) / 0.035)",
                  }}
                />
                <div
                  className="absolute flex items-center"
                  style={{ left: label.x, top: label.y, gap: 6 / camera.zoom }}
                >
                  <span
                    aria-hidden
                    className="font-mono uppercase text-inkMuted"
                    style={{
                      fontSize: label.size,
                      letterSpacing: 0.6,
                      lineHeight: 1,
                    }}
                  >
                    {frame.label} · {members.length}
                  </span>
                  <button
                    type="button"
                    aria-label={`Delete frame ${frame.label}`}
                    title="Delete this frame (its sections stay where they are)"
                    onClick={() => {
                      if (cameraKey)
                        usePolyStore
                          .getState()
                          .removeFrame(cameraKey, frame.id);
                    }}
                    className="rounded border border-edge bg-panel text-inkMuted hover:text-ink"
                    style={{
                      fontSize: label.size,
                      lineHeight: 1,
                      padding: `0 ${3 / camera.zoom}px`,
                      pointerEvents: "auto",
                      cursor: "pointer",
                    }}
                  >
                    ×
                  </button>
                </div>
              </div>
            );
          })}

          {/* Tethers next, so a lifted section's line runs UNDER every
              column — the cue is "it still plays there", not a wire. */}
          {tethers.length > 0 ? (
            <svg
              aria-hidden
              className="absolute overflow-visible"
              style={{ left: 0, top: 0, width: 1, height: 1 }}
            >
              {tethers.map((line) => (
                <line
                  key={line.key}
                  x1={line.x1}
                  y1={line.y1}
                  x2={line.x2}
                  y2={line.y2}
                  stroke="rgb(var(--c-accent) / 0.55)"
                  strokeWidth={1.5 * inverseZoom}
                  strokeDasharray={`${5 * inverseZoom} ${4 * inverseZoom}`}
                />
              ))}
            </svg>
          ) : null}

          {/* Lifted columns paint LAST: a section you picked up belongs on top
              of the arrangement, and a band underneath a neighbour's lanes
              cannot be grabbed. */}
          {[...visibleNodes]
            .sort(
              (a, b) =>
                Number(displayNode(a).placed) - Number(displayNode(b).placed),
            )
            .map((node) => {
              const position = positionByKey.get(node.key) ?? 0;
              const next = layout.nodes[position + 1];
              const section = sectionByKey.get(node.key);
              if (!section) return null;
              const drawn = displayNode(node);
              return (
                <div key={node.key}>
                  <PolyColumn
                    node={drawn.node}
                    placed={drawn.placed}
                    section={section}
                    song={songSlice}
                    authored={(song?.sections ?? []).find(
                      (entry) => entry.id === node.sectionId,
                    )}
                    role={roleStyle(node.role)}
                    lod={lod}
                    lanes={lanes}
                    chordLabels={prefs.chordLabels}
                    inverseZoom={inverseZoom}
                    selected={node.sectionId === focusedId}
                    hovered={hovered === node.key}
                    editingName={editingId === node.sectionId}
                    editingLyric={lyricEditingId === node.sectionId}
                    selectedNote={
                      noteHeld &&
                      noteHeld.lane === "melody" &&
                      noteHeld.sectionId === node.sectionId
                        ? noteHeld.index
                        : null
                    }
                    selectedBassNote={
                      noteHeld &&
                      noteHeld.lane === "bass" &&
                      noteHeld.sectionId === node.sectionId
                        ? noteHeld.index
                        : null
                    }
                    editingChordId={chordEditingId}
                    gateDraft={gateDraft}
                    actions={columnActions}
                  />
                  {next ? (
                    <span
                      aria-hidden
                      className="absolute text-inkMuted/60 pointer-events-none"
                      style={{
                        left: node.x + node.w + 2 * inverseZoom,
                        top: -8 * inverseZoom,
                        fontSize: 13 * inverseZoom,
                        lineHeight: 1,
                      }}
                    >
                      ›
                    </span>
                  ) : null}
                </div>
              );
            })}
        </div>

        <div
          ref={playheadRef}
          aria-hidden
          className="absolute left-0 top-0 bottom-0 w-px bg-accent pointer-events-none"
          style={{ opacity: 0 }}
        />

        {/* Lane legend — a fixed gutter, like a spreadsheet's frozen header:
            pan vertically and you always know which row is the bass.
            §S1.2: the label is a control with TWO verbs. Click focuses the lane
            and opens its tools *here*; the arrow (or a double-click) opens the
            editor that owns it, which is the same route the view rail uses —
            one mapping, in `laneEditor.ts`, so the two can never disagree.
            Navigating is the second verb on purpose: a header reads as "this
            row" more strongly than "leave this screen". */}
        <div
          className="absolute left-0 top-0 bottom-0"
          style={{
            width: POLY_GUTTER_W,
            background:
              "linear-gradient(90deg, rgb(var(--c-canvas) / 0.95) 0%, rgb(var(--c-canvas) / 0.85) 62%, rgb(var(--c-canvas) / 0) 100%)",
            pointerEvents: "none",
          }}
        >
          {lanes.rects.map((rect) => {
            const lane = POLY_LANES.find((entry) => entry.id === rect.id);
            if (!lane) return null;
            const height = rect.h * camera.zoom;
            if (height < 10) return null;
            return (
              <div
                key={lane.id}
                className="group absolute right-0 flex items-center justify-end gap-0.5 pr-1"
                style={{
                  top: (rect.y - camera.y) * camera.zoom + viewport.height / 2,
                  height,
                  left: 0,
                }}
              >
                <button
                  type="button"
                  aria-label={`${lane.label} lane — click to focus it and open its tools`}
                  title={`${lane.label} · click to focus the lane here`}
                  onClick={(event) => {
                    event.stopPropagation();
                    const node = passNode();
                    if (!node) return;
                    setFocused(node.sectionId);
                    pickLane(node, lane.id, {
                      x: event.clientX,
                      y: event.clientY,
                    });
                  }}
                  onDoubleClick={(event) => {
                    event.stopPropagation();
                    openLaneEditor(lane.id);
                  }}
                  className="font-mono uppercase text-inkMuted/70 enabled:hover:text-ink"
                  style={{
                    fontSize: 8,
                    letterSpacing: 0.4,
                    background: "none",
                    border: "none",
                    padding: 0,
                    cursor: "pointer",
                    pointerEvents: "auto",
                  }}
                >
                  {lane.label}
                </button>
                <button
                  type="button"
                  aria-label={laneEditorTitle(lane.id)}
                  title={laneEditorTitle(lane.id)}
                  onClick={(event) => {
                    event.stopPropagation();
                    openLaneEditor(lane.id);
                  }}
                  // Shown on hover or keyboard focus: a column of six arrows at
                  // all times is a column of six things to read.
                  className="rounded-sm text-inkMuted/40 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 hover:text-ink"
                  style={{
                    fontSize: 8,
                    lineHeight: 1,
                    background: "none",
                    border: "none",
                    padding: "1px 2px",
                    cursor: "pointer",
                    pointerEvents: "auto",
                  }}
                  onFocus={(event) => {
                    event.currentTarget.style.opacity = "1";
                  }}
                  onBlur={(event) => {
                    event.currentTarget.style.opacity = "";
                  }}
                >
                  ↗
                </button>
              </div>
            );
          })}
          {POLY_SPINE_H * camera.zoom >= 10 ? (
            <div
              className="absolute right-0 flex items-center justify-end pr-2"
              style={{
                top:
                  (-POLY_SPINE_H / 2 - camera.y) * camera.zoom +
                  viewport.height / 2,
                height: POLY_SPINE_H * camera.zoom,
                left: 0,
              }}
            >
              <span
                className="font-mono uppercase text-inkMuted/50"
                style={{ fontSize: 8, letterSpacing: 0.4 }}
              >
                Time
              </span>
            </div>
          ) : null}
        </div>

        {bassPanel
          ? (() => {
              const section = song.sections.find(
                (entry) => entry.id === bassPanel.sectionId,
              );
              if (!section) return null;
              return (
                <div
                  className="absolute z-30 w-56 rounded border border-edge bg-panel p-2 shadow-xl"
                  style={{ left: bassPanel.x, top: bassPanel.y }}
                  onPointerDown={(event) => event.stopPropagation()}
                  role="group"
                  aria-label={`Bass for ${section.name}`}
                >
                  <div className="mb-1 flex items-center gap-2">
                    <span className="flex-1 truncate font-mono text-[9px] uppercase tracking-wide text-inkMuted">
                      {section.name} · bass
                    </span>
                    <button
                      type="button"
                      onClick={() => setBassPanel(null)}
                      aria-label="Close bass controls"
                      className="rounded border border-edge/70 px-1 text-[10px] text-inkMuted hover:text-ink"
                    >
                      ×
                    </button>
                  </div>
                  <BassSettings
                    section={section}
                    onChange={(updater) =>
                      updateBass(bassPanel.sectionId, updater)
                    }
                  />
                  {section.bassNotes && section.bassNotes.length > 0 ? (
                    <div className="mt-2 flex items-center gap-2 border-t border-edge/60 pt-1.5">
                      <span
                        className="flex-1 font-mono text-[9px] uppercase tracking-wide text-accent/80"
                        title="This section plays notes written on the canvas, not the generated line — the profile above no longer moves them"
                      >
                        authored line · {section.bassNotes.length} notes
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          resetBassLine(section.id);
                          setBassPanel(null);
                        }}
                        title="Discard the written notes and play the generated line again"
                        className="rounded border border-edge/70 px-1.5 py-0.5 font-mono text-[10px] text-inkMuted hover:text-ink"
                      >
                        Reset
                      </button>
                    </div>
                  ) : null}
                </div>
              );
            })()
          : null}

        {stepMenu
          ? (() => {
              const section = (song?.sections ?? []).find(
                (entry) => entry.id === stepMenu.sectionId,
              );
              if (!section) return null;
              const duration = sectionDurationBeats(section);
              const window = drumStepWindow(
                duration,
                stepMenu.columns,
                stepMenu.index,
              );
              const cellBeats = window.endBeat - window.startBeat || 1;
              const authored = authoredSteps(
                section.drumBlocks as DrumBlock[] | undefined,
                stepMenu.lane,
                duration,
                stepMenu.columns,
              )[stepMenu.index];
              // No authored step means the cell was cleared while the menu was
              // open — nothing left to edit, and every row would no-op.
              if (!authored) return null;
              const edit = { lane: stepMenu.lane, ...window };
              // One section write per menu click, so every row is one undo step
              // — the same rule the drags and the chord menu follow.
              const write = (
                change: (
                  target: BlueprintSection,
                  range: typeof edit,
                ) => BlueprintSection,
              ) =>
                updateCurrentSong((s) =>
                  updateSection(s, stepMenu.sectionId, (target) =>
                    change(target, edit),
                  ),
                );
              return (
                <div
                  role="menu"
                  aria-label={stepMenuTitle(
                    DRUM_LANE_LABEL[stepMenu.lane],
                    stepMenu.index,
                    stepMenu.columns,
                    authored,
                  )}
                  className="absolute z-30 overflow-hidden rounded border border-edge bg-panel shadow-xl"
                  style={{ left: stepMenu.x, top: stepMenu.y, width: 208 }}
                  onClick={(event) => event.stopPropagation()}
                  onContextMenu={(event) => event.preventDefault()}
                >
                  <div className="border-b border-edge/70 px-2 py-1 font-mono text-[10px] text-inkMuted">
                    {stepMenuTitle(
                      DRUM_LANE_LABEL[stepMenu.lane],
                      stepMenu.index,
                      stepMenu.columns,
                      authored,
                    )}
                  </div>
                  <div className="flex gap-1 border-b border-edge/70 p-1">
                    {STEP_MENU_RATCHETS.map((row) => (
                      <button
                        key={row.value}
                        type="button"
                        aria-pressed={authored.ratchet === row.value}
                        title={`Roll the step ×${row.value}`}
                        onClick={() =>
                          write((target, range) =>
                            withStepRatchet(target, range, row.value),
                          )
                        }
                        className={`flex-1 rounded-sm border px-1 font-mono text-[10px] ${
                          authored.ratchet === row.value
                            ? "border-ink text-ink"
                            : "border-edge text-inkMuted hover:text-ink"
                        }`}
                      >
                        {row.label}
                      </button>
                    ))}
                  </div>
                  <div className="flex gap-1 border-b border-edge/70 p-1">
                    {STEP_MENU_PROBS.map((row) => (
                      <button
                        key={row.value}
                        type="button"
                        aria-pressed={authored.prob === row.value}
                        title={`Play the step ${row.label}`}
                        onClick={() =>
                          write((target, range) =>
                            withStepProbability(target, range, row.value),
                          )
                        }
                        className={`flex-1 rounded-sm border px-1 font-mono text-[10px] ${
                          authored.prob === row.value
                            ? "border-ink text-ink"
                            : "border-edge text-inkMuted hover:text-ink"
                        }`}
                      >
                        {row.label}
                      </button>
                    ))}
                  </div>
                  <div className="flex gap-1 border-b border-edge/70 p-1">
                    {STEP_MENU_HOLDS.map((cells) => {
                      const beats = Math.round(cells * cellBeats * 1e4) / 1e4;
                      const held =
                        authored.gate !== undefined &&
                        Math.abs(authored.gate - beats) < 1e-6;
                      return (
                        <button
                          key={cells}
                          type="button"
                          aria-pressed={held}
                          title={`Hold for ${beats} beats`}
                          onClick={() =>
                            write((target, range) =>
                              withStepGate(target, range, beats, duration),
                            )
                          }
                          className={`flex-1 rounded-sm border px-1 font-mono text-[10px] ${
                            held
                              ? "border-ink text-ink"
                              : "border-edge text-inkMuted hover:text-ink"
                          }`}
                        >
                          {cells} step{cells === 1 ? "" : "s"}
                        </button>
                      );
                    })}
                  </div>
                  <MenuItem
                    label={authored.flam ? "Remove flam" : "Flam"}
                    onClick={() =>
                      write((target, range) =>
                        withStepFlam(target, range, !authored.flam),
                      )
                    }
                  />
                  <MenuItem
                    label="Clear step"
                    danger
                    onClick={() => {
                      write((target, range) => withoutStep(target, range));
                      setStepMenu(null);
                    }}
                  />
                </div>
              );
            })()
          : null}

        {chordMenu
          ? (() => {
              const section = (song?.sections ?? []).find(
                (entry) => entry.id === chordMenu.sectionId,
              );
              const chord = section
                ? chordById(section, chordMenu.chordId)
                : null;
              if (!chord) return null;
              const inversion = chord.voicing?.inversion ?? 0;
              return (
                <div
                  className="absolute z-30 overflow-hidden rounded border border-edge bg-panel shadow-xl"
                  style={{
                    left: chordMenu.x,
                    top: Math.max(
                      4,
                      Math.min(chordMenu.y, viewport.height - 170),
                    ),
                    width: 196,
                  }}
                  onClick={(event) => event.stopPropagation()}
                >
                  <div className="border-b border-edge/70 px-2 py-1 font-mono text-[10px] text-inkMuted">
                    {chord.romanNumeral || chord.root} —{" "}
                    {chordDisplayName(
                      pitchClass(chord.root),
                      chord.quality,
                      (section?.key ?? song?.key ?? "C") as NoteName,
                    )}
                  </div>
                  <div className="flex flex-wrap gap-1 border-b border-edge/70 p-1">
                    {CHORD_MENU_QUALITIES.map((quality) => (
                      <button
                        key={quality}
                        type="button"
                        aria-pressed={chord.quality === quality}
                        onClick={() =>
                          editChord((target, id) =>
                            withChordQuality(target, id, quality),
                          )
                        }
                        className={`rounded-sm border px-1 font-mono text-[10px] ${
                          chord.quality === quality
                            ? "border-ink text-ink"
                            : "border-edge text-inkMuted hover:text-ink"
                        }`}
                      >
                        {QUALITY_LABEL[quality] ?? quality}
                      </button>
                    ))}
                  </div>
                  <div className="flex gap-1 border-b border-edge/70 p-1">
                    {CHORD_INVERSIONS.map((option) => (
                      <button
                        key={option.value}
                        type="button"
                        aria-pressed={inversion === option.value}
                        onClick={() =>
                          editChord((target, id) =>
                            withChordInversion(target, id, option.value),
                          )
                        }
                        className={`flex-1 rounded-sm border px-1 font-mono text-[10px] ${
                          inversion === option.value
                            ? "border-ink text-ink"
                            : "border-edge text-inkMuted hover:text-ink"
                        }`}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                  <MenuItem
                    label="Delete chord"
                    hint="⌫"
                    danger
                    onClick={() =>
                      editChord((target, id) => withoutChord(target, id))
                    }
                  />
                  <MenuItem
                    label="Open in Harmony"
                    hint="→"
                    onClick={() => {
                      const id = chordMenu.sectionId;
                      setChordMenu(null);
                      window.location.assign(`/song/${id}/harmony`);
                    }}
                  />
                </div>
              );
            })()
          : null}

        {menu ? (
          <div
            className="absolute z-30 overflow-hidden rounded border border-edge bg-panel shadow-xl"
            style={{
              left: menu.x,
              // Anchored to the section, then clamped into the stage: a section
              // low in the window would otherwise push the last rows — park,
              // delete — off the bottom, and they are the reason it opened.
              top: Math.max(
                4,
                Math.min(menu.y, viewport.height - POLY_MENU_H - 4),
              ),
              width: POLY_MENU_W,
            }}
            onPointerDown={(event) => event.stopPropagation()}
          >
            {menu.view === "tonality" ? (
              <div className="p-1">
                <MenuItem
                  label="Back"
                  hint="esc"
                  onClick={() => setMenu({ ...menu, view: "verbs" })}
                />
                <div className="px-1 pb-0.5 pt-1 font-mono text-[9px] uppercase tracking-wide text-inkMuted">
                  Section key
                </div>
                <MenuItem
                  label="Follow the song"
                  hint={
                    menuSection?.key || menuSection?.scale
                      ? "reset both"
                      : "current"
                  }
                  onClick={() => setSectionTonality({ key: null, scale: null })}
                />
                <MenuItem
                  label={`Song key · ${song?.key ?? "C"}`}
                  hint={menuSection?.key ? "" : "current"}
                  onClick={() => setSectionTonality({ key: null })}
                />
                <div className="grid grid-cols-4 gap-x-0.5 px-1 pb-1">
                  {KEY_ROOTS.slice(0, 12).map((root) => (
                    <button
                      key={root}
                      type="button"
                      onClick={() =>
                        setSectionTonality({ key: root as NoteName })
                      }
                      className={`rounded px-1 py-1 text-left text-[10px] hover:bg-panelAlt/70 ${
                        menuSection?.key === root ? "text-ink" : ""
                      }`}
                    >
                      {root}
                    </button>
                  ))}
                </div>
                <div className="px-1 pb-0.5 font-mono text-[9px] uppercase tracking-wide text-inkMuted">
                  Section mode
                </div>
                <MenuItem
                  label={`Song mode · ${song?.scale ?? "ionian"}`}
                  hint={menuSection?.scale ? "" : "current"}
                  onClick={() => setSectionTonality({ scale: null })}
                />
                <div className="grid grid-cols-2 gap-x-0.5 px-1 pb-1">
                  {SCALES.map((scale) => (
                    <button
                      key={scale}
                      type="button"
                      onClick={() =>
                        setSectionTonality({ scale: scale as ScaleType })
                      }
                      className={`rounded px-1 py-1 text-left text-[10px] hover:bg-panelAlt/70 ${
                        menuSection?.scale === scale ? "text-ink" : ""
                      }`}
                    >
                      {scale}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <>
                <div className="px-2 pb-0.5 pt-1 font-mono text-[9px] uppercase tracking-wide text-inkMuted">
                  Role
                </div>
                <div className="grid grid-cols-3 gap-x-0.5 px-1 pb-1">
                  {ROLE_OPTIONS.map(({ role: option }) => {
                    const style = roleStyle(option);
                    return (
                      <button
                        key={option}
                        type="button"
                        onClick={() => applyRole(option)}
                        className="flex items-center gap-1 rounded px-1 py-1 text-left text-[10px] text-ink hover:bg-panelAlt/70"
                      >
                        <span
                          aria-hidden
                          style={{
                            width: 7,
                            height: 7,
                            borderRadius: 2,
                            background: style.bg,
                            flex: "0 0 auto",
                          }}
                        />
                        <span className="truncate">{style.label}</span>
                      </button>
                    );
                  })}
                </div>

                {/* The section's own operations. They live here because a finger
                has no ⌥, no ⌘ and no right button, and because "what can I do
                with this section" should be one list rather than a keyboard
                legend (§0.18). */}
                <div className="mt-1 border-t border-edge/70 py-1">
                  {menuSection ? (
                    <>
                      <MenuItem
                        label="What feeds this"
                        hint={showWires ? "on · W" : "W"}
                        onClick={() => {
                          setMenu(null);
                          setShowWires((on) => !on);
                        }}
                      />
                      <MenuItem
                        label={
                          menuPassLabel ? `Clock · ${menuPassLabel}` : "Clock"
                        }
                        hint={`${menuClockHint} · C · ⌥C back`}
                        onClick={(event) => {
                          const id = menu.sectionId;
                          const pass = menuNode?.occurrenceIndex ?? 0;
                          const repeats = song ? repeatsFor(song, id) : 1;
                          const current = menuPassSection?.timeDomain;
                          setMenu(null);
                          cycleClock(
                            id,
                            pass,
                            repeats,
                            current,
                            event.altKey ? -1 : 1,
                          );
                        }}
                      />
                      {menuPassOverride ? (
                        <MenuItem
                          label="Follow the section"
                          hint={`pass ${(menuNode?.occurrenceIndex ?? 0) + 1} of ${menuPassRepeats}`}
                          onClick={() => {
                            const id = menu.sectionId;
                            const pass = menuNode?.occurrenceIndex ?? 0;
                            setMenu(null);
                            clearPassClock(id, pass);
                          }}
                        />
                      ) : null}
                      <MenuItem
                        label="Another like this"
                        hint={
                          menuPassRepeats > 1
                            ? `${menuPassRepeats} → ${menuPassRepeats + 1}`
                            : "plays twice"
                        }
                        onClick={() => {
                          const id = menu.sectionId;
                          const pass = menuNode?.occurrenceIndex ?? 0;
                          setMenu(null);
                          repeatLike(id, pass);
                        }}
                      />
                      <MenuItem
                        label={
                          menuPassLabel
                            ? `Velocity · ${menuPassLabel}`
                            : "Velocity"
                        }
                        hint={velocityHint(
                          menuPassSection?.velocity ?? menuSection?.velocity,
                        )}
                        onClick={() => {
                          const id = menu.sectionId;
                          const pass = menuNode?.occurrenceIndex ?? 0;
                          const next = nextVelocity(
                            menuPassSection?.velocity ?? menuSection?.velocity,
                          );
                          setMenu(null);
                          writePassField(id, pass, menuPassRepeats, {
                            velocity: next,
                          });
                        }}
                      />
                      {menuKitStep ? (
                        <MenuItem
                          label={
                            menuPassLabel ? `Kit · ${menuPassLabel}` : "Kit"
                          }
                          hint={
                            grooveChip(menuPassSection ?? menuSection ?? {})
                              .label
                          }
                          onClick={() => {
                            const id = menu.sectionId;
                            const pass = menuNode?.occurrenceIndex ?? 0;
                            const current = menuPassSection ?? menuSection;
                            const choice = current
                              ? stepGrooveChoice(current, 1)
                              : null;
                            const patch = choice
                              ? groovePatchFor(choice)
                              : null;
                            setMenu(null);
                            if (patch)
                              writePassField(id, pass, menuPassRepeats, patch);
                          }}
                        />
                      ) : null}
                      <MenuItem
                        label="Loop"
                        hint={
                          menuSection?.timeDomain?.cycle
                            ? `${menuSection.timeDomain.cycle} beats`
                            : "whole section"
                        }
                        onClick={() => {
                          const id = menu.sectionId;
                          setMenu(null);
                          cycleLoop(id);
                        }}
                      />
                      <MenuItem
                        label="Grid"
                        hint={
                          GRID_LABEL[stepsPerBar] ?? `${stepsPerBar} per bar`
                        }
                        onClick={() => {
                          setMenu(null);
                          setStepsPerBar((current) => nextGrid(current));
                        }}
                      />
                      <MenuItem
                        label="Tonality"
                        hint={menuTonalityHint}
                        onClick={() => setMenu({ ...menu, view: "tonality" })}
                      />
                      <MenuItem
                        label="Insert before"
                        onClick={() => {
                          setMenu(null);
                          insertBesideMenu(false);
                        }}
                      />
                      <MenuItem
                        label="Insert after"
                        onClick={() => {
                          setMenu(null);
                          insertBesideMenu(true);
                        }}
                      />
                      <MenuItem
                        label="Duplicate"
                        hint="⌘D"
                        onClick={() => {
                          setMenu(null);
                          duplicateFocused();
                        }}
                      />
                      <MenuItem
                        label="Split at playhead"
                        hint={menuState.splitHint}
                        disabled={!menuState.canSplit}
                        onClick={() => {
                          const id = menu.sectionId;
                          setMenu(null);
                          splitAtPlayhead(id);
                        }}
                      />
                      <MenuItem
                        label="Merge with next"
                        hint={menuState.canMerge ? "" : "last"}
                        disabled={!menuState.canMerge}
                        onClick={() => {
                          const id = menu.sectionId;
                          setMenu(null);
                          mergeFocused(id);
                        }}
                      />
                      <MenuItem
                        label={menuState.parkLabel}
                        hint="S"
                        onClick={() => {
                          const target = menuNode;
                          setMenu(null);
                          if (target) parkNode(target);
                          else toggleParked();
                        }}
                      />
                      <MenuItem
                        label={
                          menuPassRepeats > 1
                            ? "Remove this pass"
                            : "Delete section"
                        }
                        hint="⌫"
                        danger
                        onClick={() => {
                          const target = menuNode;
                          setMenu(null);
                          if (target) void removeNode(target);
                        }}
                      />
                    </>
                  ) : null}
                </div>
              </>
            )}
          </div>
        ) : null}

        <PolyMinimap
          layout={layout}
          camera={camera}
          viewport={viewport}
          onCentre={(world) => {
            markMoved();
            settle(centreOn(cameraRef.current, world));
          }}
        />

        {/* The song, always in view: at the standard 50% one section fills the
            window, so the other thirty-nine need a place to be. */}
        <PolySpanRuler
          layout={layout}
          camera={camera}
          viewport={viewport}
          focusedId={focusedId}
          parkedKeys={parkedKeys}
          onFocus={focusSection}
        />

        {/* Bottom-RIGHT: the minimap lives here too, but only on a wide
            canvas — at the standard 50% in a narrow pane this corner is the
            only one no lane is using, and the legend must not sit on top of
            the lane you are editing. */}
        <div
          className="absolute right-3 max-w-[14rem] rounded border border-edge bg-panel/85 px-2 py-1 font-mono text-[10px] leading-snug text-inkMuted backdrop-blur-sm pointer-events-none"
          style={{ bottom: shelfItems.length > 0 ? POLY_SHELF_H + 10 : 12 }}
        >
          {focusedNode ? `${focusedNode.name} · ` : ""}
          {Math.round(camera.zoom * 100)}% · {layout.nodes.length} spans ·{" "}
          {layout.totalBars} bars
          {liftedCount > 0 ? ` · ${liftedCount} lifted` : ""}
          {shelfItems.length > 0 ? ` · ${shelfItems.length} parked` : ""}
          {/* A reading mode has to say it is on: the wires are faint and the
              user needs to know why they are looking at them (§P2.1). */}
          {showWires ? (
            <span className="text-ink">
              {" "}
              · wires {wireCables.length}
              {seamCablesForFocus.length > 0
                ? ` · seams ${seamCablesForFocus.length}`
                : ""}
            </span>
          ) : null}
        </div>

        {/* The song's clock, in the corner opposite the legend: tempo, key,
            scale, meter. The lanes all read these three values, so they cannot
            live only in the workbench's settings strip. */}
        {effectiveSong ? (
          <PolyClockChip
            song={effectiveSong}
            bottom={shelfItems.length > 0 ? POLY_SHELF_H + 10 : 12}
            onChange={(patch) =>
              updateCurrentSong((current) => ({ ...current, ...patch }))
            }
          />
        ) : null}

        {/* The shelf itself — chrome along the bottom, outside the camera. */}
        <PolyShelfStrip items={shelfItems} onRestore={restoreFromShelf} />
      </div>

      {layout.nodes.length === 0 ? (
        <div className="absolute inset-0 grid place-items-center pointer-events-none">
          <div className="max-w-xs text-center text-xs text-inkMuted">
            <p className="mb-1 text-sm text-ink">Nothing on the canvas yet</p>
            <p>
              Add a section in the spine above — this surface projects the
              arrangement, it does not own it.
            </p>
          </div>
        </div>
      ) : null}
    </div>
  );
}
