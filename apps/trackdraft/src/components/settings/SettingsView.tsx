import { useState } from "react";
import { useSongStore } from "../../store/songStore";
import {
  DAW_TARGETS,
  DAW_TARGET_DESCRIPTIONS,
  DAW_TARGET_LABELS,
  useDawTargetStore,
  type DawTarget,
} from "../../store/dawTargetStore";
import DataFilesSection from "./DataFilesSection";
import MidiSetupPanel from "./MidiSetupPanel";
import MidiTemplateGuide from "./MidiTemplateGuide";
import ExportMenu from "./ExportMenu";
import DirSetupModal from "../dashboard/DirSetupModal";
import TapeLabel from "../common/TapeLabel";

/**
 * Settings — the song-adjacent controls that used to hide behind one-off
 * buttons, gathered in one place (user request 2026-09-21: "likely a
 * settings menu should be developed"). Grouped by job:
 *
 *   MIDI & sync      — the playback clock, the live MIDI-out setup
 *                      (embedded, no longer only a modal), and the Live
 *                      template guide
 *   Export & windows — the song outputs (JSON · MIDI · Ableton) and the
 *                      lyrics/chords popout window
 *   Files            — local directories (the same store the dashboard's
 *                      gear manages)
 *   Labs & tools     — Genre Workbench · Design Lab · the Puck sandbox —
 *                      opened in their own tab (they leave the song
 *                      editor, which stops playback, so a new tab keeps
 *                      the music running)
 */
export default function SettingsView() {
  const currentSong = useSongStore((s) => s.currentSong());
  const target = useDawTargetStore((s) => s.target);
  const setTarget = useDawTargetStore((s) => s.setTarget);
  const [guideOpen, setGuideOpen] = useState(false);
  const [dirsOpen, setDirsOpen] = useState(false);

  function openPopout() {
    if (!currentSong) return;
    window.open(
      `/song/${currentSong.id}/popout`,
      "trackdraft-popout",
      "width=900,height=560,menubar=no,toolbar=no,location=no,status=no",
    );
  }

  const targetBtn = (mode: DawTarget) => (
    <button
      key={mode}
      type="button"
      className={`px-2 py-0.5 rounded border text-[10px] font-mono ${
        target === mode ? "border-accent/50 bg-panelAlt text-ink" : "border-edge/70 text-inkMuted hover:text-ink"
      }`}
      onClick={() => setTarget(mode)}
      title={DAW_TARGET_DESCRIPTIONS[mode]}
    >
      {DAW_TARGET_LABELS[mode]}
    </button>
  );

  return (
    <div className="p-4 max-w-3xl space-y-3">
      <h1 className="text-sm font-medium text-ink">Settings</h1>

      {/* MIDI & sync */}
      <section className="border border-edge rounded-lg bg-panel overflow-hidden">
        <header className="flex items-center gap-2 px-3 py-2 border-b border-edge/70">
          <TapeLabel size="md" className="text-3xs font-mono uppercase tracking-widest text-inkMuted">MIDI &amp; sync</TapeLabel>
          <span className="flex-1" />
          <button
            type="button"
            className="text-[10px] font-mono text-accent/80 hover:text-accent border border-edge/70 rounded px-1.5 py-0.5"
            onClick={() => setGuideOpen(true)}
            title="One-time Live-side setup: the IAC port pick and the per-track MIDI From repoint"
          >
            Live template guide
          </button>
        </header>
        <div className="p-3 space-y-3">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[10px] font-mono text-inkMuted">Target DAW</span>
            <div className="flex gap-0.5">{DAW_TARGETS.map(targetBtn)}</div>
            <span className="text-[10px] text-inkMuted/60">
              {target === "live"
                ? "Live drives position; seek waits for Live."
                : target === "other"
                  ? "The app's player drives position; stems stream over MIDI."
                  : "The app's player drives position; nothing is sent over MIDI."}
            </span>
          </div>
          <MidiSetupPanel inline onClose={() => {}} />
        </div>
      </section>

      {/* Export & windows */}
      <section className="border border-edge rounded-lg bg-panel overflow-hidden">
        <header className="flex items-center gap-2 px-3 py-2 border-b border-edge/70">
          <TapeLabel size="md" className="text-3xs font-mono uppercase tracking-widest text-inkMuted">Export &amp; windows</TapeLabel>
          <span className="text-[9px] font-mono text-inkMuted/40 truncate flex-1" title="These act on the open song">
            acts on {currentSong?.title ?? "—"}
          </span>
        </header>
        <div className="p-3 space-y-2">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs text-ink">Song outputs</span>
            <span className="text-[10px] text-inkMuted/60">JSON blueprint · multi-track MIDI · straight to Ableton</span>
            <span className="flex-1" />
            {currentSong && <ExportMenu song={currentSong} />}
          </div>
          <div className="flex items-center gap-2 flex-wrap border-t border-edge/60 pt-2">
            <span className="text-xs text-ink">Lyrics / chords popout</span>
            <span className="text-[10px] text-inkMuted/60">a separate window for playing along — keep it visible while you edit</span>
            <span className="flex-1" />
            <button
              type="button"
              className="border border-edge/70 rounded px-2 py-0.5 text-[10px] font-mono text-accent/80 hover:text-accent"
              onClick={openPopout}
              title="Open the popout window (allow pop-ups for this tab)"
            >
              Open popout
            </button>
          </div>
        </div>
      </section>

      {/* Files */}
      <section className="border border-edge rounded-lg bg-panel overflow-hidden">
        <header className="flex items-center gap-2 px-3 py-2 border-b border-edge/70">
          <TapeLabel size="md" className="text-3xs font-mono uppercase tracking-widest text-inkMuted">Files</TapeLabel>
        </header>
        <div className="p-3 flex items-center gap-2 flex-wrap">
          <span className="text-xs text-ink">Local directories</span>
          <span className="text-[10px] text-inkMuted/60">sample & kit folders — the same store the dashboard's gear manages</span>
          <span className="flex-1" />
          <button
            type="button"
            className="border border-edge/70 rounded px-2 py-0.5 text-[10px] font-mono text-accent/80 hover:text-accent"
            onClick={() => setDirsOpen(true)}
          >
            Manage directories…
          </button>
        </div>
      </section>

      {/* Data files — the engine's editable tables */}
      <DataFilesSection />

      {/* Labs & tools — developed surfaces outside the song editor */}
      <section className="border border-edge rounded-lg bg-panel overflow-hidden">
        <header className="flex items-center gap-2 px-3 py-2 border-b border-edge/70">
          <TapeLabel size="md" className="text-3xs font-mono uppercase tracking-widest text-inkMuted">Labs &amp; tools</TapeLabel>
          <span className="text-[9px] font-mono text-inkMuted/40 flex-1">open in a new tab — playback keeps running here</span>
        </header>
        <div className="p-3 space-y-1.5">
          {[
            ["/genre-workbench", "Genre Workbench", "the 119-genre map builder — research a genre, validate, save the map"],
            ["/design-lab", "Design Lab", "tokens, primitives and the component playground"],
            ["/sandbox", "Puck sandbox", "the visual-arrangement experiment (drag-and-drop layout editor)"],
          ].map(([href, name, desc]) => (
            <a
              key={href}
              href={href}
              target="_blank"
              rel="noreferrer"
              className="flex items-baseline gap-2 px-1.5 py-1 rounded hover:bg-panelAlt/60"
              title={desc}
            >
              <span className="text-xs text-accent/90">{name}</span>
              <span className="text-[10px] text-inkMuted/60 truncate">{desc}</span>
            </a>
          ))}
        </div>
      </section>

      {guideOpen && <MidiTemplateGuide onClose={() => setGuideOpen(false)} />}
      <DirSetupModal open={dirsOpen} onClose={() => setDirsOpen(false)} />
    </div>
  );
}
