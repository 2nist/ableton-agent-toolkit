import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { pitchClass, NOTE_TO_PC } from "@music-theory/core";
import type { NoteName, ScaleType } from "@music-theory/core";
import { resolveChordOccurrences, resolveStyleProfile, styleSpacing } from "@drum/library";
import { sectionSpans } from "../../lib/arrangement";
import { useRoleStyle } from "../../lib/roleColors";
import { chordDisplayName } from "../../lib/harmony/chordBuilder";
import { getSongTransport, type TransportTick } from "../../lib/playback/songTransport";
import { useStudioSelectionStore } from "../../store/studioSelectionStore";
import { drumFamilyLabel, resolveSectionVoiceNecklaces } from "../../lib/playback/drumPreview";
import HexReadout from "../harmony/HexReadout";
import NecklaceRow from "../drums/NecklaceRow";
import MelodyStaff from "../melody/MelodyStaff";
import type { BlueprintSong } from "../../types/blueprint";

/** A single stem readout card — title, hint, jump-open, and centered content.
 *  Module scope (not nested) so transport-tick re-renders of the console
 *  don't remount the pane subtrees (e.g. re-create the melody canvas). */
function Pane({ title, hint, onOpen, children }: { title: string; hint: string; onOpen: () => void; children: React.ReactNode }) {
  return (
    <section className="flex flex-col min-h-0 border border-edge rounded-lg bg-panelAlt/40 overflow-hidden">
      <header className="shrink-0 flex items-center gap-2 px-2.5 py-1.5 border-b border-edge/70">
        <span className="text-3xs font-mono uppercase tracking-widest text-inkMuted">{title}</span>
        <span className="text-[9px] font-mono text-inkMuted/50 truncate flex-1" title={hint}>{hint}</span>
        <button
          className="shrink-0 text-[9px] font-mono text-accent/80 hover:text-accent border border-edge/70 rounded px-1.5 py-0.5"
          onClick={onOpen}
          title={`Open the ${title.toLowerCase()} editor for this section`}
        >
          open →
        </button>
      </header>
      <div className="flex-1 min-h-0 flex items-center justify-center p-2 overflow-hidden">{children}</div>
    </section>
  );
}

/** The Studio console — the freed band under the arrangement, filled with
 *  musical readouts instead of an empty footer.
 *
 *  It mirrors whichever section is "live": the playhead's section while
 *  playing (so you watch the harmony walk the wheel and the groove change
 *  as the song moves), else the block you clicked to target in the Bend
 *  panel. Three panes, one per stem — the same split as the editor tabs:
 *    · Harmony — the section's chords on the hex wheel, the currently
 *      sounding chord lit as the transport crosses it.
 *    · Drums   — the *resolved* groove (outline, preset or genre-inferred)
 *      as necklace glyphs, so you can see why it sounds the way it does.
 *    · Melody  — the captured line as staff notation when there is one.
 *  Every pane is a jump control into its editor tab scoped to the section.
 *  Read-only by design — edits live in their own tabs, next to the tools.
 */
export default function StudioConsole({ song }: { song: BlueprintSong }) {
  const roleStyle = useRoleStyle();
  const navigate = useNavigate();
  const { songId } = useParams<{ songId: string }>();
  const id = songId ?? song.id;
  const selectedSectionId = useStudioSelectionStore((s) => s.selectedSectionId);
  const spans = useMemo(() => sectionSpans(song), [song]);
  const [tick, setTick] = useState<TransportTick | null>(null);

  useEffect(() => {
    const transport = getSongTransport();
    const unsubscribe = transport.onTick(setTick);
    return () => unsubscribe();
  }, []);

  // Follow the playhead while playing; otherwise the section the user
  // clicked (the Bend-panel target); first section as a last resort.
  const liveSpan = tick?.isPlaying && tick.sectionIndex >= 0 && tick.sectionIndex < spans.length ? spans[tick.sectionIndex] : null;
  const activeSpan = liveSpan ?? spans.find((sp) => sp.sectionId === selectedSectionId) ?? spans[0] ?? null;
  const isLive = liveSpan !== null && activeSpan === liveSpan;

  // Stop playback follows: don't light anything; live, figure out which
  // authored chord the playhead is over using the SAME resolver the export
  // pipeline uses (so the console and the audio agree about the grid).
  const beatInSection = isLive && tick && activeSpan ? tick.beat - activeSpan.startBeat : null;

  const { activeChordId, chordTimeline } = useMemo(() => {
    if (activeSpan == null || beatInSection == null) return { activeChordId: null as string | null, chordTimeline: [] as { start: number; duration: number }[] };
    const section = activeSpan.section;
    const profile = resolveStyleProfile(section, song);
    const occurrences = resolveChordOccurrences(section, activeSpan.durationBeats, styleSpacing(profile.density));
    const timeline = occurrences.map((o) => ({ start: o.startTime, duration: o.duration }));
    let active: string | null = null;
    for (let i = occurrences.length - 1; i >= 0; i--) {
      if (occurrences[i].startTime <= beatInSection) {
        active = occurrences[i].chord.id;
        break;
      }
    }
    return { activeChordId: active, chordTimeline: timeline };
  }, [activeSpan, beatInSection, song]);

  const liveChord = useMemo(() => {
    if (!activeChordId || !activeSpan) return null;
    return activeSpan.section.chords.find((c) => c.id === activeChordId) ?? null;
  }, [activeChordId, activeSpan]);

  // The section's resolved drum groove (outline, preset, or genre-inferred)
  // — what will actually play for this pass of the section.
  const necklaces = useMemo(() => {
    if (!activeSpan) return null;
    return resolveSectionVoiceNecklaces(activeSpan.section, song, activeSpan.occurrenceIndex);
  }, [activeSpan, song]);

  if (!activeSpan) return null;
  const section = activeSpan.section;
  const role = roleStyle(section.role);
  const rawKey = section.key ?? song.key;
  const effKey: NoteName = rawKey in NOTE_TO_PC ? (rawKey as NoteName) : "C";
  const effScale: ScaleType = section.scale ?? song.scale;
  const melody = section.melody?.notes?.length ? [...section.melody.notes].sort((a, b) => a.startTime - b.startTime) : null;
  const drumLabel = drumFamilyLabel(section, song);
  const genreTag = song.genre && !section.drumPattern && !section.drumMeterOutline ? song.genre : null;

  const jump = (tab: string) => navigate(`/song/${id}/${tab}?section=${section.id}`);
  const progressPct = isLive && tick && activeSpan ? Math.min(1, Math.max(0, (tick.beat - activeSpan.startBeat) / activeSpan.durationBeats)) : null;

  return (
    <section className="flex-1 min-h-0 flex flex-col rounded-lg border border-edge bg-panel overflow-hidden">
      {/* Console header — who is this mirroring, and where to take it */}
      <header className="shrink-0 flex items-center gap-2 px-3 py-1.5 border-b border-edge/70 bg-panelAlt/40">
        <span
          className="w-2.5 h-2.5 rounded-[2px] shrink-0"
          style={{ background: role.bg, boxShadow: `0 0 0 1px ${role.text}55` }}
          title={role.label}
        />
        <h3 className="text-xs font-medium text-ink truncate">{section.name}</h3>
        {activeSpan.variation && <span className="text-[9px] font-mono text-inkMuted/60">({activeSpan.variation})</span>}
        <span className="text-[10px] font-mono text-inkMuted/70 tabular-nums">{Math.round(activeSpan.bars)} bars</span>
        {isLive && (
          <span className="text-[9px] font-mono text-accent animate-pulse" title="Following the playhead">
            ● now playing
          </span>
        )}
        <span className="flex-1" />
        <button className="text-[10px] text-inkMuted hover:text-ink font-mono" onClick={() => jump("harmony")} title="Edit this section's harmony">Harmony</button>
        <button className="text-[10px] text-inkMuted hover:text-ink font-mono" onClick={() => jump("drums")} title="Edit this section's drums">Drums</button>
        <button className="text-[10px] text-inkMuted hover:text-ink font-mono" onClick={() => jump("melody")} title="Record/edit this section's melody">Melody</button>
      </header>

      {/* The three stem readouts */}
      <div className="flex-1 min-h-0 grid grid-cols-1 md:grid-cols-3 gap-2 p-2 overflow-y-auto">
        <Pane title="Harmony" hint={section.chords.length ? `${section.chords.length} chords · ${effKey}` : "no chords yet"} onOpen={() => jump("harmony")}>
          {section.chords.length > 0 ? (
            <div className="w-full">
              <HexReadout chords={section.chords} keyName={effKey} activeChordId={activeChordId} />
              {/* one-line truth: exact chord symbols, the hex colours carry function */}
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
            <p className="text-2xs text-inkMuted/60 italic font-mono text-center px-2">No chords yet — add a progression in the Harmony tab.</p>
          )}
        </Pane>

        <Pane title="Drums" hint={drumLabel} onOpen={() => jump("drums")}>
          {necklaces ? (
            <NecklaceRow necklaces={necklaces} />
          ) : (
            <p className="text-2xs text-inkMuted/60 italic font-mono text-center px-2">
              {section.drumPattern === "none" ? "Muted — no kit on this section." : "No resolvable groove yet — head to Drums."}
            </p>
          )}
          {genreTag && (
            <span className="mt-1 text-[9px] font-mono text-accent/80 self-center">genre groove · {genreTag}</span>
          )}
        </Pane>

        <Pane title="Melody" hint={melody ? `${melody.length} note${melody.length === 1 ? "" : "s"}` : "not recorded"} onOpen={() => jump("melody")}>
          {melody ? (
            <div className="w-full">
              <MelodyStaff notes={melody} sectionBeats={activeSpan.durationBeats} songKey={effKey} scale={effScale} height={128} />
            </div>
          ) : (
            <p className="text-2xs text-inkMuted/60 italic font-mono text-center px-2">No melody yet — hum one in the Melody tab.</p>
          )}
        </Pane>
      </div>

      {/* Live footer — position + chord-change boundaries on the section */}
      <footer className="shrink-0 border-t border-edge/70 px-3 py-1.5 flex items-center gap-2">
        {isLive && tick && activeSpan ? (
          <>
            <span className="text-[9.5px] font-mono text-accent tabular-nums w-24 shrink-0">
              bar {Math.floor((tick.beat - activeSpan.startBeat) / (section.timeSignatureNumerator ?? 4)) + 1}
            </span>
            <div className="relative flex-1 h-2 rounded-full bg-edge/60 overflow-hidden" title="Section position — ticks mark chord changes">
              {chordTimeline.map((o, i) => {
                const left = (o.start / activeSpan.durationBeats) * 100;
                return (
                  <span key={i} className="absolute top-0 bottom-0 w-px bg-accent/40" style={{ left: `${left}%` }} />
                );
              })}
              {progressPct !== null && (
                <span className="absolute top-0 bottom-0 left-0 rounded-full bg-accent/80" style={{ width: `${progressPct * 100}%` }} />
              )}
            </div>
            <span className="text-[10px] font-mono text-ink shrink-0 truncate max-w-[45%]">
              {liveChord ? (
                <span className="text-ink">
                  <span className="text-accent">{liveChord.romanNumeral}</span>{" "}
                  {chordDisplayName(pitchClass(liveChord.root), liveChord.quality, effKey)}
                </span>
              ) : (
                <span className="text-inkMuted/70">…</span>
              )}
            </span>
          </>
        ) : (
          <span className="text-[10px] font-mono text-inkMuted/60">
            Play to watch the harmony walk the wheel — click an arrangement block to inspect a section here.
          </span>
        )}
      </footer>
    </section>
  );
}
