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
import Spine from "../shell/Spine";
import BendPanel from "../style/BendPanel";
import HexReadout from "../harmony/HexReadout";
import NecklaceRow from "../drums/NecklaceRow";
import MelodyStaff from "../melody/MelodyStaff";
import type { BlueprintSection, BlueprintSong } from "../../types/blueprint";

/**
 * The Workbench — first slice of the new workspace (docs/design/workspace.md).
 *
 * Bands: Spine (full width) → zones row (library rail · section workspace ·
 * bend rail) → workbench stub band. This is "section work" v0: the selected
 * section's materials as preview rows in the ladder's order (drums first as
 * the clock), with the bend lens pinned right and the song list in a
 * collapsible Ableton-style browser on the left.
 *
 * Deliberately transitional: element rows jump to the existing editor tabs
 * (?section=) until P3 embeds them in place; the legacy header/nav live
 * above until P2 folds them into the spine.
 */
export default function WorkbenchView() {
  const currentSong = useSongStore((s) => s.currentSong());
  const songs = useSongStore((s) => s.songs);
  const navigate = useNavigate();
  const selectedSectionId = useStudioSelectionStore((s) => s.selectedSectionId);
  const setSelectedSectionId = useStudioSelectionStore((s) => s.setSelectedSectionId);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [benchOpen, setBenchOpen] = useState(false);
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
      {/* Band 1 — the spine, edge to edge */}
      <Spine song={song} />

      {/* Band 2 — zones row: library · section workspace · bend rail */}
      <div className="flex-1 flex min-h-0">
        <LibraryRail
          songs={songs}
          currentId={song.id}
          open={libraryOpen}
          onToggle={() => setLibraryOpen((v) => !v)}
          onPick={(id) => navigate(`/song/${id}/workbench`)}
        />

        <div className="flex-1 min-w-0 overflow-y-auto p-3">
          {activeSpan ? (
            <SectionWorkspace
              song={song}
              span={activeSpan}
              index={activeIndex}
              count={spans.length}
              isLive={isLive}
              beatInSection={beatInSection}
            />
          ) : (
            <div className="h-full flex items-center justify-center">
              <p className="text-inkMuted text-sm">Add sections in Structure first — the workbench mirrors the section you pick on the spine.</p>
            </div>
          )}
        </div>

        <aside className="w-[216px] shrink-0 border-l border-edge bg-panel min-h-0 overflow-y-auto p-2" aria-label="Context rail — mix / bend lens">
          <BendPanel />
        </aside>
      </div>

      {/* Band 3 — the workbench (stub): maps · recipes · templates */}
      <footer className="shrink-0 border-t border-edge bg-panel/80">
        <button
          type="button"
          className="w-full flex items-center gap-2 px-3 h-8 text-left hover:bg-panelAlt/40"
          onClick={() => setBenchOpen((v) => !v)}
          title="The arrangement workbench band — song maps, genre recipes and templates land here (phase 4)"
        >
          <span className="text-3xs font-mono uppercase tracking-widest text-inkMuted">Workbench</span>
          <span className="text-[10px] font-mono text-inkMuted/50">song maps · genre recipes · templates</span>
          <span className="flex-1" />
          <span className="text-3xs font-mono text-inkMuted/40 border border-edge/70 rounded px-1.5 py-0.5">next phase</span>
          <span className="text-inkMuted/60 text-[10px]">{benchOpen ? "▾" : "▴"}</span>
        </button>
        {benchOpen && (
          <p className="px-3 pb-2 text-[11px] font-mono text-inkMuted/70">
            This band becomes the arrangement workbench: genre maps and narrative templates as horizontal cards, genre
            recipes as one-click tints — hovering a template ghosts the sections it would mint onto the spine above
            before you commit. The band itself is the demonstration for now.
          </p>
        )}
      </footer>
    </div>
  );
}

/** Left rail — the song list as an Ableton-style browser: closed until you
 *  need to look for something. Maps/templates/presets drag-ins land here in
 *  later phases. */
function LibraryRail({
  songs,
  currentId,
  open,
  onToggle,
  onPick,
}: {
  songs: BlueprintSong[];
  currentId: string;
  open: boolean;
  onToggle: () => void;
  onPick: (id: string) => void;
}) {
  return (
    <aside className={`shrink-0 border-r border-edge bg-panel flex flex-col min-h-0 ${open ? "w-56" : "w-9"}`} aria-label="Library">
      <button
        type="button"
        className="h-9 shrink-0 flex items-center justify-center text-inkMuted hover:text-ink text-xs"
        onClick={onToggle}
        title={open ? "Close the library" : "Library — songs, and later maps/templates (closed until you need it)"}
      >
        {open ? "◂" : "▸"}
      </button>
      {open ? (
        <div className="flex-1 min-h-0 overflow-y-auto px-2 pb-2">
          <p className="text-3xs font-mono uppercase tracking-widest text-inkMuted px-1 pt-1">Library · songs</p>
          <div className="mt-1 space-y-0.5">
            {songs.map((s) => (
              <button
                key={s.id}
                type="button"
                className={`w-full text-left px-1.5 py-1 rounded ${
                  s.id === currentId ? "bg-panelAlt text-ink" : "text-inkMuted hover:text-ink hover:bg-panelAlt/60"
                }`}
                onClick={() => onPick(s.id)}
                title={`Open "${s.title}" in the workbench`}
              >
                <span className="block text-xs truncate">{s.title}</span>
                <span className="block text-3xs font-mono text-inkMuted/60 tabular-nums">
                  {s.key} {s.scale} · {s.bpm} BPM
                </span>
              </button>
            ))}
          </div>
          <p className="text-[9px] font-mono text-inkMuted/40 px-1 pt-3">maps · templates · presets — later phases</p>
        </div>
      ) : (
        <span className="flex-1" />
      )}
    </aside>
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

/** The section workspace — every element of the selected section as a
 *  preview row, in the ladder's order: drums (the clock) first, lyrics
 *  pinned last as annotation. Read-mostly by design; P3 adds light actions
 *  (loop, ◆ adopt) and in-place editors. */
function SectionWorkspace({
  song,
  span,
  index,
  count,
  isLive,
  beatInSection,
}: {
  song: BlueprintSong;
  span: SectionSpan;
  index: number;
  count: number;
  isLive: boolean;
  beatInSection: number | null;
}) {
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
    <div className="space-y-2 max-w-5xl">
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

      {/* Drums — the clock */}
      <ElementRow title="Drums" hint={drumFamilyLabel(section, song)} onOpen={() => jump("drums")}>
        {necklaces ? (
          <NecklaceRow necklaces={necklaces} />
        ) : (
          <p className="text-2xs text-inkMuted/60 italic font-mono text-center px-2">
            {section.drumPattern === "none"
              ? "Muted — no kit on this section."
              : "No resolvable groove yet — author one in the drums editor."}
          </p>
        )}
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
