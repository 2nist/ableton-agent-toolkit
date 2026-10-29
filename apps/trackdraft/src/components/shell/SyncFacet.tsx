import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  DAW_TARGETS,
  DAW_TARGET_DESCRIPTIONS,
  DAW_TARGET_SHORT,
  useDawTargetStore,
} from "../../store/dawTargetStore";
import { useMidiSettingsStore } from "../../store/midiSettingsStore";
import { useSongStore } from "../../store/songStore";
import { useMidiOutputs } from "../../hooks/useMidiOutputs";
import { getAbletonClock } from "../../lib/playback/abletonClock";
import AbletonStatus from "../settings/AbletonStatus";

/**
 * Sync — the inspector facet for "what is the clock, and where does the
 * MIDI go". This is the quick-access half of the MIDI setup: the port, the
 * target, Live's tempo/position readout and the drift nudge, reachable from
 * any view because they affect every view.
 *
 * The full panel (per-stem channels, instruments, latency calibration,
 * loopback test) stays in Settings — it is configuration you visit once,
 * not a control you reach for mid-phrase. Retiring the Studio view would
 * otherwise have taken the live transport controls with it.
 */
export default function SyncFacet() {
  const navigate = useNavigate();
  const { songId } = useParams<{ songId: string }>();
  const song = useSongStore((s) => s.currentSong());
  const updateCurrentSong = useSongStore((s) => s.updateCurrentSong);
  const target = useDawTargetStore((s) => s.target);
  const setTarget = useDawTargetStore((s) => s.setTarget);
  const midiOutputId = useMidiSettingsStore((s) => s.midiOutputId);
  const setMidiOutputId = useMidiSettingsStore((s) => s.setMidiOutputId);
  const { supported, outputs } = useMidiOutputs();

  const [connected, setConnected] = useState(false);
  const [livePlaying, setLivePlaying] = useState(false);
  const [telemetry, setTelemetry] = useState<{ bpm?: number; scale?: string; rootNote?: string }>({});

  // Only talk to the bridge while Live is the chosen target — otherwise
  // this opens a WebSocket nobody asked for on every song route.
  useEffect(() => {
    if (target !== "live") {
      setConnected(false);
      setLivePlaying(false);
      setTelemetry({});
      return;
    }
    const clock = getAbletonClock();
    clock.connect();
    return clock.onChange((state) => {
      setConnected(state.connected);
      setLivePlaying(state.isPlaying);
      setTelemetry({ bpm: state.abletonBpm, scale: state.abletonScale, rootNote: state.abletonRootNote });
    });
  }, [target]);

  if (!song) return null;

  function pushTempo() {
    if (!song) return;
    getAbletonClock().sendCommand("/live/song/set/tempo", [song.bpm]);
  }

  /** Positive offsets delay the stream, which is what "sounds late" needs. */
  function nudgeOffset(delta: number) {
    updateCurrentSong((s) => {
      const next = Math.round(((s.beatOffset ?? 0) + delta) * 100) / 100;
      return { ...s, beatOffset: next };
    });
  }

  function setIdleOffset(value: number) {
    updateCurrentSong((s) => ({ ...s, beatOffset: value }));
  }

  const offset = song.beatOffset ?? 0;

  return (
    <div className="space-y-3 text-[11px]">
      <section className="space-y-1.5">
        <h3 className="text-3xs font-mono uppercase tracking-widest text-inkMuted">Playing into</h3>
        <div className="flex flex-wrap gap-1">
          {DAW_TARGETS.map((mode) => (
            <button
              key={mode}
              type="button"
              className={`px-2 py-0.5 rounded border text-[10px] font-mono ${
                target === mode ? "border-accent/50 bg-panelAlt text-ink" : "border-edge/70 text-inkMuted hover:text-ink"
              }`}
              onClick={() => setTarget(mode)}
              title={DAW_TARGET_DESCRIPTIONS[mode]}
            >
              {DAW_TARGET_SHORT[mode]}
            </button>
          ))}
        </div>
      </section>

      <section className="space-y-1.5">
        <h3 className="text-3xs font-mono uppercase tracking-widest text-inkMuted">MIDI out</h3>
        {!supported ? (
          <p className="text-inkMuted">This browser build has no Web MIDI. The desktop app and Chrome do.</p>
        ) : (
          <>
            <select
              className="w-full bg-panelAlt border border-edge rounded px-1.5 py-1 font-mono text-[10px]"
              value={midiOutputId}
              onChange={(e) => setMidiOutputId(e.target.value)}
              title="Where the live MIDI stream is sent"
            >
              <option value="">Off — no live MIDI</option>
              {outputs.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
            {outputs.length === 0 && (
              <p className="text-inkMuted leading-snug">
                No ports found — open Audio MIDI Setup and enable the IAC Driver, then reopen this facet.
              </p>
            )}
          </>
        )}
        <button
          type="button"
          className="text-[10px] font-mono text-accent/80 hover:text-accent"
          onClick={() => navigate(`/song/${songId ?? song.id}/settings`)}
          title="Per-stem channels, instruments, latency calibration and the loopback test"
        >
          full MIDI setup →
        </button>
      </section>

      {target === "live" && (
        <section className="space-y-1.5">
          <h3 className="text-3xs font-mono uppercase tracking-widest text-inkMuted">Live</h3>
          <AbletonStatus connected={connected} />
          {connected && (
            <p className="font-mono text-[10px] text-inkMuted">
              {livePlaying ? "▶ rolling" : "■ stopped"}
              {telemetry.bpm !== undefined && ` · ${telemetry.rootNote ?? ""} ${telemetry.scale ?? ""} ${telemetry.bpm} bpm`}
            </p>
          )}
          <button
            type="button"
            className="px-2 py-0.5 rounded border border-edge/70 text-[10px] font-mono text-inkMuted hover:text-ink"
            onClick={pushTempo}
            title={`Send ${song.bpm} BPM to Live's tempo`}
          >
            push {song.bpm} BPM →
          </button>
        </section>
      )}

      <section className="space-y-1.5">
        <h3 className="text-3xs font-mono uppercase tracking-widest text-inkMuted">Drift</h3>
        <div className="flex items-center gap-1">
          <button
            type="button"
            className="px-1.5 py-0.5 rounded border border-edge/70 font-mono text-[10px] text-inkMuted hover:text-ink"
            onClick={() => nudgeOffset(-0.01)}
            title="Stream earlier by 10 ms"
          >
            −
          </button>
          <input
            type="number"
            step="0.01"
            className="w-16 bg-panelAlt border border-edge rounded px-1 py-0.5 font-mono text-[10px] text-center"
            value={offset}
            onChange={(e) => {
              const value = parseFloat(e.target.value);
              if (!Number.isNaN(value)) setIdleOffset(value);
            }}
            title="Beat offset — positive delays the stream to match a laggy DAW"
          />
          <button
            type="button"
            className="px-1.5 py-0.5 rounded border border-edge/70 font-mono text-[10px] text-inkMuted hover:text-ink"
            onClick={() => nudgeOffset(0.01)}
            title="Stream later by 10 ms"
          >
            +
          </button>
          <button
            type="button"
            className="ml-auto text-[10px] font-mono text-inkMuted hover:text-accent"
            onClick={() => setIdleOffset(0)}
            title="Reset the drift correction"
          >
            reset
          </button>
        </div>
      </section>
    </div>
  );
}
