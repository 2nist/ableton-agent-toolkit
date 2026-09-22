import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { buildEuclideanOutline, twoThreeCellCounts } from "@drum/library";
import type { BlueprintSong, BlueprintSection, DrumTransitionModel, MeterOutline } from "../../types/blueprint";
import { beatsPerBar } from "../../types/blueprint";
import type { SectionSpan } from "../../lib/arrangement";
import { resolveSectionLaneHits } from "../../lib/timeline/drumLaneHits";
import { updateSection } from "../../lib/sections";
import { useSongStore } from "../../store/songStore";
import { useDrumsSelectionStore } from "../../store/drumsSelectionStore";
import { TRANSITION_COLOR, TRANSITION_LABEL, TRANSITION_MODELS } from "../drums/transitionStyle";

/** Eighth-note slots per bar for a section's meter — the default detour
 *  grid (8 for 4/4, 7 for 7/8). Mirrors DrumsView's own private helper. */
function eighthNoteNumerator(sec: Pick<BlueprintSection, "timeSignatureNumerator" | "timeSignatureDenPower">): number {
  return sec.timeSignatureNumerator * (8 / 2 ** sec.timeSignatureDenPower);
}

/** A sensible default detour outline — the same shape the classic view's
 *  beat-dot click produces (its private `defaultDetourFor`), so placing a
 *  detour here has a real fill to shape in the Detour editor right away. */
function defaultDetourFor(sec: BlueprintSection): MeterOutline {
  const num = eighthNoteNumerator(sec);
  return buildEuclideanOutline(num, 8, twoThreeCellCounts(num)[0] ?? 3, 0);
}

const MENU_ITEM = "w-full text-left px-2.5 py-1 font-mono text-[11px] text-inkMuted hover:text-ink hover:bg-panelAlt/60";

/**
 * The Drum Shape Strip — the Drums element's broad face in the workbench's
 * section workspace (the ladder's middle rung, user-specified 2026-09-21):
 * the focused section's WHOLE span edge to edge — every bar, so the
 * transition region and any internal detour are never cut out of view —
 * drawn as a hit-count / velocity shape (humps = busy loud bars, valleys =
 * sparse ones). The spine above is the broader still rung (the song's
 * arrangement); the Drums tab's Blocks editor is the rung below
 * (beat-by-beat), one click away via the drill button.
 *
 * Level-2 editing lives ON the shape:
 *  - click a mid-section bar → place / move a detour start there (creating
 *    a meter-default outline when none exists — same semantics as the
 *    classic view's beat-dot lane); click inside an existing detour
 *    (or its zone) → remove it.
 *  - click the end zone → transition palette (Auto fill / Build up /
 *    Break down / Cut / Drop out + tail length) writing
 *    `drumTransitionModel` / `drumTransitionBars`.
 *  Every write goes through `updateSection` — one undo step each, and the
 *  rail/exports see it immediately because it's the same store write
 *  everything else uses.
 *
 * Deliberately bar-granular: this is the BROAD rung. Beat precision is the
 * Dock's Detour/Transition tabs; the beat grid is the Blocks editor.
 */
export default function DrumShapeStrip({ song, span }: { song: BlueprintSong; span: SectionSpan }) {
  const navigate = useNavigate();
  const { songId } = useParams<{ songId: string }>();
  const id = songId ?? song.id;
  const updateSong = useSongStore((s) => s.updateCurrentSong);
  const setDrumsSection = useDrumsSelectionStore((s) => s.setSelectedSectionId);

  const section: BlueprintSection = span.section;
  const bpb = beatsPerBar(section);
  const barCount = Math.max(1, Math.round(span.bars));
  const duration = barCount * bpb;

  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  /** Per-bar hit count + average velocity — the humps and valleys. Data is
   *  the export-parity hit resolution (base groove + authored blocks), so
   *  the shape shows what will actually play, not a mock. */
  const energy = useMemo(() => {
    const hits = resolveSectionLaneHits(section, song, span.occurrenceIndex);
    const per = Array.from({ length: barCount }, () => ({ count: 0, velSum: 0 }));
    for (const arr of hits.values()) {
      for (const h of arr) {
        const b = Math.min(barCount - 1, Math.max(0, Math.floor(h.beat / bpb)));
        per[b].count += 1;
        per[b].velSum += h.velocity;
      }
    }
    const any = per.some((e) => e.count > 0);
    return { per, any };
  }, [section, song, span.occurrenceIndex, barCount, bpb]);
  const maxCount = Math.max(1, ...energy.per.map((e) => e.count));

  // Detour span in beats — defaults to the section tail exactly like the
  // export does when no start is authored.
  const detourOutline = section.drumVariationOutline ?? null;
  const detourBars = section.drumVariationBars ?? 1;
  const detourStart = Math.max(0, Math.min(duration - 1e-6, section.drumVariationStartBeat ?? duration - detourBars * bpb));
  const detourEnd = Math.min(duration, detourStart + detourBars * bpb);

  // Transition region — the last `drumTransitionBars` bars.
  const tBars = Math.max(1, section.drumTransitionBars ?? 1);
  const tStart = Math.max(0, duration - tBars * bpb);
  const tModel: DrumTransitionModel | null = section.drumTransitionModel ?? null;

  function write(fn: (sec: BlueprintSection) => BlueprintSection) {
    updateSong((s) => updateSection(s, section.id, fn));
  }

  /** Bar click: inside the detour → remove it; anywhere else → place/move
   *  the detour start to that bar (default outline when none exists). */
  function onBarClick(barIdx: number) {
    const beat = barIdx * bpb;
    if (detourOutline != null && beat >= detourStart - 1e-6 && beat < detourEnd - 1e-6) {
      write((x) => ({
        ...x,
        drumVariationOutline: undefined,
        drumVariationBars: undefined,
        drumVariationStartBeat: undefined,
      }));
      return;
    }
    write((x) => ({
      ...x,
      drumVariationOutline: x.drumVariationOutline ?? defaultDetourFor(x),
      drumVariationStartBeat: beat,
    }));
  }

  function setTransition(model: DrumTransitionModel | null) {
    write((x) => ({
      ...x,
      drumTransitionModel: model ?? undefined,
      drumTransitionBars: model ? (x.drumTransitionBars ?? 1) : undefined,
    }));
  }
  function bumpTransitionBars(delta: number) {
    write((x) => ({ ...x, drumTransitionBars: Math.max(1, Math.min(8, (x.drumTransitionBars ?? 1) + delta)) }));
  }

  /** Level 3 in one click: stage the section into the drums selection and
   *  open the Blocks editor (the persisted view mode picks it up on mount). */
  function openBeatByBeat() {
    localStorage.setItem("trackdraft-drums-view", "blocks");
    setDrumsSection(section.id);
    navigate(`/song/${id}/drums`);
  }

  // Palette closes on outside press / Esc / scroll (the spine's pattern).
  useEffect(() => {
    if (!menu) return;
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && e.target instanceof Node && menuRef.current.contains(e.target)) return;
      setMenu(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenu(null);
    };
    const onScroll = () => setMenu(null);
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [menu]);

  const pct = (beats: number) => `${(beats / duration) * 100}%`;

  return (
    <div className="w-full">
      {/* Caption row: the gesture legend + the drill-down door */}
      <div className="flex items-center gap-2 mb-1 px-0.5">
        <span className="text-[9px] font-mono text-inkMuted/50 truncate">
          click a bar → detour · click the end → transition · humps = busy
        </span>
        <span className="flex-1" />
        <button
          type="button"
          className="shrink-0 text-[9px] font-mono text-accent/80 hover:text-accent border border-edge/70 rounded px-1.5 py-0.5"
          onClick={openBeatByBeat}
          title="Open the beat-by-beat editor (Drum Blocks) on this section"
        >
          beat-by-beat →
        </button>
      </div>

      {/* The shape — section edge to edge, bar-linear */}
      <div className="relative h-[64px] rounded-md border border-edge/60 bg-panelAlt/20 overflow-hidden select-none">
        {/* Bar grid */}
        {Array.from({ length: barCount }, (_, i) =>
          i > 0 ? (
            <div key={`g${i}`} className="absolute top-0 bottom-0 w-px bg-edge/40" style={{ left: pct(i * bpb) }} />
          ) : null,
        )}

        {/* Energy columns — height = hit count, opacity = avg velocity */}
        <div className="absolute inset-0 flex items-end">
          {energy.per.map((e, i) => {
            const h = e.count === 0 ? 3 : 6 + (e.count / maxCount) * 46;
            const a = e.count === 0 ? 0.08 : 0.3 + ((e.velSum / e.count) / 127) * 0.45;
            return (
              <button
                key={i}
                type="button"
                className="relative flex-1 min-w-0 h-full group"
                onClick={() => onBarClick(i)}
                title={`bar ${i + 1} — ${e.count} hit${e.count === 1 ? "" : "s"}${
                  e.count ? ` · avg vel ${Math.round(e.velSum / e.count)}` : ""
                }${detourOutline != null && i * bpb >= detourStart - 1e-6 && i * bpb < detourEnd - 1e-6 ? " · detour" : ""}`}
              >
                <span
                  className="absolute bottom-0 left-[1px] right-[1px] rounded-t-[3px] bg-ink group-hover:bg-accent transition-colors"
                  style={{ height: h, opacity: a }}
                />
              </button>
            );
          })}
        </div>

        {/* Detour zone — a hump bracket over its span; click to remove */}
        {detourOutline && (
          <button
            type="button"
            className="absolute top-0 bottom-0 border-t-2 border-dashed border-inkMuted/60 bg-ink/10 hover:bg-ink/20"
            style={{ left: pct(detourStart), width: pct(detourEnd - detourStart) }}
            onClick={(e) => {
              e.stopPropagation();
              onBarClick(Math.floor(detourStart / bpb));
            }}
            title={`Detour — ${detourOutline.label ?? "outline"} · ${detourBars} bar${detourBars === 1 ? "" : "s"} from bar ${Math.floor(detourStart / bpb) + 1}. Click to remove (undoable).`}
          >
            <span className="absolute left-1 top-0.5 text-[8px] font-mono px-1 rounded bg-black/50 text-ink whitespace-nowrap pointer-events-none">
              ⤴ detour · {detourOutline.label ?? "outline"}
            </span>
          </button>
        )}

        {/* Transition zone — the section tail; click to shape */}
        <button
          type="button"
          className="absolute top-0 bottom-0"
          style={{
            left: pct(tStart),
            width: pct(duration - tStart),
            background: tModel ? `${TRANSITION_COLOR[tModel]}33` : "transparent",
            borderLeft: `1px dashed ${tModel ? TRANSITION_COLOR[tModel] : "rgba(138,132,150,0.5)"}`,
            boxShadow: tModel ? `inset 0 -2px 0 0 ${TRANSITION_COLOR[tModel]}` : undefined,
          }}
          onClick={(e) => {
            e.stopPropagation();
            setMenu({ x: Math.min(e.clientX, window.innerWidth - 220), y: Math.min(e.clientY, window.innerHeight - 210) });
          }}
          title={
            tModel
              ? `${TRANSITION_LABEL[tModel]} · ${tBars} bar${tBars === 1 ? "" : "s"} — click to edit`
              : "Auto fill plays here unless you author a transition — click to shape it"
          }
        >
          <span
            className="absolute right-1 top-0.5 text-[8px] font-mono px-1 rounded bg-black/50 whitespace-nowrap pointer-events-none"
            style={{ color: tModel ? TRANSITION_COLOR[tModel] : "rgba(138,132,150,0.9)" }}
          >
            {tModel ? `${TRANSITION_LABEL[tModel]} · ${tBars}b` : "auto fill"}
          </span>
        </button>
      </div>

      {/* Bar numbers */}
      <div className="flex mt-0.5">
        {Array.from({ length: barCount }, (_, i) => (
          <span key={i} className="flex-1 text-center text-[8px] font-mono text-inkMuted/40 tabular-nums">
            {barCount <= 24 || i % 2 === 0 ? i + 1 : ""}
          </span>
        ))}
      </div>

      {/* Transition palette */}
      {menu && (
        <div
          ref={menuRef}
          className="fixed z-50 min-w-[190px] rounded border border-edge bg-panel shadow-lg py-1"
          style={{ left: menu.x, top: menu.y }}
        >
          <p className="px-2.5 py-0.5 text-3xs font-mono uppercase tracking-widest text-inkMuted/60 truncate">
            Section tail · {section.name}
          </p>
          <button
            className={MENU_ITEM}
            onClick={() => {
              setMenu(null);
              setTransition(null);
            }}
          >
            Auto fill (none)
          </button>
          {TRANSITION_MODELS.map((m) => (
            <button
              key={m}
              className={`${MENU_ITEM} flex items-center gap-1.5`}
              onClick={() => {
                setMenu(null);
                setTransition(m);
              }}
            >
              <span className="w-2 h-2 rounded-full shrink-0" style={{ background: TRANSITION_COLOR[m] }} />
              {TRANSITION_LABEL[m]}
            </button>
          ))}
          {tModel && (
            <>
              <div className="my-1 border-t border-edge/60" />
              <div className="flex items-center gap-1.5 px-2.5 py-1 font-mono text-[11px] text-inkMuted">
                <span className="flex-1">Tail length</span>
                <button className="px-1.5 hover:text-ink" onClick={() => bumpTransitionBars(-1)}>
                  −
                </button>
                <span className="tabular-nums text-ink">{tBars}</span>
                <button className="px-1.5 hover:text-ink" onClick={() => bumpTransitionBars(1)}>
                  ＋
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
