import { useEffect, useState } from "react";
import { KEY_ROOTS } from "@music-theory/core";
import type { NoteName, ScaleType } from "@music-theory/core";
import { useSongStore, type ClockSource } from "../../store/songStore";
import { downloadSongJson, pushSongToAbleton } from "../../lib/exportImport";
import { downloadSongMidi } from "../../lib/midiExport";
import { getSongTransport } from "../../lib/playback/songTransport";
import { getAbletonClock } from "../../lib/playback/abletonClock";
import {
  getLiveMidiScheduler,
  getMidiOutput,
  listMidiOutputs,
  midiOutSupported,
  type MidiOutputInfo,
} from "../../lib/playback/liveMidiOut";
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
  const [sendingToAbleton, setSendingToAbleton] = useState(false);
  const [abletonConnected, setAbletonConnected] = useState(false);
  const [abletonTelemetry, setAbletonTelemetry] = useState<{
    bpm?: number;
    scale?: string;
    rootNote?: string;
  }>({});
  const [midiOutputs, setMidiOutputs] = useState<MidiOutputInfo[]>([]);
  const [midiOutputId, setMidiOutputId] = useState<string>("");

  // Populated once on mount — Web MIDI's permission prompt (where the
  // browser requires one at all) fires from this call, not from Play, so
  // hitting Play never has to wait on a permission dialog mid-transport.
  useEffect(() => {
    if (!midiOutSupported()) return;
    listMidiOutputs()
      .then(setMidiOutputs)
      .catch(() => setMidiOutputs([]));
  }, []);

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
      getLiveMidiScheduler().stop();
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

  async function togglePlayback() {
    const transport = getSongTransport();
    if (isPlaying) {
      transport.stop();
      getLiveMidiScheduler().stop();
      return;
    }
    if (clockSource === "ableton") {
      transport.syncToAbleton(song);
      return;
    }
    transport.play(song);
    // Live MIDI-out is opt-in via the port picker — no port selected means
    // Play stays exactly what it's always been, a silent playhead.
    if (midiOutputId) {
      const output = await getMidiOutput(midiOutputId);
      if (output) getLiveMidiScheduler().start(song, output);
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
          {midiOutSupported() && (
            <select
              className="bg-panelAlt border border-edge rounded text-xs px-2 py-1 text-inkMuted"
              value={midiOutputId}
              onChange={(e) => setMidiOutputId(e.target.value)}
              disabled={isPlaying}
              title="Stream chords/bass/drums as live MIDI to this port while playing — drums on ch.1, bass on ch.2, chords on ch.3. Point Ableton tracks' MIDI input at this same port (and the matching channel) to hear it. Leave on 'Off' for a silent playhead only."
            >
              <option value="">MIDI Out: Off</option>
              {midiOutputs.map((o) => (
                <option key={o.id} value={o.id}>MIDI Out: {o.name}</option>
              ))}
            </select>
          )}
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
            className="bg-accent text-black text-xs font-medium px-3 py-1.5 rounded disabled:opacity-40"
            disabled={sendingToAbleton}
            onClick={async () => {
              // Ableton's cue-point creation isn't safe against two
              // near-simultaneous applyBlueprint runs for the same song
              // (observed directly: it can crash the whole extension
              // host) — disabling while a request's in flight keeps an
              // accidental double-click from recreating that race.
              if (sendingToAbleton) return;
              setSendingToAbleton(true);
              try {
                const result = await pushSongToAbleton(song);
                alert(`Sent "${result.title}" to Ableton — cue points, tempo, and Chords/Bass/Drums tracks are being populated with real MIDI now (the extension polls its command queue every 2s). Load an instrument on each track in Ableton to hear it.`);
              } catch (err) {
                alert(`Couldn't reach the Ableton bridge (osc-bridge at localhost:5200). Make sure it's running, then try again.\n\nError: ${err instanceof Error ? err.message : String(err)}`);
              } finally {
                setSendingToAbleton(false);
              }
            }}
            title="Push this song's blueprint to Ableton via the osc-bridge — the bridge itself queues an apply command, which creates/reuses Chords, Bass, and Drums MIDI tracks and fills them with real clips, no manual right-clicking needed"
          >
            {sendingToAbleton ? "Sending…" : "Send to Ableton"}
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