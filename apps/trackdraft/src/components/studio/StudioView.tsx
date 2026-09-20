import { useEffect, useState } from "react";
import { KEY_ROOTS } from "@music-theory/core";
import type { NoteName, ScaleType } from "@music-theory/core";
import { useSongStore, type ClockSource } from "../../store/songStore";
import { getSongTransport } from "../../lib/playback/songTransport";
import { getAbletonClock } from "../../lib/playback/abletonClock";
import { playSong, stopSong } from "../../lib/playback/transportControl";
import { useMidiSettingsStore } from "../../store/midiSettingsStore";
import ArrangementTimeline from "./ArrangementTimeline";
import StudioConsole from "./StudioConsole";
import AbletonStatus from "./AbletonStatus";
import MidiSetupPanel from "./MidiSetupPanel";
import ExportMenu from "./ExportMenu";
import BendPanel from "../style/BendPanel";

const SCALES: ScaleType[] = ["ionian", "dorian", "phrygian", "lydian", "mixolydian", "aeolian", "locrian"];

/** The song's home tab. Top row has key/tempo on the left (like Ableton's
 *  own transport bar), clock source + playback controls on the right, and
 *  export/send actions to the far right — the same grouping as a DAW. */
export default function StudioView() {
  const currentSong = useSongStore((s) => s.currentSong());
  const updateCurrentSong = useSongStore((s) => s.updateCurrentSong);
  const clockSource = useSongStore((s) => s.clockSource);
  const setClockSource = useSongStore((s) => s.setClockSource);
  const [isPlaying, setIsPlaying] = useState(false);
  const [abletonConnected, setAbletonConnected] = useState(false);
  /** Whether Live's own transport is rolling — the streamed parts only
   *  sound (and can only be locked) while it is. */
  const [abletonPlaying, setAbletonPlaying] = useState(false);
  const [abletonTelemetry, setAbletonTelemetry] = useState<{
    bpm?: number;
    scale?: string;
    rootNote?: string;
  }>({});
  const [showMidiSetup, setShowMidiSetup] = useState(false);
  const midiOutputId = useMidiSettingsStore((s) => s.midiOutputId);

  function openPopout() {
    if (!currentSong) return;
    window.open(
      `/song/${currentSong.id}/popout`,
      "trackdraft-popout",
      "width=900,height=560,menubar=no,toolbar=no,location=no,status=no",
    );
  }

  // Subscribes once for the tab's lifetime rather than per-click, so the
  // button also reflects playback stopping on its own (reaching the end of
  // the song) not just an explicit Stop click. Deliberately does NOT stop
  // playback on unmount — the header's global Play keeps the song going
  // while you edit other tabs; navigation is only stopped by the layout's
  // own cleanup when you leave the song editor.
  useEffect(() => {
    const transport = getSongTransport();
    const unsubscribe = transport.onTick((tick) => setIsPlaying(tick.isPlaying));
    return () => unsubscribe();
  }, []);

  // Keep the transport's clockSource in sync with the persisted store
  // so play() no-ops and syncToAbleton() fires when appropriate.
  useEffect(() => {
    getSongTransport().clockSource = clockSource;
  }, [clockSource]);

  // Only connects once the user actually picks Ableton sync — no reason to
  // open a WebSocket to a bridge that's probably not running for anyone
  // using the app's own playback.
  useEffect(() => {
    if (clockSource !== "ableton") return;
    const clock = getAbletonClock();
    clock.connect();
    return clock.onChange((state) => {
      setAbletonConnected(state.connected);
      setAbletonPlaying(state.isPlaying);
      setAbletonTelemetry({
        bpm: state.abletonBpm,
        scale: state.abletonScale,
        rootNote: state.abletonRootNote,
      });
    });
  }, [clockSource]);

  if (!currentSong) return null;
  const song = currentSong;

  async function togglePlayback() {
    if (isPlaying) {
      stopSong();
      return;
    }
    // Shared with the header's global Play — same clock-source handling and
    // live MIDI out, so the two controls can't drift.
    const started = await playSong(song, clockSource);
    if (!started) {
      // The saved port id is stale (Web MIDI ids change between browser
      // restarts) — don't fail silently; re-picking in the panel fixes it.
      alert("The selected MIDI port is no longer available. Open the MIDI setup panel, re-select a port, then Play again.");
    }
  }

  /** Sends the song's BPM to Ableton via the WebSocket bridge's
   *  bidirectional command channel — gated on `abletonConnected` so we
   *  don't fire commands into an unconnected socket. */
  function setAbletonTempo(bpm: number) {
    if (!abletonConnected) return;
    getAbletonClock().sendCommand("/live/song/set/tempo", [bpm]);
  }

  return (
    <div className="h-full p-4 max-w-6xl flex flex-col min-h-0">
      {/* Single transport bar — key/tempo left, clock/transport/export
          right, so nothing wraps into a second row above the arrangement. */}
      <div className="shrink-0 flex items-center gap-2 border-b border-edge pb-2">
        {/* Left: key + tempo — editable "song identity" controls */}
        <div className="flex items-center gap-2 mr-auto">
          <div className="flex items-center gap-1">
            <label className="text-3xs text-inkMuted uppercase tracking-wide font-mono">Key</label>
            <select
              className="bg-panelAlt border border-edge rounded px-1.5 py-0.5 text-xs text-ink"
              value={song.key}
              onChange={(e) => updateCurrentSong((s) => ({ ...s, key: e.target.value as NoteName }))}
            >
              {KEY_ROOTS.slice(0, 12).map((k) => (
                <option key={k} value={k}>{k}</option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-1">
            <label className="text-3xs text-inkMuted uppercase tracking-wide font-mono">Scale</label>
            <select
              className="bg-panelAlt border border-edge rounded px-1.5 py-0.5 text-xs text-ink"
              value={song.scale}
              onChange={(e) => updateCurrentSong((s) => ({ ...s, scale: e.target.value as ScaleType }))}
            >
              {SCALES.map((sc) => (
                <option key={sc} value={sc}>{sc}</option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-1 ml-2">
            <label className="text-3xs text-inkMuted uppercase tracking-wide font-mono">BPM</label>
            <input
              type="number"
              className="w-14 bg-panelAlt border border-edge rounded px-1.5 py-0.5 text-xs text-ink text-center"
              value={song.bpm}
              min={20}
              max={999}
              step={1}
              onChange={(e) => {
                const bpm = Math.max(20, Math.min(999, parseInt(e.target.value, 10) || 120));
                updateCurrentSong((s) => ({ ...s, bpm }));
                setAbletonTempo(bpm);
              }}
            />
            {abletonConnected && (
              <button
                className="text-[9px] text-inkMuted hover:text-accent font-mono ml-0.5"
                title="Set Ableton's tempo to match this song's BPM"
                onClick={() => setAbletonTempo(song.bpm)}
              >
                ▶ Live
              </button>
            )}
          </div>
        </div>

        {/* Right: clock source + transport + actions */}
        <div className="flex items-center gap-1.5">
          <div className="flex items-center gap-1" title="Which clock drives playback position — the app's own player, or Ableton's transport over osc-bridge">
            {(["internal", "ableton"] as const).map((mode) => (
              <button
                key={mode}
                className={`text-xs px-2 py-1 rounded border ${
                  clockSource === mode
                    ? "border-accent text-accent bg-accent/10"
                    : "border-edge text-inkMuted hover:text-ink"
                }`}
                title={
                  mode === "internal"
                    ? "App clock — TrackDraft runs its own timeline, so MIDI streamed into Live free-runs against Live's grid"
                    : "Ableton clock — takes Live's position as the master, so the parts streamed into Live land on Live's grid and stay there"
                }
                onClick={() => {
                  if (isPlaying) getSongTransport().stop();
                  setClockSource(mode);
                }}
              >
                {mode === "internal" ? "App" : "Ableton"}
              </button>
            ))}
            {clockSource === "ableton" && (
              <>
                <AbletonStatus connected={abletonConnected} />
                {abletonConnected && !abletonPlaying && (
                  <span
                    className="text-[10px] font-mono text-amber-400"
                    title="Live's transport is stopped, so there's no grid to lock the streamed chords/bass/drums to. Press play in Live — the parts start streaming from wherever Live is, on its beats."
                  >
                    ⏸ live stopped
                  </span>
                )}
                {abletonConnected && abletonTelemetry.bpm !== undefined && (
                  <span className="text-[10px] text-inkMuted font-mono ml-1">
                    {abletonTelemetry.rootNote} {abletonTelemetry.scale}, {abletonTelemetry.bpm} bpm
                  </span>
                )}
                <div className="flex items-center gap-0.5">
                  <label className="text-3xs text-inkMuted uppercase tracking-wide font-mono">Offset</label>
                  <input
                    type="number"
                    className="w-16 bg-panelAlt border border-edge rounded px-1 py-0.5 text-xs text-ink text-center"
                    value={song.beatOffset ?? 0}
                    step={0.1}
                    onChange={(e) => {
                      const val = parseFloat(e.target.value);
                      if (!isNaN(val)) updateCurrentSong((s) => ({ ...s, beatOffset: val }));
                    }}
                    title="Ableton beat that maps to song beat 0 (subtracted from abletonBeat)"
                  />
                </div>
                <button
                  className="text-xs px-2 py-1 rounded border border-edge text-inkMuted hover:text-ink disabled:opacity-40"
                  onClick={() => {
                    const offset = getSongTransport().calibrate();
                    if (offset !== null) updateCurrentSong((s) => ({ ...s, beatOffset: offset }));
                  }}
                  disabled={!abletonConnected}
                  title="Click the instant Ableton starts playing this song — anchors song beat 0 to Ableton's current transport position"
                >
                  Calibrate
                </button>
              </>
            )}
          </div>
          <button
            className="border border-edge text-inkMuted hover:text-ink rounded px-2 py-1 text-xs font-mono"
            onClick={() => setShowMidiSetup(true)}
            title="MIDI Out setup — port, per-track channels (kit/crave/chord/color), and test"
          >
            MIDI{midiOutputId ? " ●" : ""}
          </button>
          {showMidiSetup && <MidiSetupPanel onClose={() => setShowMidiSetup(false)} />}
          <button
            className="bg-accent text-black text-xs font-medium px-2.5 py-1 rounded disabled:opacity-40"
            onClick={togglePlayback}
            disabled={song.sections.length === 0}
          >
            {isPlaying ? "■ Stop" : clockSource === "ableton" ? "⟲ Sync" : "▶ Play"}
          </button>
          <button
            className="border border-edge text-inkMuted hover:text-ink text-xs font-medium px-2.5 py-1 rounded"
            onClick={openPopout}
            title="Open a chrome-free lyric/chord window, synced to Studio playback — good for a second monitor"
          >
            Pop out lyrics/chords
          </button>
          <ExportMenu song={song} />
        </div>
      </div>

      {song.sections.length === 0 ? (
        <div className="flex-1 flex items-center justify-center">
          <p className="text-inkMuted text-sm">
            Add sections in the Structure tab first — Studio shows your song's arrangement here once it has some.
          </p>
        </div>
      ) : (
        /* The arrangement is the section *index* (click a block to target
           its mix); the console below mirrors that section's actual
           harmony/drums/melody — the freed vertical band put to musical
           use. Bend sliders stay pinned on the right. */
        <div className="flex-1 min-h-0 flex items-stretch gap-3 mt-3">
          <div className="flex-1 min-w-0 flex flex-col gap-3 min-h-0">
            <div className="shrink-0">
              <ArrangementTimeline song={song} />
            </div>
            <StudioConsole song={song} />
          </div>
          <div className="w-72 shrink-0 min-h-0 overflow-y-auto">
            <BendPanel />
          </div>
        </div>
      )}
    </div>
  );
}