import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  SCALE_INTERVALS,
  pitchClass,
  type ChordQuality,
  type NoteName,
  type ScaleType,
} from "@music-theory/core";
import type {
  BlueprintSection,
  BlueprintSong,
  Chord,
  TonicRegion,
} from "../../../types/blueprint";
import { sectionDurationBeats } from "../../../types/blueprint";
import type { HarmonyAnalysis } from "../../../lib/harmony/analysis";
import type { DetectedSection } from "../../../lib/harmony/segmentSections";
import { rootForStep, scaleStepSemitones } from "../../../lib/harmony/analysis";
import { setTonicAt } from "../../../lib/harmony/tonic";
import {
  withBass,
  withQuality,
  withSpreadToggled,
  withSubstitution,
} from "../../../lib/harmony/chordEdits";
import { nextPerformanceEffect } from "../../../lib/harmony/progressionEdits";
import {
  bassVoiceMarks,
  colorVoiceMarks,
} from "../../../lib/harmony/voiceLayers";
import {
  BARS_PER_VIEW_OPTIONS,
  type BarsPerView,
} from "../../drums/blocks/meterGrid";
import {
  floorBars,
  floorLength,
  floorSlotsFilled,
  removeChord,
  restsBetween,
  setRestAfter,
  FLOOR_STEP,
} from "../../../lib/harmony/floorLayout";
import {
  CAMERA_PRESETS,
  boxFaces,
  boxHeightForBeats,
  projectPoint,
  type SceneCamera,
  type Vec3,
} from "../../../lib/harmony/scene3d";
import { usePalette } from "../../../theme/palette";
import { useFocusedSectionStore } from "../../../store/focusedSectionStore";
import EffectsLane, { type EffectChip } from "./EffectsLane";
import VoicesLane from "./VoicesLane";
import {
  BEAT_Z,
  BOX_X,
  FOOT_H,
  FOOT_H_VOICES,
  STEP_W,
  computeFloorFit,
} from "./useFloorFit";
import { useFloorGestures, type Gesture } from "./useFloorGestures";
import { spellingReadings } from "./floorLabel";
import type { Node, Preview } from "./floorTypes";
import FloorBand, { type FloorExtension, type FloorPreset } from "./FloorBand";
import FloorScene from "./FloorScene";
import { ChordMenu, RestMenu } from "./FloorMenus";
import { SectionNameInput } from "./SectionNameInput";

/**
 * THE PROGRESSION FLOOR — the composition surface.
 *
 * One object, one grammar. A chord is a box on a floor: the vertical axis is
 * the twelve-step ladder (the seven in-key steps bright, the rest quiet), the
 * depth axis is time, and the space between boxes is silence.
 *
 *   drag a box            → ladder step (up/down) and time (left/right),
 *                           axis-locked;
 *                           dropping on empty floor opens a rest, dropping on
 *                           another chord swaps the two
 *   right edge            → length (pushes what follows)
 *   left edge             → trim (leaves the rest in front of it)
 *   drag a row            → any of the twelve semitones (the seven scale
 *                           steps are the bright rows, the rest are dim)
 *   right-click           → quality menu, anchored under the box
 *   drag the key chip     → transpose the song (⌥ = this section only)
 *   drag empty floor      → orbit · shift-drag → pan · wheel → zoom
 *
 * The camera opens on FRONT, where time is horizontal and degree is vertical,
 * so the drag is as close to 1:1 as 3D can get.
 */

const MIN_DEPTH = 14;
/** The plate's height is NOT fixed: it follows the window's content, so a
 *  wide 5-bar view is a short plate and a 1-bar zoom is a tall one. A fixed
 *  height is what made the grid look out of proportion to the chords. */
const VIEW_KEY = "trackdraft-harmony-bars-view";

/** Four bars is the honest default: a 4-bar section is the same as ALL, and
 *  a 12-bar one opens readable instead of showing 1300 units of time squeezed
 *  into a plate that is only seven rows tall. */
const DEFAULT_BARS_VIEW: BarsPerView = 4;

const FOOT_TAB_KEY = "trackdraft-harmony-foot-tab";

/** Which lane the foot band opens on. Remembered, because the overlay is the
 *  only place the generated voices are drawn: losing that to a reload looked
 *  exactly like the bass and colour layers had stopped working. */
function loadFootTab(): "effects" | "voices" {
  try {
    return localStorage.getItem(FOOT_TAB_KEY) === "voices"
      ? "voices"
      : "effects";
  } catch {
    return "effects";
  }
}

function loadBarsView(): BarsPerView {
  try {
    const raw = localStorage.getItem(VIEW_KEY);
    if (raw === "all") return "all";
    const n = Number(raw);
    return BARS_PER_VIEW_OPTIONS.includes(n as BarsPerView)
      ? (n as BarsPerView)
      : DEFAULT_BARS_VIEW;
  } catch {
    return DEFAULT_BARS_VIEW;
  }
}

export interface ProgressionFloorProps {
  /** The whole song, for the section dropdown (parity with the drums band). */
  sections: { id: string; name: string }[];
  sectionId: string;
  /** The section itself — the foot band's Voices tab edits its bass/colour
   *  profiles, which are section-scoped rather than per chord. */
  section: BlueprintSection;
  /** For the generated-voice overlay: the Bend style and narrative decide the
   *  chord spacing the bass line uses, so the marks need the same inputs the
   *  export gets. */
  song: BlueprintSong;
  chords: Chord[];
  analysis: HarmonyAnalysis;
  keyName: NoteName;
  scale: ScaleType;
  beatsPerBar: number;
  beatsPerChord: number;
  selectedChordId: string | null;
  activeChordId: string | null;
  regions: TonicRegion[];
  onChangeChords: (chords: Chord[]) => void;
  onSelectChord: (chordId: string | null) => void;
  onPreviewChord?: (chord: Chord) => void;
  onTranspose: (semitones: number, wholeSong: boolean) => void;
  onChangeRegions: (regions: TonicRegion[] | undefined) => void;
  /** Write the SECTION (bass/colour profiles) rather than its chords — what
   *  the foot band's Voices tab edits. */
  onChangeSection?: (
    updater: (section: BlueprintSection) => BlueprintSection,
  ) => void;
  /** A beat the next palette chord should fill — set by clicking a rest or
   *  empty floor, cleared as soon as the chord lands. */
  /** Place a chord: the floor resolves WHERE the click landed (a ladder step,
   *  its beat and its spelling), the desk decides what quality that means. */
  onPlaceChord: (
    degree: number,
    accidental: number,
    beat: number,
    span: number,
    spelling?: "sharp" | "flat",
  ) => void;
  /** This section's name — the starting value for an inline rename. */
  sectionName?: string;
  /** The swept-selection verbs: everything a bar range can mean, done here
   *  so the controls sit next to the bars instead of in a strip elsewhere. */
  onSplitSectionAtBar?: (bar: number) => void;
  /** Bars swept on the ruler, and the sweep itself. */
  barRange?: { from: number; to: number } | null;
  onBarRange?: (range: { from: number; to: number } | null) => void;
  /** Cut this section in two at a chord — the manual counterpart to the
   *  detected split. Absent on read-only surfaces. */
  onSplitSectionAt?: (chordId: string) => void;
  /** Glue this section onto the next one. Absent when there is no next. */
  onMergeWithNext?: (() => void) | null;
  /** Rename this section. Absent on read-only surfaces. */
  onRenameSection?: ((name: string) => void) | null;
  /** Desk-owned chrome, rendered inside the floor's own band/plate so the
   *  whole view stays one bounded page instead of a stack of blocks. */
  tools?: ReactNode;
  status?: ReactNode;
  /** Ghost boundaries for a proposed split (`segmentChordStream`). Null or
   *  absent means no preview is open. */
  segments?: readonly DetectedSection[] | null;
  /** Force the bar window instead of the saved preference. The multi-section
   *  strip needs every band showing all its bars, because a band that pages
   *  independently can't share a bar grid with its neighbours. */
  barsPerView?: BarsPerView;
  /** Bars before this section in the song, printed on the ruler so a band in
   *  the multi-section strip keeps the song's own bar numbers. */
  barOffset?: number;
  /** What a click on the ladder writes: the row's triad or its seventh. */
  extension: FloorExtension;
  onExtensionChange: (extension: FloorExtension) => void;
  /** What the section's groove glue would do to the chord onsets, in beats.
   *  Computed by the export's own pocket, so this is a preview, not a guess. */
  glue: {
    offsets: number[];
    strength: number;
    meanMs: number;
    slots: number;
  } | null;
}

export default function ProgressionFloor({
  sections,
  sectionId,
  section,
  song,
  chords,
  analysis,
  keyName,
  scale,
  beatsPerBar,
  beatsPerChord,
  selectedChordId,
  activeChordId,
  regions,
  onChangeChords,
  onSelectChord,
  onPreviewChord,
  onTranspose,
  onChangeRegions,
  onPlaceChord,
  sectionName,
  barRange,
  onBarRange,
  onSplitSectionAtBar,
  onSplitSectionAt,
  onMergeWithNext,
  onRenameSection,
  barsPerView: forcedBarsView,
  barOffset,
  extension,
  onExtensionChange,
  glue,
  tools,
  status,
  segments,
  onChangeSection,
}: ProgressionFloorProps) {
  const P = usePalette();
  const frameRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const gesture = useRef<Gesture | null>(null);

  const [camera, setCamera] = useState<SceneCamera>(CAMERA_PRESETS.front);
  const [preset, setPreset] = useState<FloorPreset>("front");
  /** FRONT is a locked camera: the scene cannot be tilted by accident, so a
   *  stray drag places a chord instead of swinging the room. Tilt is opt-in. */
  const locked = preset === "front";
  const [preview, setPreview] = useState<Preview | null>(null);
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(
    null,
  );
  /** Inline rename from the swept-bar overlay: the draft name while typing. */
  const [sweepRenaming, setSweepRenaming] = useState(false);
  const [restMenu, setRestMenu] = useState<{
    beat: number;
    x: number;
    y: number;
  } | null>(null);
  const [width, setWidth] = useState(900);
  const [readout, setReadout] = useState(
    "drag a chord · up and down walks the twelve steps · right-click for quality",
  );
  const [tonicSteps, setTonicSteps] = useState(0);
  const [showGlue, setShowGlue] = useState(true);
  /** The foot band is editable now, not a readout: one lane at a time. */
  const [footTab, setFootTab] = useState<"effects" | "voices">(loadFootTab);
  const footH = footTab === "voices" ? FOOT_H_VOICES : FOOT_H;
  const plateRef = useRef<HTMLDivElement>(null);
  const [stageH, setStageH] = useState(420);
  const [storedBarsView, setStoredBarsView] =
    useState<BarsPerView>(loadBarsView);
  const barsPerView = forcedBarsView ?? storedBarsView;
  const [firstBar, setFirstBar] = useState(0);
  const setSelectedSectionId = useFocusedSectionStore(
    (state) => state.setSelectedSectionId,
  );

  /**
   * The plate owns the rest of the viewport. Measured from the plate's own top
   * edge against the app's scroll container, so anything above it changing
   * height (a band wrapping onto two lines, the spine growing a section)
   * re-fits the floor instead of pushing it off screen.
   */
  useEffect(() => {
    const plate = plateRef.current;
    if (!plate) return;
    const host =
      (plate.closest("main") as HTMLElement | null) ?? document.documentElement;

    const measure = () => {
      const hostRect =
        host === document.documentElement ? null : host.getBoundingClientRect();
      const top = plate.getBoundingClientRect().top;
      const bottom = hostRect ? hostRect.bottom : window.innerHeight;
      // Leave room for the readout row under the plate.
      const available = Math.round(bottom - top - 44);
      setStageH((current) => {
        const next = Math.max(280, Math.min(1100, available));
        return Math.abs(next - current) > 1 ? next : current;
      });
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(host);
    observer.observe(plate.parentElement ?? plate);
    window.addEventListener("resize", measure);
    // One deferred pass: fonts and the spine settle after the first paint.
    const settle = window.setTimeout(measure, 90);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
      window.clearTimeout(settle);
    };
  }, []);

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const observer = new ResizeObserver(() =>
      setWidth(frame.clientWidth || 900),
    );
    setWidth(frame.clientWidth || 900);
    observer.observe(frame);
    return () => observer.disconnect();
  }, []);

  const cycleBeats = useMemo(() => floorLength(chords), [chords]);
  /**
   * How much time the section actually holds. The BARS are authoritative: the
   * chord list is one pass through the progression and the players loop it to
   * fill the section, so a 25-beat progression in a 7-bar section really does
   * come back to chord one for its last three beats. Never shorter than one
   * pass, though — a chord just written must not fall off the plate.
   */
  const spanBeats = Math.max(sectionDurationBeats(section), cycleBeats);
  const slots = useMemo(
    () => floorSlotsFilled(chords, spanBeats),
    [chords, spanBeats],
  );
  const rests = useMemo(() => restsBetween(chords), [chords]);
  /** The plate's own width in beats: the span, plus drop room past the last
   *  chord (the drums' bars-per-view model, on a harmony grid). */
  const bars = floorBars(chords, section);
  const barsShown = barsPerView === "all" ? bars : Math.min(bars, barsPerView);
  const lastFirstBar = Math.max(0, bars - barsShown);
  const windowFirstBar = Math.min(Math.max(0, firstBar), lastFirstBar);
  const windowBeats = barsShown * beatsPerBar;
  const windowStart = windowFirstBar * beatsPerBar;
  /** Every beat becomes a z coordinate inside the current window. */
  const zOf = useCallback(
    (beat: number) => (beat - windowStart) * BEAT_Z,
    [windowStart],
  );

  /** Boxes on the floor: x = semitones above the tonic, y = height, z = time. */
  const nodes = useMemo<Node[]>(() => {
    const tonic = pitchClass(keyName);
    return slots.map((slot) => {
      const event = analysis.events[slot.index];
      const beats = Math.max(FLOOR_STEP, slot.end - slot.start);
      const depth = Math.max(MIN_DEPTH, beats * BEAT_Z - 3);
      const height = boxHeightForBeats(beats);
      const step = (((pitchClass(slot.chord.root) - tonic) % 12) + 12) % 12;
      return {
        chord: slot.chord,
        index: slot.index,
        start: slot.start,
        beats,
        step,
        degree: event?.degree ?? 0,
        accidental: event?.accidental ?? 0,
        center: {
          x: step * STEP_W,
          y: height / 2,
          z: zOf(slot.start) + depth / 2,
        },
        size: { x: BOX_X, y: height, z: depth },
        pass: slot.pass ?? 0,
      };
    });
  }, [slots, analysis, zOf, keyName]);

  const selectedNode =
    nodes.find((node) => node.chord.id === selectedChordId) ?? null;

  /**
   * Only the window is painted. A 77-bar section holds 87 chords and every one
   * of them used to cost three polygons plus a label — hundreds of nodes drawn
   * off the right edge so the plate went muddy at the boundary and the browser
   * paid for boxes nobody could see.
   */
  const visibleNodes = useMemo(
    () =>
      nodes.filter(
        (node) =>
          node.start + node.beats > windowStart + 0.001 &&
          node.start < windowStart + windowBeats - 0.001,
      ),
    [nodes, windowStart, windowBeats],
  );

  const fit = useMemo(
    () =>
      computeFloorFit({
        camera,
        width,
        windowBeats,
        windowStart,
        nodes,
        stageH,
        locked,
        barsShown,
        beatsPerBar,
        footHeight: footH,
      }),
    [
      camera,
      width,
      windowBeats,
      windowStart,
      nodes,
      stageH,
      locked,
      barsShown,
      beatsPerBar,
      footH,
    ],
  );

  // Memoised: these two are in the dependency list of every projection
  // callback, so rebuilding them each render rebuilt (and re-ran) the whole
  // scene on any state change — a selection, a hover, a readout string.
  const renderCamera = useMemo<SceneCamera>(
    () => ({
      ...camera,
      zoom: camera.zoom * fit.zoom,
      scaleY: fit.scaleY,
      panX: 0,
      panY: 0,
    }),
    [camera, fit.zoom, fit.scaleY],
  );
  const origin = useMemo(
    () => ({ x: fit.origin.x + camera.panX, y: fit.origin.y + camera.panY }),
    [fit.origin.x, fit.origin.y, camera.panX, camera.panY],
  );

  const project = useCallback(
    (point: Vec3) => projectPoint(point, renderCamera, origin),
    [renderCamera, origin],
  );

  /** Put a chord on a ladder step, naming the pitch the way the author meant. */
  function withPitch(
    chord: Chord,
    step: number,
    spelling?: "sharp" | "flat",
  ): Chord {
    const natural = (SCALE_INTERVALS[scale] ?? SCALE_INTERVALS.ionian).includes(
      step % 12,
    );
    return {
      ...chord,
      root: rootForStep(keyName, scale, step, spelling),
      spelling: natural ? undefined : (spelling ?? "flat"),
    };
  }

  const {
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onContextMenu,
    onWheel,
    onTonicPointerDown,
  } = useFloorGestures(
    {
      svgRef,
      frameRef,
      width,
      height: fit.height,
      locked,
      nodes,
      slots,
      rests,
      chords,
      analysis,
      keyName,
      scale,
      beatsPerChord,
      cycleBeats,
      renderCamera,
      origin,
      project,
    },
    {
      setPreview,
      setReadout,
      setMenu,
      setRestMenu,
      setCamera,
      setPreset,
      setFirstBar,
      onSelectChord,
      onChangeChords,
      onPreviewChord,
      onPlaceChord,
      onTranspose,
    },
    { barsPerView, windowFirstBar, lastFirstBar },
    gesture,
  );

  /**
   * Sweeping bars on the ruler. The bars are SVG rects in the same scene as
   * the chords, so the drag reads whatever bar is under the pointer — no
   * second copy of the layout, no separate surface to keep in sync.
   */
  function beginBarSweep(bar: number, event: React.PointerEvent) {
    if (!onBarRange) return;
    event.preventDefault();
    const anchor = bar;
    onBarRange({ from: anchor, to: anchor });
    // Read the bar spans once: hit-testing by x keeps the sweep working even
    // when the sweep's own controls or a chord box sit over the ruler.
    const spans = Array.from(document.querySelectorAll("[data-ruler-bar]")).map(
      (rect) => {
        const box = rect.getBoundingClientRect();
        return {
          bar: Number(rect.getAttribute("data-ruler-bar")),
          left: box.left,
          right: box.right,
        };
      },
    );
    const move = (moveEvent: PointerEvent) => {
      const under = spans.find(
        (span) =>
          moveEvent.clientX >= span.left && moveEvent.clientX < span.right,
      );
      if (!under) return;
      onBarRange({
        from: Math.min(anchor, under.bar),
        to: Math.max(anchor, under.bar),
      });
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  function applyQuality(chordId: string, quality: ChordQuality) {
    onChangeChords(
      chords.map((chord) =>
        chord.id === chordId ? withQuality(chord, quality) : chord,
      ),
    );
    setMenu(null);
    const chord = chords.find((candidate) => candidate.id === chordId);
    if (chord) onPreviewChord?.({ ...chord, quality });
  }

  /** Respell the SAME pitch — ♯III or ♭IV. Never moves the box. */
  function applySpelling(chordId: string, spelling: "sharp" | "flat") {
    const node = nodes.find((candidate) => candidate.chord.id === chordId);
    if (!node) return;
    onChangeChords(
      chords.map((chord) =>
        chord.id === chordId ? withPitch(chord, node.step, spelling) : chord,
      ),
    );
    setMenu(null);
  }

  function applyRest(chordId: string, beats: number) {
    const node = nodes.find((candidate) => candidate.chord.id === chordId);
    if (!node) return;
    const current = Math.max(
      0,
      (slots[node.index + 1]?.start ?? node.start + node.beats) -
        (node.start + node.beats),
    );
    onChangeChords(setRestAfter(chords, chordId, Math.max(0, current + beats)));
  }

  const previewNode = preview
    ? (nodes.find((node) => node.chord.id === preview.id) ?? null)
    : null;

  const faces = useMemo(() => {
    const list: {
      face: ReturnType<typeof boxFaces>[number];
      node: Node;
      isPreview: boolean;
    }[] = [];
    for (const node of visibleNodes) {
      for (const face of boxFaces(
        node.center,
        node.size,
        renderCamera,
        origin,
      )) {
        list.push({ face, node, isPreview: false });
      }
    }
    if (previewNode && preview) {
      const step = preview.step ?? previewNode.step;
      const beats = preview.beats ?? previewNode.beats;
      const depth = Math.max(MIN_DEPTH, beats * BEAT_Z - 3);
      const height = boxHeightForBeats(beats);
      const start = preview.start ?? previewNode.start;
      const center = {
        x: step * STEP_W,
        y: height / 2,
        z: zOf(start) + depth / 2,
      };
      for (const face of boxFaces(
        center,
        { x: BOX_X, y: height, z: depth },
        renderCamera,
        origin,
      )) {
        list.push({ face, node: previewNode, isPreview: true });
      }
    }
    list.sort((left, right) => left.face.depth - right.face.depth);
    return list;
  }, [visibleNodes, renderCamera, origin, preview, previewNode, zOf]);

  const path = visibleNodes
    .slice()
    .sort((left, right) => left.start - right.start)
    .map((node) => project(node.center))
    .map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`)
    .join(" ");

  /** Pixels between two ladder rows and between two bar lines. Everything that
   *  prints a label thins itself off this: at ALL on a 77-bar section the rows
   *  are five pixels apart and 87 numerals turn the chart into a grey band. */
  const density = useMemo(() => {
    const a = projectPoint({ x: 0, y: 0, z: 0 }, renderCamera, origin);
    const b = projectPoint({ x: STEP_W, y: 0, z: 0 }, renderCamera, origin);
    const c = projectPoint(
      { x: 0, y: 0, z: beatsPerBar * BEAT_Z },
      renderCamera,
      origin,
    );
    // The SCALED pitch: rows wear the vertical scale, bars don't.
    return {
      rowPx: Math.abs(b.y - a.y) * fit.scaleY,
      barPx: Math.abs(c.x - a.x),
    };
  }, [renderCamera, origin, beatsPerBar, fit.scaleY]);

  const rulerStep = Math.max(1, Math.ceil(18 / Math.max(1, density.barPx)));

  /**
   * The foot band's per-chord slots — projected from the SAME camera and
   * origin as the boxes above, so a chip is physically under its chord and a
   * click lands on what the eye pointed at.
   */
  const effectChips = useMemo<EffectChip[]>(
    () =>
      visibleNodes.map((node) => ({
        key: `${node.chord.id}-${node.start}`,
        chordId: node.chord.id,
        x0: project({ x: 0, y: 0, z: node.start * BEAT_Z }).x,
        x1: project({ x: 0, y: 0, z: (node.start + node.beats) * BEAT_Z }).x,
        style: node.chord.performance?.style,
        roman: analysis.events[node.index]?.roman ?? "",
      })),
    [visibleNodes, project, analysis],
  );

  /**
   * The Voices overlay: only while that tab is open, and only in the locked
   * front view — with 2-5 marks per chord the tilted views would collide, and
   * the overlay exists to be read against the pitch axis, which the front view
   * is the one that shows straight.
   */
  const voicesOverlay = useMemo(() => {
    if (footTab !== "voices" || !locked) return null;
    // The marks and the boxes are resolved from the same tiled pass, so there
    // is exactly one mark per box — the loop's partial final repeat included.
    return {
      bass: bassVoiceMarks(section, keyName, song),
      color: colorVoiceMarks(section, keyName, song),
    };
  }, [footTab, locked, section, keyName, song]);

  /** none → strum → pulse → arp → none, one undo step per click. */
  const cycleEffect = useCallback(
    (chordId: string) => {
      onChangeChords(
        chords.map((chord) =>
          chord.id === chordId
            ? {
                ...chord,
                performance: nextPerformanceEffect(chord.performance),
              }
            : chord,
        ),
      );
    },
    [chords, onChangeChords],
  );

  const tonicSemitones = scaleStepSemitones(scale, tonicSteps);
  const activeRegions = regions.filter(
    (region) => region.source === "authored",
  ).length;

  return (
    <div ref={frameRef} className="relative">
      <FloorBand
        keyName={keyName}
        scale={scale}
        tonicSteps={tonicSteps}
        tonicSemitones={tonicSemitones}
        onTonicPointerDown={(event) => onTonicPointerDown(event, setTonicSteps)}
        homeRoot={selectedNode?.chord.root ?? null}
        onHome={() => {
          if (!selectedNode) return;
          onChangeRegions(
            setTonicAt(regions, {
              startBeat: selectedNode.start,
              key: selectedNode.chord.root,
              scale,
            }),
          );
          setReadout(
            `home from beat ${selectedNode.start + 1} · ${selectedNode.chord.root}`,
          );
        }}
        onFollow={() => {
          onChangeRegions(undefined);
          setReadout("following the chords — inference picks the homes again");
        }}
        activeRegions={activeRegions}
        sections={sections}
        sectionId={sectionId}
        onSectionChange={(id) => {
          setSelectedSectionId(id);
          setFirstBar(0);
        }}
        barsPerView={barsPerView}
        onBarsViewChange={(view) => {
          setStoredBarsView(view);
          setFirstBar(0);
          try {
            localStorage.setItem(VIEW_KEY, String(view));
          } catch {
            /* a view preference is never worth breaking the floor over */
          }
        }}
        bars={bars}
        barsShown={barsShown}
        windowFirstBar={windowFirstBar}
        lastFirstBar={lastFirstBar}
        onFirstBar={setFirstBar}
        extension={extension}
        onExtensionChange={onExtensionChange}
        preset={preset}
        onPresetChange={(next) => {
          setCamera(CAMERA_PRESETS[next]);
          setPreset(next);
        }}
        locked={locked}
        onMergeWithNext={onMergeWithNext}
        onRenameSection={onRenameSection}
        chordCount={chords.length}
        cycleBeats={cycleBeats}
        tools={tools}
      />

      <div
        ref={plateRef}
        className="relative overflow-hidden rounded border border-edge bg-deep"
        style={{ height: fit.height }}
      >
        {barRange && onBarRange && (
          <div className="pointer-events-auto absolute left-2 top-6 z-20 flex items-center gap-1 rounded border border-accent/70 bg-panel/95 px-1 py-0.5 font-mono text-[9px] text-accent shadow">
            <span className="tabular-nums">
              bar{barRange.from === barRange.to ? "" : "s"} {barRange.from + 1}
              {barRange.from === barRange.to ? "" : `–${barRange.to + 1}`}
            </span>
            {onSplitSectionAtBar && (
              <button
                type="button"
                disabled={barRange.from === 0}
                onClick={() => {
                  onSplitSectionAtBar(barRange.from);
                  onBarRange(null);
                }}
                title="Start a new section at this bar"
                className="rounded border border-accent/60 px-1 disabled:opacity-40"
              >
                separate
              </button>
            )}
            {onMergeWithNext && (
              <button
                type="button"
                onClick={() => {
                  onMergeWithNext();
                  onBarRange(null);
                }}
                title="Glue this section onto the next one"
                className="rounded border border-accent/60 px-1"
              >
                merge next
              </button>
            )}
            {onRenameSection && !sweepRenaming && (
              <button
                type="button"
                onClick={() => setSweepRenaming(true)}
                title="Rename this section"
                className="rounded border border-accent/60 px-1"
              >
                rename
              </button>
            )}
            {onRenameSection && sweepRenaming && (
              <SectionNameInput
                name={sectionName ?? ""}
                onCommit={(name) => {
                  onRenameSection(name);
                  setSweepRenaming(false);
                  onBarRange(null);
                }}
                onCancel={() => setSweepRenaming(false)}
                className="w-28 rounded border border-accent bg-panel px-1 py-0 text-[9px] text-ink outline-none"
              />
            )}
            <button
              type="button"
              onClick={() => {
                setSweepRenaming(false);
                onBarRange(null);
              }}
              title="Clear the bar selection"
              className="rounded border border-accent/60 px-1"
            >
              ×
            </button>
          </div>
        )}
        <FloorScene
          svgRef={svgRef}
          width={width}
          height={fit.height}
          fit={fit}
          palette={P}
          project={project}
          zOf={zOf}
          beatsPerBar={beatsPerBar}
          windowStart={windowStart}
          windowFirstBar={windowFirstBar}
          barOffset={barOffset}
          barRange={barRange ?? null}
          onBarPointerDown={beginBarSweep}
          scale={scale}
          rests={rests}
          segments={segments}
          cycleBeats={cycleBeats}
          density={density}
          rulerStep={rulerStep}
          path={path}
          faces={faces}
          visibleNodes={visibleNodes}
          selectedChordId={selectedChordId}
          activeChordId={activeChordId}
          analysis={analysis}
          voices={voicesOverlay}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onContextMenu={onContextMenu}
          onWheel={onWheel}
        />

        {/* The foot band. It used to be a tension readout, which on a real song
          was a flat 0.50 line for 86% of its chords — 46px of the primary
          canvas spent saying "nothing happening". Tension still exists: it is
          drawn ON the chord boxes (a hot box glows) and fully in Study. This
          space is now editable. */}
        <div
          className="absolute inset-x-0 bottom-0 flex flex-col border-t border-edge/60 bg-deep"
          style={{ height: footH }}
        >
          <div className="flex shrink-0 items-center gap-0.5 px-2 pt-0.5 font-mono text-[9px] uppercase tracking-[0.1em]">
            {(["effects", "voices"] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                aria-pressed={footTab === tab}
                onClick={() => {
                  setFootTab(tab);
                  try {
                    localStorage.setItem(FOOT_TAB_KEY, tab);
                  } catch {
                    /* a view preference is never worth breaking the floor over */
                  }
                }}
                className={`rounded px-1.5 py-0.5 ${
                  footTab === tab
                    ? "bg-panel text-ink"
                    : "text-inkMuted/60 hover:text-ink"
                }`}
                title={
                  tab === "effects"
                    ? "Each chord's performance: none · strum · pulse · arp — click a chord to cycle"
                    : "This section's generated voices: bass register/motion/rhythm, and the colour layer"
                }
              >
                {tab}
              </button>
            ))}
            <span className="ml-auto normal-case tracking-normal text-inkMuted/50">
              {footTab === "effects"
                ? "click a chord to cycle none · strum · pulse · arp — a glowing box is high tension"
                : locked
                  ? "bars are the bass line · one circle per chord, on its colour chord's row"
                  : "voices draw in the front view — the tilted views would collide them"}
            </span>
          </div>
          <div className="min-h-0 flex-1">
            {footTab === "effects" ? (
              <EffectsLane
                chips={effectChips}
                width={Math.max(320, width)}
                height={footH - 18}
                onCycle={cycleEffect}
              />
            ) : onChangeSection ? (
              <VoicesLane section={section} onChange={onChangeSection} />
            ) : null}
          </div>
        </div>
      </div>

      <div className="mt-1.5 flex flex-wrap items-center gap-2 font-mono text-[9px] text-inkMuted/70">
        <span className="text-ink">{readout}</span>
        <span className="flex-1" />
        {status}
        {glue ? (
          <button
            type="button"
            aria-pressed={showGlue}
            onClick={() => setShowGlue(!showGlue)}
            title="Groove glue — the drums' pocket nudges each chord onset. Shown as the dashed tick at every box."
            className={`rounded border px-1.5 py-0.5 ${showGlue ? "border-accent bg-accent/15 text-accent" : "border-edge hover:text-ink"}`}
          >
            {(() => {
              const moving = glue.offsets.filter(
                (offset) => Math.abs(offset) > 0.0005,
              );
              const worst = moving.length
                ? Math.round(Math.max(...moving.map(Math.abs)) * 500)
                : 0;
              return moving.length === 0
                ? `⛓ glue C ${Math.round(glue.strength * 100)}% · your onsets sit on the pocket`
                : `⛓ glue C ${Math.round(glue.strength * 100)}% · ${moving.length}/${glue.offsets.length} onsets move · worst ${worst}ms`;
            })()}
          </button>
        ) : (
          <span title="No groove glue on this section — the drums' pocket is not moving the chords">
            ⛓ glue off
          </span>
        )}
        {beatsPerChord > 0 && <span>{beatsPerChord}b per chord</span>}
      </div>

      {restMenu && (
        <RestMenu
          beat={restMenu.beat}
          x={restMenu.x}
          y={restMenu.y}
          chords={chords}
          onChangeChords={onChangeChords}
          onClose={() => setRestMenu(null)}
          onReadout={setReadout}
        />
      )}

      {menu &&
        (() => {
          const node = nodes.find(
            (candidate) => candidate.chord.id === menu.id,
          );
          if (!node) return null;
          const event = analysis.events[node.index];
          return (
            <ChordMenu
              node={node}
              event={event}
              x={menu.x}
              y={menu.y}
              keyName={keyName}
              scale={scale}
              onQuality={(quality) => applyQuality(menu.id, quality)}
              onBass={(inversion) => {
                onChangeChords(
                  chords.map((chord) =>
                    chord.id === menu.id ? withBass(chord, inversion) : chord,
                  ),
                );
                setMenu(null);
              }}
              onToggleSpread={() => {
                onChangeChords(
                  chords.map((chord) =>
                    chord.id === menu.id ? withSpreadToggled(chord) : chord,
                  ),
                );
                setMenu(null);
              }}
              onSubstitution={(pick) => {
                onChangeChords(
                  chords.map((chord) =>
                    chord.id === menu.id
                      ? withSubstitution(chord, pick)
                      : chord,
                  ),
                );
                setMenu(null);
              }}
              spellings={(() => {
                if (
                  (SCALE_INTERVALS[scale] ?? SCALE_INTERVALS.ionian).includes(
                    node.step % 12,
                  )
                )
                  return null;
                const readings = spellingReadings(
                  keyName,
                  scale,
                  node.step,
                  node.chord.quality,
                );
                if (!readings.sharp || !readings.flat) return null;
                return { sharp: readings.sharp, flat: readings.flat };
              })()}
              activeSpelling={
                node.accidental < 0
                  ? "flat"
                  : node.accidental > 0
                    ? "sharp"
                    : null
              }
              onSpelling={(spelling) => applySpelling(menu.id, spelling)}
              onNudgeRest={(delta) => applyRest(menu.id, delta)}
              onDelete={() => {
                onChangeChords(removeChord(chords, menu.id));
                onSelectChord(null);
                setMenu(null);
              }}
              onRunUp={(span) => {
                onPlaceChord(
                  node.degree,
                  node.accidental,
                  Math.max(0, node.start - span),
                  span,
                );
                setMenu(null);
                setReadout(
                  `run up: ${span}b before ${event?.roman ?? "this chord"}`,
                );
              }}
              onRehome={() => {
                // The same pitches, counted from this chord instead. Nothing sounds different.
                onChangeRegions([
                  {
                    startBeat: node.start,
                    key: node.chord.root,
                    scale,
                    source: "authored",
                  },
                ]);
                setReadout(
                  `tonic region at beat ${node.start + 1} · ${node.chord.root}`,
                );
              }}
              onSplitHere={
                onSplitSectionAt
                  ? () => {
                      onSplitSectionAt(node.chord.id);
                      setReadout(`section starts at beat ${node.start + 1}`);
                    }
                  : undefined
              }
              onClose={() => setMenu(null)}
            />
          );
        })()}
    </div>
  );
}
