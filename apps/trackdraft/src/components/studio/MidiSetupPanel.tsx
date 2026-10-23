import { useEffect, useState } from "react";
import {
  listMidiInputs,
  listMidiOutputs,
  getMidiOutput,
  midiOutSupported,
  sendTestNote,
  type MidiOutputInfo,
} from "../../lib/playback/liveMidiOut";
import { runLoopbackTest, type LoopbackResult } from "../../lib/playback/midiSelfTest";
import { useMidiSettingsStore } from "../../store/midiSettingsStore";
import { useDawTargetStore } from "../../store/dawTargetStore";
import { useSongStore } from "../../store/songStore";
import { LIVE_TEMPLATE_TRACK_NAMES } from "../../lib/liveTemplate";
import {
  GM_DRUM_CHANNEL,
  ROUTING_PROFILES,
  STEM_IDS,
  STEM_LABELS,
  type RoutingProfileId,
  type StemId,
} from "../../lib/stems";

/** Where a stem lands in the Live template. Only the Live target has named
 *  tracks to land on — every other DAW gets "channel N" on a track the user
 *  makes themselves. */
const LIVE_TEMPLATE_TRACK: Record<StemId, string> = {
  drums: LIVE_TEMPLATE_TRACK_NAMES[0],
  bass: LIVE_TEMPLATE_TRACK_NAMES[1],
  chords: LIVE_TEMPLATE_TRACK_NAMES[2],
  color: LIVE_TEMPLATE_TRACK_NAMES[3],
  melody: LIVE_TEMPLATE_TRACK_NAMES[4],
};

const CHANNEL_OPTIONS = Array.from({ length: 16 }, (_, i) => i + 1);
const PROGRAM_OPTIONS = Array.from({ length: 128 }, (_, i) => i + 1);

/** The MIDI Out setup panel — the real control surface for getting
 *  TrackDraft's live MIDI into a DAW. A proper output-port picker, an
 *  editable per-stem channel map that persists (so it can match however your
 *  DAW actually listens), the instrument each stem *should* be heard on, a
 *  Test button per stem so you can verify the port + channel arrive before
 *  pressing Play, and an output-latency calibration (without the Live clock
 *  re-anchoring on every beat, this is what stops another DAW sounding late).
 *
 *  Channel presets are profiles from `lib/stems.ts`: General MIDI (the
 *  export default) or the Live template (the live-out default). Switching
 *  presets rewrites channels only — the instrument choices belong to the
 *  song, so they survive. */
export default function MidiSetupPanel({ onClose, inline = false }: { onClose: () => void; inline?: boolean }) {
  const midiOutputId = useMidiSettingsStore((s) => s.midiOutputId);
  const setMidiOutputId = useMidiSettingsStore((s) => s.setMidiOutputId);
  const routing = useMidiSettingsStore((s) => s.routing);
  const setChannel = useMidiSettingsStore((s) => s.setChannel);
  const applyProfile = useMidiSettingsStore((s) => s.applyProfile);
  const latencyMs = useMidiSettingsStore((s) => s.latencyMs);
  const setLatencyMs = useMidiSettingsStore((s) => s.setLatencyMs);
  const target = useDawTargetStore((s) => s.target);
  const song = useSongStore((s) => s.currentSong());
  const updateCurrentSong = useSongStore((s) => s.updateCurrentSong);

  const [outputs, setOutputs] = useState<MidiOutputInfo[]>([]);
  const [inputCount, setInputCount] = useState(0);
  const [selfTest, setSelfTest] = useState<{ running: boolean; result?: LoopbackResult }>({ running: false });
  /** In-progress instrument name, committed on blur — `updateCurrentSong`
   *  pushes an undo entry per call, so a keystroke-by-keystroke write would
   *  bury the song's history under a single rename. */
  const [nameDraft, setNameDraft] = useState<{ stem: StemId; value: string } | null>(null);
  const supported = midiOutSupported();
  const instruments = song?.instruments ?? {};

  useEffect(() => {
    setNameDraft(null);
  }, [song?.id]);

  /** Instrument intent lives on the song (it's a musical choice that travels
   *  with the export), so edits go through the song store, not this panel's
   *  own state. */
  function setInstrument(stem: StemId, patch: { name?: string; gmProgram?: number }) {
    updateCurrentSong((s) => {
      const current = s.instruments?.[stem] ?? {};
      const next = { ...current, ...patch };
      const cleaned = {
        name: next.name?.trim() ? next.name.trim() : undefined,
        gmProgram: next.gmProgram,
      };
      return { ...s, instruments: { ...s.instruments, [stem]: cleaned } };
    });
  }

  // Refresh the port list each time the panel opens — the IAC bus may
  // have appeared/disappeared since the page loaded. Also reconcile the
  // persisted port id: Web MIDI ids aren't stable across browser restarts,
  // so a saved id from a previous session can point at nothing — clear it
  // so the "MIDI ●" dot and Play don't silently target a phantom port.
  useEffect(() => {
    if (!supported) return;
    let alive = true;
    listMidiOutputs()
      .then((outs) => {
        if (!alive) return;
        setOutputs(outs);
        const ids = new Set(outs.map((o) => o.id));
        const current = useMidiSettingsStore.getState().midiOutputId;
        if (current && !ids.has(current)) {
          useMidiSettingsStore.getState().setMidiOutputId("");
        }
      })
      .catch(() => setOutputs([]));
    // Inputs aren't streamed to, but the count is diagnostic: a virtual bus
    // with no matching input can't be loopback-tested, and "0 inputs" is
    // itself the answer to "why doesn't the self-test pass?".
    listMidiInputs()
      .then((ins) => {
        if (alive) setInputCount(ins.length);
      })
      .catch(() => setInputCount(0));
    return () => {
      alive = false;
    };
  }, [supported]);

  async function runSelfTest() {
    if (!midiOutputId) return;
    setSelfTest({ running: true });
    const result = await runLoopbackTest(midiOutputId);
    setSelfTest({ running: false, result });
  }

  async function testStem(stem: StemId) {
    if (!midiOutputId) return;
    const output = await getMidiOutput(midiOutputId);
    if (output) sendTestNote(output, routing[stem].channel);
  }

  const card = (
    <div
      className={
        inline
          ? "rounded border border-edge bg-panel p-4"
          : "w-[30rem] max-w-full max-h-[85vh] overflow-y-auto rounded border border-edge bg-panel p-4 shadow-lg"
      }
      onClick={(e) => e.stopPropagation()}
    >
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-medium text-sm">MIDI Out setup</h3>
          {!inline && (
            <button className="text-inkMuted hover:text-ink leading-none text-sm" onClick={onClose} title="Close">
              &times;
            </button>
          )}
        </div>

        {!supported ? (
          <div className="text-xs text-inkMuted space-y-2">
            <p>
              Web MIDI isn't available in this browser — it's desktop-Chrome only (no Safari, iPad, or iPhone browser
              supports it).
            </p>
            <p>
              Open TrackDraft in <span className="text-ink">desktop Chrome on the Mac</span> for real-time MIDI out. From
              here you can still{" "}
              <span className="text-ink">{target === "live" ? "Send to Ableton" : "Export a .mid file"}</span> and load
              it in your DAW.
            </p>
          </div>
        ) : (
          <>
            <label className="font-mono text-3xs uppercase tracking-wider text-inkMuted block mb-1">
              Output port
            </label>
            <div className="space-y-1 mb-4">
              <label className="flex items-center gap-2 text-xs text-inkMuted cursor-pointer">
                <input type="radio" checked={!midiOutputId} onChange={() => setMidiOutputId("")} />
                Off
              </label>
              {outputs.map((o) => (
                <label key={o.id} className="flex items-center gap-2 text-xs text-ink cursor-pointer">
                  <input type="radio" checked={midiOutputId === o.id} onChange={() => setMidiOutputId(o.id)} />
                  <span className="font-mono">{o.name}</span>
                </label>
              ))}
              {outputs.length === 0 && (
                <p className="text-xs text-inkMuted">
                  No MIDI outputs found — set up the IAC Driver in Audio MIDI Setup, then reopen this panel.
                </p>
              )}
            </div>

            <div className="border border-edge rounded p-2 mb-4">
              <div className="flex items-center gap-2 mb-1">
                <span className="font-mono text-3xs uppercase tracking-wider text-inkMuted">Self-test</span>
                <span className="font-mono text-2xs text-inkMuted/70">
                  {outputs.length} out · {inputCount} in
                </span>
                <span className="flex-1" />
                <button
                  className="border border-edge text-inkMuted hover:text-ink rounded px-2 py-0.5 text-2xs font-mono disabled:opacity-30"
                  disabled={!midiOutputId || selfTest.running}
                  onClick={runSelfTest}
                  title="Writes a quiet probe note out the selected port and listens for it coming back on the same bus"
                >
                  {selfTest.running ? "Testing…" : "Run loopback"}
                </button>
              </div>
              <p className="text-2xs text-inkMuted">
                Sends a silent probe and waits for it to return on the same bus — proves the OS route works, so a
                silent DAW means the problem is downstream (MIDI From / channel filter), not here.
              </p>
              {selfTest.result && (
                <p className={`text-2xs mt-1 ${selfTest.result.ok ? "text-accent" : "text-warn"}`}>
                  {selfTest.result.ok ? (
                    <>
                      ✓ returned from <span className="font-mono">{selfTest.result.inputName}</span> in{" "}
                      {selfTest.result.roundTripMs}ms — this port reaches its bus.
                    </>
                  ) : (
                    <>
                      ✗ {selfTest.result.reason}. <span className="text-inkMuted">{selfTest.result.hint}</span>
                    </>
                  )}
                </p>
              )}
            </div>

            <label className="font-mono text-3xs uppercase tracking-wider text-inkMuted block mb-1">
              Channels → stems
            </label>
            <div className="flex items-center gap-1 mb-2 flex-wrap">
              {(Object.keys(ROUTING_PROFILES) as RoutingProfileId[]).map((id) => (
                <button
                  key={id}
                  className="border border-edge text-inkMuted hover:text-ink rounded px-2 py-0.5 text-2xs font-mono"
                  onClick={() => applyProfile(id)}
                  title={ROUTING_PROFILES[id].description}
                >
                  {ROUTING_PROFILES[id].label}
                </button>
              ))}
              <span className="text-2xs text-inkMuted/60">presets rewrite channels + default instruments</span>
            </div>
            <div className="border border-edge rounded overflow-hidden mb-2">
              {STEM_IDS.map((stem) => {
                const instrument = instruments[stem] ?? {};
                const program = instrument.gmProgram ?? routing[stem].gmProgram;
                return (
                  <div key={stem} className="px-2 py-1.5 border-b border-edge last:border-b-0 space-y-1">
                    <div className="flex items-center gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="text-xs text-ink">{STEM_LABELS[stem]}</div>
                        <div className="font-mono text-3xs text-inkMuted">
                          {target === "live"
                            ? `→ ${LIVE_TEMPLATE_TRACK[stem]}`
                            : `→ ch ${routing[stem].channel}`}
                          {stem === "drums" ? " · percussion" : ""}
                        </div>
                      </div>
                      <select
                        className="bg-panelAlt border border-edge rounded px-1 py-0.5 text-xs font-mono text-ink"
                        value={routing[stem].channel}
                        onChange={(e) => setChannel(stem, parseInt(e.target.value, 10))}
                        title={`${STEM_LABELS[stem]} streams on MIDI channel ${routing[stem].channel}`}
                      >
                        {CHANNEL_OPTIONS.map((c) => (
                          <option key={c} value={c}>
                            ch {c}
                          </option>
                        ))}
                      </select>
                      <button
                        className="border border-edge text-inkMuted hover:text-ink rounded px-2 py-0.5 text-2xs font-mono disabled:opacity-30"
                        onClick={() => testStem(stem)}
                        disabled={!midiOutputId}
                        title={`Send a test note on channel ${routing[stem].channel}`}
                      >
                        Test
                      </button>
                    </div>
                    <div className="flex items-center gap-2">
                      <input
                        className="flex-1 min-w-0 bg-panelAlt border border-edge rounded px-1.5 py-0.5 text-2xs text-ink placeholder:text-inkMuted/50"
                        value={nameDraft?.stem === stem ? nameDraft.value : (instrument.name ?? "")}
                        placeholder={routing[stem].instrumentName ?? "instrument"}
                        onChange={(e) => setNameDraft({ stem, value: e.target.value })}
                        onBlur={() => {
                          if (nameDraft?.stem !== stem) return;
                          setInstrument(stem, { name: nameDraft.value });
                          setNameDraft(null);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                        }}
                        disabled={!song}
                        title={
                          song
                            ? `What to load on this stem's track in "${song.title}" — written into the exported .mid as the instrument name`
                            : "Open a song to record its instruments"
                        }
                      />
                      <select
                        className="bg-panelAlt border border-edge rounded px-1 py-0.5 text-2xs font-mono text-ink"
                        value={program ?? ""}
                        onChange={(e) => {
                          const raw = e.target.value;
                          setInstrument(stem, { gmProgram: raw === "" ? undefined : parseInt(raw, 10) });
                        }}
                        disabled={!song || stem === "drums"}
                        title={
                          stem === "drums"
                            ? "GM reserves channel 10 for percussion — a drum program change does nothing"
                            : "General MIDI program, written as a program change so a GM-compatible DAW assigns the sound on import"
                        }
                      >
                        <option value="">no program</option>
                        {PROGRAM_OPTIONS.map((p) => (
                          <option key={p} value={p}>
                            GM {p}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                );
              })}
            </div>
            {target !== "live" && routing.drums.channel !== GM_DRUM_CHANNEL && (
              <p className="text-2xs text-warn mb-2">
                General MIDI expects drums on channel {GM_DRUM_CHANNEL} — an exported .mid will still be correct, but a
                GM-compatible DAW will play a streamed drum part on channel {routing.drums.channel} with a pitched
                instrument.
              </p>
            )}

            <div className="flex items-center gap-2 mb-4">
              <label className="font-mono text-3xs uppercase tracking-wider text-inkMuted">Output latency</label>
              <input
                type="range"
                min={-100}
                max={200}
                step={1}
                value={latencyMs}
                onChange={(e) => setLatencyMs(parseInt(e.target.value, 10))}
                className="flex-1"
                title="Nudge the whole stream earlier (negative) or later (positive) to match your DAW's input buffer"
              />
              <span className="font-mono text-2xs text-ink w-14 text-right">
                {latencyMs > 0 ? "+" : ""}
                {latencyMs} ms
              </span>
              <button
                className="text-2xs font-mono text-inkMuted hover:text-ink"
                onClick={() => setLatencyMs(0)}
                title="Reset latency to zero"
              >
                reset
              </button>
            </div>

            <div className="border-t border-edge pt-3 text-xs text-inkMuted space-y-1.5">
              <p>
                <span className="text-ink">Play</span> streams each stem on its channel through the selected port.{" "}
                <span className="text-ink">Test</span> fires one note so you can confirm a track hears it first.
              </p>
              {target === "live" ? (
                <p>
                  In Live, point each template track's <span className="text-ink">MIDI From</span> at this port, filtered
                  to its channel. <span className="text-ink font-mono">chord</span> can listen to all channels.
                </p>
              ) : (
                <p>
                  In any DAW, create a track per stem and set its MIDI input to this port, filtered to the stem's
                  channel. Either point each track at its own channel, or use{" "}
                  <span className="text-ink">Export MIDI</span> for a file that already has the routing and instrument
                  hints baked in.
                </p>
              )}
            </div>
          </>
        )}

        {!inline && (
          <button
            className="mt-4 w-full border border-edge text-inkMuted hover:text-ink rounded px-3 py-1.5 text-xs"
            onClick={onClose}
          >
            Done
          </button>
        )}
    </div>
  );

  if (inline) return card;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      {card}
    </div>
  );
}
