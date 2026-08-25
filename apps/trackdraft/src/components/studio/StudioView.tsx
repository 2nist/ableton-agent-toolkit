import { useEffect, useState } from "react";
import { KEY_ROOTS } from "@music-theory/core";
import type { NoteName, ScaleType } from "@music-theory/core";
import { useSongStore, type ClockSource } from "../../store/songStore";
import { downloadSongJson, pushSongToAbleton } from "../../lib/exportImport";
import { downloadSongMidi } from "../../lib/midiExport";
import { getSongTransport } from "../../lib/playback/songTransport";
import { getAbletonClock } from "../../lib/playback/abletonClock";
import ArrangementTimeline from "./ArrangementTimeline";

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
  const [abletonTelemetry, setAbletonTelemetry] = useState<{
    bpm?: number;
    scale?: string;
    rootNote?: string;
  }>({});

  function openPopout() {
    if (!currentSong) return;
    window.open(
      `/song/${currentSong.id}/popout`,
      "trackdraft-popout",
      "width=900,height=560,menubar=no,toolbar=no,location=no,status=no",
    );
  }

  // Subscribes once for the tab's lifetime rather than per-click, so the
  // button also reflects playback stopping on its own (reaching the end
  // of the song) not just an explicit Stop click. Stopping on unmount
  // avoids a song that's mid-playback continuing to sound after the user
  // navigates away from Studio.
  useEffect(() => {
    const transport = getSongTransport();
    const unsubscribe = transport.onTick((tick) => setIsPlaying(tick.isPlaying));
    return () => {
      unsubscribe();
      transport.stop();
    };
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
      setAbletonTelemetry({
        bpm: state.abletonBpm,
        scale: state.abletonScale,
        rootNote: state.abletonRootNote,
      });
    });
  }, [clockSource]);

  if (!currentSong) return null;
  const song = currentSong;

  function togglePlayback() {
    const transport = getSongTransport();
    if (isPlaying) {
      transport.stop();
    } else if (clockSource === "ableton") {
      transport.syncToAbleton(song);
    } else {
      transport.play(song);
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
    <div className="p-6 max-w-5xl space-y-4">
      <div className="flex items-center gap-4 border-b border-edge pb-3 flex-wrap">
        {/* Left: key + tempo — editable "song identity" controls */}
        <div className="flex items-center gap-3 mr-auto">
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
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-1" title="Which clock drives playback position — the app's own player, or Ableton's transport over osc-bridge">
            {(["internal", "ableton"] as const).map((mode) => (
              <button
                key={mode}
                className={`text-xs px-2 py-1 rounded border ${
                  clockSource === mode
                    ? "border-accent text-accent bg-accent/10"
                    : "border-edge text-inkMuted hover:text-ink"
                }`}
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
                <span className={`text-[10px] font-mono ${abletonConnected ? "text-green-400" : "text-inkMuted/60"}`}>
                  {abletonConnected ? "● connected" : "○ waiting…"}
                </span>
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
            className="bg-accent text-black text-xs font-medium px-3 py-1.5 rounded disabled:opacity-40"
            onClick={togglePlayback}
            disabled={song.sections.length === 0}
          >
            {isPlaying ? "■ Stop" : clockSource === "ableton" ? "⟲ Sync" : "▶ Play"}
          </button>
          <button
            className="border border-edge text-inkMuted hover:text-ink text-xs font-medium px-3 py-1.5 rounded"
            onClick={openPopout}
            title="Open a chrome-free lyric/chord window, synced to Studio playback — good for a second monitor"
          >
            Pop out lyrics/chords
          </button>
          <button
            className="bg-accent text-black text-xs font-medium px-3 py-1.5 rounded"
            onClick={() => downloadSongJson(song)}
          >
            Export JSON
          </button>
          <button
            className="bg-accent text-black text-xs font-medium px-3 py-1.5 rounded"
            onClick={() => downloadSongMidi(song)}
            title="Export this song as a multi-track MIDI file (.mid) — chords, bass, and drums. Works with any DAW."
          >
            Export MIDI
          </button>
          <button
            className="bg-accent text-black text-xs font-medium px-3 py-1.5 rounded"
            onClick={async () => {
              try {
                const result = await pushSongToAbleton(song);
                alert(`Sent "${result.title}" to Ableton — cue points, tempo, and clip scaffolds are ready. Right-click any track → "Apply Song Blueprint" to place cue points, or "Generate Chord Clips" / "Generate Drum Clips" to build MIDI.`);
              } catch (err) {
                alert(`Couldn't reach the Ableton bridge (osc-bridge at localhost:5200). Make sure it's running, then try again.\n\nError: ${err instanceof Error ? err.message : String(err)}`);
              }
            }}
            title="Push this song's blueprint directly to Ableton via the osc-bridge — writes the .trackdraft.json to the extension's storage directory so it appears in the right-click picker immediately, no manual sync script needed"
          >
            Send to Ableton
          </button>
        </div>
      </div>

      {song.sections.length === 0 ? (
        <p className="text-inkMuted text-sm">
          Add sections in the Structure tab first — Studio shows your song's arrangement here once it has some.
        </p>
      ) : (
        <ArrangementTimeline song={song} />
      )}
    </div>
  );
}