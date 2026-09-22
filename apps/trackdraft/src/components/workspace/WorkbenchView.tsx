import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { pitchClass, NOTE_TO_PC } from "@music-theory/core";
import type { NoteName, ScaleType } from "@music-theory/core";
import { resolveChordOccurrences, resolveStyleProfile, styleSpacing } from "@drum/library";
import { useSongStore } from "../../store/songStore";
import { useStudioSelectionStore } from "../../store/studioSelectionStore";
import { sectionSpans, type SectionSpan } from "../../lib/arrangement";
import { roleStyle } from "../../lib/roleColors";
import { chordDisplayName } from "../../lib/harmony/chordBuilder";
import { drumFamilyLabel, resolveSectionVoiceNecklaces } from "../../lib/playback/drumPreview";
import { getSongTransport, type TransportTick } from "../../lib/playback/songTransport";
import DrumLineEmbed from "./DrumLineEmbed";
import { useInspectorStore } from "../../store/inspectorStore";
import HexReadout from "../harmony/HexReadout";
import NecklaceRow from "../drums/NecklaceRow";
import MelodyStaff from "../melody/MelodyStaff";
import type { BlueprintSection, BlueprintSong } from "../../types/blueprint";

/**
 * The Workbench — first slice of the new workspace (docs/design/workspace.md).
 *
 * Bands: zones row (library rail · section workspace · inspector rail).
 * The spine is shell chrome now (mounted by SongEditorLayout above every
 * song route — P2). Layout grammar (user decision, 2026-09-21): LEFT =
 * Library (the sources) · CENTER = the canvas · RIGHT = the contextual
 * INSPECTOR (the focused object's facets; it slides open on engagement
 * and collapses to a strip) · NO BOTTOM band (the old stub/dock role is
 * retired; wide surfaces belong to the canvas itself).
 *
 * Deliberately transitional: element rows jump to the existing editor tabs
 * (?section=) until P3 embeds them in place; the legacy nav tabs live
 * above until P4 retires them (the header transport already folded into
 * the spine's strip in P2).
 */
export default function WorkbenchView() {
  const currentSong = useSongStore((s) => s.currentSong());
  const navigate = useNavigate();
  const selectedSectionId = useStudioSelectionStore((s) => s.selectedSectionId);
  const setSelectedSectionId = useStudioSelectionStore((s) => s.setSelectedSectionId);
  const [tick, setTick] = useState<TransportTick | null>(null);

  useEffect(() => getSongTransport().onTick(setTick), []);

  const song = currentSong;
  const spans = useMemo(() => (song ? sectionSpans(song) : []), [song]);

  // The ladder's first navigation step: ←→ walks sections. Ignored while
  // typing / interacting with form controls (the bend rail's selects, the
  // song browser) so those stay usable.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "SELECT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      if (spans.length === 0) return;
      e.preventDefault();
      const idx = Math.max(0, spans.findIndex((sp) => sp.sectionId === selectedSectionId));
      const next = Math.max(0, Math.min(spans.length - 1, idx + (e.key === "ArrowRight" ? 1 : -1)));
      setSelectedSectionId(spans[next].sectionId);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [spans, selectedSectionId, setSelectedSectionId]);

  if (!song) {
    return (
      <div className="p-4">
        <p className="text-inkMuted">Song not found.</p>
        <button className="text-accent text-sm mt-2" onClick={() => navigate("/")}>
          ← Back to Dashboard
        </button>
      </div>
    );
  }

  const activeIndex = spans.length === 0 ? -1 : Math.max(0, spans.findIndex((sp) => sp.sectionId === selectedSectionId));
  const activeSpan = activeIndex >= 0 ? spans[activeIndex] : null;
  const isLive = activeSpan != null && tick?.isPlaying === true && tick.sectionIndex === activeIndex;
  const beatInSection = isLive && tick && activeSpan ? tick.beat - activeSpan.startBeat : null;

  return (
    <div className="h-full flex flex-col min-h-0">
      {/* The section workspace is the CANVAS — the library (left) and the
          inspector (right) are shell chrome around it since slice C, and
          the spine band above mounts in SongEditorLayout too. */}
      <div className="flex-1 flex min-h-0">
        <div className="flex-1 min-w-0 overflow-y-auto p-3">
          {activeSpan ? (
            <SectionWorkspace
              song={song}
              span={activeSpan}
              index={activeIndex}
              count={spans.length}
              isLive={isLive}
              beatInSection={beatInSection}
              onEngageDrums={() => useInspectorStore.getState().engage("drums")}
            />
          ) : (
            <div className="h-full flex items-center justify-center">
              <p className="text-inkMuted text-sm">This song has no sections yet — add the first one on the spine above, then pick it here.</p>
            </div>
          )}
        </div>

      </div>
    </div>
  );
}

/** One element row — title, hint, jump-open, centered content. Module
 *  scope so the transport-tick re-renders don't remount the content
 *  (same lesson as StudioConsole's Pane). */
function ElementRow({
  title,
  hint,
  onOpen,
  children,
}: {
  title: string;
  hint: string;
  onOpen: () => void;
  children: React.ReactNode;
}) {
  return (
    <section className="border border-edge rounded-lg bg-panel overflow-hidden">
      <header className="flex items-center gap-2 px-2.5 py-1.5 border-b border-edge/70">
        <span className="text-3xs font-mono uppercase tracking-widest text-inkMuted">{title}</span>
        <span className="text-[9px] font-mono text-inkMuted/50 truncate flex-1" title={hint}>
          {hint}
        </span>
        <button
          className="shrink-0 text-[9px] font-mono text-accent/80 hover:text-accent border border-edge/70 rounded px-1.5 py-0.5"
          onClick={onOpen}
          title={`Open the ${title.toLowerCase()} editor for this section`}
        >
          open →
        </button>
      </header>
      <div className="p-2.5 flex items-center justify-center min-h-[64px]">{children}</div>
    </section>
  );
}

/** Clicking the drum line view engages the inspector's ▦ Drums facet —
 *  the thing you touched becomes the thing you edit. */
type SectionWorkspaceProps = {
  song: BlueprintSong;
  span: SectionSpan;
  index: number;
  count: number;
  isLive: boolean;
  beatInSection: number | null;
  onEngageDrums?: () => void;
};

function SectionWorkspace({
  song,
  span,
  index,
  count,
  isLive,
  beatInSection,
  onEngageDrums,
}: SectionWorkspaceProps) {
  const navigate = useNavigate();
  const { songId } = useParams<{ songId: string }>();
  const id = songId ?? song.id;
  const section: BlueprintSection = span.section;
  const role = roleStyle(section.role);
  const rawKey = section.key ?? song.key;
  const effKey: NoteName = rawKey in NOTE_TO_PC ? (rawKey as NoteName) : "C";
  const effScale: ScaleType = section.scale ?? song.scale;
  const jump = (tab: string) => navigate(`/song/${id}/${tab}?section=${section.id}`);

  const activeChordId = useMemo(() => {
    if (beatInSection == null) return null;
    const profile = resolveStyleProfile(section, song);
    const occurrences = resolveChordOccurrences(section, span.durationBeats, styleSpacing(profile.density));
    let active: string | null = null;
    for (let i = occurrences.length - 1; i >= 0; i--) {
      if (occurrences[i].startTime <= beatInSection) {
        active = occurrences[i].chord.id;
        break;
      }
    }
    return active;
  }, [section, song, span.durationBeats, beatInSection]);

  const necklaces = useMemo(
    () => resolveSectionVoiceNecklaces(section, song, span.occurrenceIndex),
    [section, song, span.occurrenceIndex],
  );
  const melody = section.melody?.notes?.length
    ? [...section.melody.notes].sort((a, b) => a.startTime - b.startTime)
    : null;

  const bass = section.bassProfile;
  const bassBits = bass
    ? [bass.motion, bass.rhythm, bass.octave != null ? `oct ${bass.octave}` : null, bass.velocity != null ? `vel ${bass.velocity}` : null]
        .filter(Boolean)
        .join(" · ")
    : null;
  const lyricLines = (section.lyrics ?? "").split("\n").map((l) => l.trim()).filter(Boolean);

  return (
    <div className="space-y-2 w-full">
      {/* Section header — you are HERE */}
      <div className="flex items-center gap-2 px-1">
        <span
          className="w-2.5 h-2.5 rounded-[2px] shrink-0"
          style={{ background: role.bg, boxShadow: `0 0 0 1px ${role.text}55` }}
          title={role.label}
        />
        <h2 className="text-sm font-medium text-ink truncate">{section.name}</h2>
        <span className="text-[10px] font-mono text-inkMuted/70 tabular-nums">{Math.round(span.bars)} bars</span>
        <span className="text-[10px] font-mono text-inkMuted/40 tabular-nums">block {index + 1}/{count}</span>
        {isLive && (
          <span className="text-[9px] font-mono text-accent animate-pulse" title="Following the playhead">
            ● now playing
          </span>
        )}
        <span className="flex-1" />
        <span className="text-[9px] font-mono text-inkMuted/40" title="Navigation grammar: ←→ walks sections anywhere in the workbench">
          ←→ sections
        </span>
      </div>

      {/* Drums — the clock, with the classic line view as the broad face:
          the whole arrangement cropped to this section + context, so its
          transitions in/out and detours are in view; clicks dive to the
          beat-by-beat Blocks editor on the clicked range. */}
      <ElementRow title="Drums" hint={drumFamilyLabel(section, song)} onOpen={() => jump("drums")}>
        <div className="w-full space-y-2">
          <DrumLineEmbed song={song} span={span} onEngage={onEngageDrums} />
          {necklaces ? (
            <NecklaceRow necklaces={necklaces} />
          ) : (
            <p className="text-2xs text-inkMuted/60 italic font-mono text-center px-2">
              {section.drumPattern === "none"
                ? "Muted — no kit on this section."
                : "No resolvable groove yet — author one in the drums editor."}
            </p>
          )}
        </div>
      </ElementRow>

      {/* Bass */}
      <ElementRow title="Bass" hint={bassBits ?? "auto — follows the chords"} onOpen={() => jump("harmony")}>
        <p className="text-2xs font-mono text-inkMuted/70 text-center px-2">
          {bassBits ? `profile: ${bassBits}` : "root · locked · default register"}
          <span className="block text-[9px] text-inkMuted/40 mt-1">controls live in Harmony → Layers; a bass line view comes with the element visualizations</span>
        </p>
      </ElementRow>

      {/* Chords */}
      <ElementRow
        title="Chords"
        hint={section.chords.length ? `${section.chords.length} chords · ${effKey}` : "no chords yet"}
        onOpen={() => jump("harmony")}
      >
        {section.chords.length > 0 ? (
          <div className="w-full">
            <HexReadout chords={section.chords} keyName={effKey} activeChordId={activeChordId} />
            <p className="mt-1.5 text-center font-mono text-[10px] text-inkMuted truncate">
              {section.chords.map((c, i) => (
                <span key={c.id} className={activeChordId === c.id ? "text-accent font-semibold" : i > 0 ? "text-inkMuted/70" : ""}>
                  {i > 0 && <span className="mx-1 text-inkMuted/40">·</span>}
                  {c.romanNumeral}
                  <span className="text-inkMuted/50"> {chordDisplayName(pitchClass(c.root), c.quality, effKey)}</span>
                </span>
              ))}
            </p>
          </div>
        ) : (
          <p className="text-2xs text-inkMuted/60 italic font-mono text-center px-2">No chords yet — add a progression in the harmony editor.</p>
        )}
      </ElementRow>

      {/* Color */}
      <ElementRow title="Color" hint={`register oct ${section.colorOctave ?? 6}`} onOpen={() => jump("harmony")}>
        <p className="text-2xs font-mono text-inkMuted/70 text-center px-2">
          extensions sit at octave {section.colorOctave ?? 6}
          <span className="block text-[9px] text-inkMuted/40 mt-1">flavor + register controls live in Harmony → Layers; the color visualization comes with the element visualizations</span>
        </p>
      </ElementRow>

      {/* Melody */}
      <ElementRow title="Melody" hint={melody ? `${melody.length} note${melody.length === 1 ? "" : "s"}` : "not recorded"} onOpen={() => jump("melody")}>
        {melody ? (
          <div className="w-full">
            <MelodyStaff notes={melody} sectionBeats={span.durationBeats} songKey={effKey} scale={effScale} height={128} />
          </div>
        ) : (
          <p className="text-2xs text-inkMuted/60 italic font-mono text-center px-2">No melody yet — hum one in the melody workspace.</p>
        )}
      </ElementRow>

      {/* Lyrics — pinned last: the annotation layer */}
      <ElementRow title="Lyrics" hint={lyricLines.length ? `${lyricLines.length} line${lyricLines.length === 1 ? "" : "s"}` : "not written"} onOpen={() => jump("lyrics")}>
        {lyricLines.length > 0 ? (
          <p className="text-xs text-ink/80 text-center leading-relaxed px-2 whitespace-pre-line">{lyricLines.slice(0, 3).join("\n")}</p>
        ) : (
          <p className="text-2xs text-inkMuted/60 italic font-mono text-center px-2">No lyrics yet — the pad is in the lyrics tab.</p>
        )}
      </ElementRow>
    </div>
  );
}
