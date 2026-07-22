import { useEffect, useState } from "react";
import { useSongStore } from "../../store/songStore";
import { downloadSongJson } from "../../lib/exportImport";
import { getSongTransport } from "../../lib/playback/songTransport";
import { getAbletonClock } from "../../lib/playback/abletonClock";
import ArrangementTimeline from "./ArrangementTimeline";

type ClockSource = "app" | "ableton";

/** The song's home tab. Top row is controls (Export, Play/Stop, the
 *  clock-source toggle — the intended anchor for whatever this tab's
 *  actions grow into, not a one-off button placement) above the
 *  arrangement timeline — the "what will Ableton build" breakdown that
 *  used to sit below the timeline was cut entirely, since it only
 *  restated section names/chord counts the timeline's own hover already
 *  shows. */
export default function StudioView() {
  const currentSong = useSongStore((s) => s.currentSong());
  const [isPlaying, setIsPlaying] = useState(false);
  const [clockSource, setClockSource] = useState<ClockSource>("app");
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

  return (
    <div className="p-6 max-w-5xl space-y-4">
      <div className="flex items-center justify-end gap-2 border-b border-edge pb-3 flex-wrap">
        <div className="flex items-center gap-1 mr-2" title="Which clock drives playback position — the app's own player, or Ableton's transport over osc-bridge">
          {(["app", "ableton"] as const).map((mode) => (
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
              {mode === "app" ? "App" : "Ableton"}
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
              <button
                className="text-xs px-2 py-1 rounded border border-edge text-inkMuted hover:text-ink disabled:opacity-40"
                onClick={() => getSongTransport().calibrate()}
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
