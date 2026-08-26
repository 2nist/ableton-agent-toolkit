import { useEffect, useMemo, useState } from "react";
import { APC_MINI_MK2 } from "@hardware/controller-bridge";
import {
  bankSlotPad,
  drumPadAt,
  fxSlotAt,
  getHit,
  padLength,
  padLevel,
  padMuted,
  rackNoteAt,
  regionOf,
  renderDrumRackLeds,
  sceneButtonRole,
  stepNumber,
  trackButtonRole,
  type DrumRackPattern,
} from "@hardware/step-sequencer";
import * as hub from "./lib/hub";
import type { MidiStatus } from "./lib/midi";
import { useSequencerStore, type PortPicks } from "./lib/store";

const MATRIX = APC_MINI_MK2.matrices.clip_launch_buttons;

/** Map a palette color value (from renderDrumRackLeds) to a CSS class. */
function colorClass(color: number, channel?: number): string {
  if (color === 13) return "hit"; // yellow
  if (color === 41) return "ocean"; // selected drum pad
  if (color === 21) return channel ? "pls" : "grn"; // green / pulse
  if (color === 9) return "amber"; // has-seq / loop-end / beyond-length
  if (color === 45) return "blue"; // fx on
  if (color === 5) return "red"; // muted
  return "off";
}

const SCENE_ROLES = [
  "0 · play/stop", "1 · solo pad", "2 · mute pad", "3 · resolution",
  "4 · pattern A/B", "5 · clear pad", "6 · follow Live", "7 · commit clip",
].map((lbl, i) => ({ lbl, midi: `note ${112 + i}`, role: sceneButtonRole(i) }));

const TRACK_ROLES = Array.from({ length: 8 }, (_, i) => ({
  lbl: `FX${i + 1} · ${i < 4 ? "toggle" : "momentary"}`,
  midi: `note ${100 + i}`,
  role: trackButtonRole(i),
}));

const FADER_ROLES = Array.from({ length: 8 }, (_, i) => ({
  lbl: `FX${i + 1} · device param ${i + 1}`,
  midi: `cc ${48 + i}`,
}));

export default function App() {
  const s = useSequencerStore();
  const { drum, selectedPad, fx, shiftHeld, bpm, resolution, playing, step, flashNote, lastMidi, bank, faderMode, liveMode, advanced } = s;
  const [hover, setHover] = useState<{ row: number; col: number } | null>(null);
  const [midiStatus, setMidiStatus] = useState<MidiStatus | null>(null);
  const [ledReport, setLedReport] = useState<string>("");
  const [deviceVals, setDeviceVals] = useState<number[]>(() => Array(9).fill(0.5));

  useEffect(() => {
    hub.start();
    hub.refreshMidiPorts().then(setMidiStatus).catch(() => {});
    return () => hub.stop();
  }, []);

  // Clear the audition flash shortly after it fires.
  useEffect(() => {
    if (flashNote === null) return;
    const t = setTimeout(() => useSequencerStore.getState().setFlashNote(null), 250);
    return () => clearTimeout(t);
  }, [flashNote]);

  async function pickPort(kind: keyof PortPicks, value: string) {
    const picks: PortPicks = { ...s.portPicks, [kind]: value || undefined };
    await hub.applyPortPicks(picks);
  }

  // The LED colors the controller would show — the UI mirrors them 1:1.
  const leds = useMemo(
    () =>
      renderDrumRackLeds(MATRIX, {
        drum,
        selectedPad,
        fx,
        clock: { isPlaying: playing, bpm, resolution, fractionalStep: step, step, phase: 0 },
      }),
    [drum, selectedPad, fx, playing, bpm, resolution, step],
  );
  const ledByCell = useMemo(
    () => new Map(leds.map((c) => [`${c.row},${c.col}`, c])),
    [leds],
  );

  const hoverText = hover
    ? describeCell(hover.row, hover.col, drum, selectedPad, fx)
    : "Tap a drum pad to audition it · SHIFT + tap selects it for editing · tap the top grid to place steps · SHIFT + a step sets that pad's length.";

  return (
    <div className="wrap">
      <header>
        <h1>APC Sequencer — Ableton Drum Rack</h1>
        <p>Drum-Rack-style 8×8 grid · 16 pads · up to 32 steps each (per-pad length via SHIFT+step) · FX · faders → device control.</p>
      </header>

      <div className="chips">
        <span className="chip">Pad <b>{selectedPad + 1} · note {rackNoteAt(4 + Math.floor(selectedPad / 4), selectedPad % 4)}</b></span>
        <span className="chip">Length <b>{padLength(drum, selectedPad)}</b></span>
        <span className={shiftHeld ? "chip shift" : "chip"}>SHIFT {shiftHeld ? "on" : "off"}</span>
        <span className={playing ? "chip play" : "chip"}>{playing ? "▶ playing" : "● stopped"}</span>
        <span className="chip">Clock <b>{s.clockSource}</b></span>
        <span className={abletonClass(s.abletonConnected)}>{s.abletonConnected ? (s.abletonPlaying ? "Live ▶" : "Live ✓") : "Live —"}</span>
        <span className="chip">MIDI <b>{s.midiDevice ?? "none (simulator)"}</b></span>
        <span className="chip">Rack out <b>{s.rackPort ?? "none"}</b></span>
        {advanced ? <span className="chip">Bank <b>{bank}</b></span> : null}
        <span className="chip">Faders <b>{advanced ? faderMode : "device"}</b></span>
        {advanced ? <span className={liveMode ? "chip play" : "chip"}>LIVE {liveMode ? "on" : "off"}</span> : null}
        <span
          className={advanced ? "chip play" : "chip"}
          onClick={() => useSequencerStore.getState().setAdvanced(!advanced)}
          style={{ cursor: "pointer" }}
          title="Toggle Basic (sequencer + pads) vs Advanced (banks/fader-modes/live)"
        >
          {advanced ? "Advanced" : "Basic"}
        </span>
      </div>

      <div className="layout">
        <div className="panel grid-panel">
          <div className="grid-head">
            <span className="title">STEP SEQUENCER — pad <b>{selectedPad + 1}</b> (note <b>{rackNoteAt(4 + Math.floor(selectedPad / 4), selectedPad % 4)}</b>) · length <b>{padLength(drum, selectedPad)}</b> · SHIFT+step = set length</span>
            <span className="title">{playing ? `▶ step ${step + 1}` : ""}</span>
          </div>
          <div className="grid-head sub">
            <span className="title">
              {advanced
                ? "TOP 4×8 = steps (selected pad) · BOTTOM-LEFT 4×4 = DRUM PADS 36–51 · BOTTOM-RIGHT = MODE ROW (Bank/Device/Live) + FX"
                : "TOP 4×8 = steps (selected pad) · BOTTOM-LEFT 4×4 = DRUM PADS 36–51 · BOTTOM-RIGHT 4×4 = FX"}
            </span>
          </div>

          <div className="grid">
            <div className="axis col" />
            {Array.from({ length: 8 }, (_, c) => (
              <div key={`h${c}`} className="axis col">{c + 1}</div>
            ))}
            {Array.from({ length: 8 }, (_, row) => (
              <div key={`r${row}`} className="grid-row">
                <div className="axis">{row + 1}</div>
                {Array.from({ length: 8 }, (_, col) => renderPad(ledByCell, row, col, drum, selectedPad, fx, flashNote, advanced, setHover))}
              </div>
            ))}
          </div>

          <div className="controls">
            <button className={shiftHeld ? "shift on" : "shift"} onClick={() => useSequencerStore.getState().setShift(!shiftHeld)}>SHIFT</button>
            <div className="sep" />
            <button className={playing ? "play on" : "play"} onClick={() => hub.togglePlay()}>{playing ? "■ Stop" : "▶ Play"}</button>
            <button onClick={() => useSequencerStore.getState().clearSelected()}>Clear pad</button>
            <button onClick={() => useSequencerStore.getState().randomizeSelected()}>Randomize pad</button>
            <button onClick={() => useSequencerStore.getState().reset()}>Reset</button>
          </div>
          <div className="controls">
            <label className="ctl">BPM
              <input type="number" min={20} max={300} value={bpm}
                onChange={(e) => useSequencerStore.getState().setBpm(Number(e.target.value))} />
            </label>
            <label className="ctl">Res
              <select value={resolution} onChange={(e) => useSequencerStore.getState().setResolution(e.target.value as "16" | "8")}>
                <option value="16">1/16</option>
                <option value="8">1/8</option>
              </select>
            </label>
            <label className="ctl">Clock
              <select value={s.clockSource} onChange={(e) => hub.setClockSource(e.target.value as "free" | "ableton")}>
                <option value="free">free</option>
                <option value="ableton">follow Live</option>
              </select>
            </label>
            <label className="ctl">Drum Rack track
              <input type="number" min={0} max={15} value={s.targetTrack}
                onChange={(e) => hub.setTargetTrack(Number(e.target.value))} />
            </label>
          </div>
          {advanced ? (
            <div className="controls">
              <button className={bank === "A" ? "play on" : ""} onClick={() => useSequencerStore.getState().setBank("A")}>Bank A</button>
              <button className={bank === "B" ? "play on" : ""} onClick={() => useSequencerStore.getState().setBank("B")}>Bank B</button>
              <div className="sep" />
              <button className={faderMode === "volume" ? "play on" : ""} onClick={() => useSequencerStore.getState().setFaderMode("volume")}>Vol</button>
              <button className={faderMode === "pan" ? "play on" : ""} onClick={() => useSequencerStore.getState().setFaderMode("pan")}>Pan</button>
              <button className={faderMode === "send" ? "play on" : ""} onClick={() => useSequencerStore.getState().setFaderMode("send")}>Send</button>
              <button className={faderMode === "device" ? "play on" : ""} onClick={() => useSequencerStore.getState().setFaderMode("device")}>Device</button>
              <div className="sep" />
              <button className={liveMode ? "play on" : ""} onClick={() => useSequencerStore.getState().setLiveMode(!liveMode)}>Live</button>
            </div>
          ) : null}

          <div className="readout">{hoverText}</div>
          <div className="midi-in">MIDI in: <b>{lastMidi}</b></div>
        </div>

        <div className="ref">
          {advanced && (
          <div className="card">
            <h3>Device control — test</h3>
            {s.abletonConnected ? (
              <p className="note ok">Live ✓ — sliders/faders send /live/device/set/parameter/value</p>
            ) : (
              <p className="note warn">Live not connected — run osc-bridge (npm run bridge) &amp; the AbletonOSC control surface.</p>
            )}
            <label className="slider-row">
              <span className="lbl">Follow blue hand</span>
              <input
                type="checkbox"
                checked={s.followBlueHand}
                onChange={(e) => useSequencerStore.getState().setFollowBlueHand(e.target.checked)}
                style={{ justifySelf: "start" }}
              />
              <span className="val">
                {s.followBlueHand
                  ? `→ track ${s.blueTrack ?? s.targetTrack} · device ${s.blueDevice ?? 0}`
                  : `→ track ${s.targetTrack} · device 0`}
              </span>
            </label>
            <label className="slider-row">
              <span className="lbl">Fader range</span>
              <select
                value={s.faderRangeSetting}
                onChange={(e) => useSequencerStore.getState().setFaderRangeSetting(e.target.value as "auto" | "0to1" | "0to127")}
                style={{ justifySelf: "start" }}
              >
                <option value="0to1">0-1 (APC)</option>
                <option value="0to127">0-127</option>
                <option value="auto">auto</option>
              </select>
              <span className="val" />
            </label>
            <label className="slider-row">
              <span className="lbl">Device faders</span>
              <select
                value={s.faderSkipOnOff ? "p1" : "p0"}
                onChange={(e) => useSequencerStore.getState().setFaderSkipOnOff(e.target.value !== "p0")}
                style={{ justifySelf: "start" }}
              >
                <option value="p1">P1-P8 (skip on/off)</option>
                <option value="p0">P0-P7 (all macros)</option>
              </select>
              <span className="val" />
            </label>
            <div className="sliders">
              {deviceVals.map((v, i) => (
                <label key={i} className="slider-row">
                  <span className="lbl">{i === 8 ? "KIT" : `P${i + 1}`}</span>
                  <input
                    type="range"
                    min={0}
                    max={1000}
                    value={Math.round(v * 1000)}
                    onChange={(e) => {
                      const val = Number(e.target.value) / 1000;
                      setDeviceVals((prev) => prev.map((x, j) => (j === i ? val : x)));
                      if (i === 8) hub.setKitVolume(val);
                      else hub.setDeviceParam(i + 1, val);
                    }}
                  />
                  <span className="val">{Math.round(v * 127)}</span>
                </label>
              ))}
            </div>
            <div className="portbtns">
              <button onClick={() => hub.toggleDeviceOnOff()} title="Toggle the device on/off (param 0)">
                {s.deviceOn ? "Device ON" : "Device OFF"}
              </button>
              <button
                onClick={() => {
                  hub.resetFaderCalibration();
                  setLedReport("Fader scope reset — move a fader to re-read its range");
                }}
                title="Clear the fader range/diagnostic stats"
              >
                Reset scope
              </button>
            </div>
            <p className="note">Fader range 0-1 maps the APC's narrow throw to full range · master fader = kit volume · fader bursts are coalesced (one control per move).</p>
          </div>
          )}

          <div className="card">
            <h3>Drum control — bank {bank} (slots 1-8)</h3>
            {Array.from({ length: 8 }, (_, slot) => {
              const pad = bankSlotPad(bank, slot);
              const lvl = padLevel(drum, pad);
              const muted = padMuted(drum, pad);
              return (
                <label key={slot} className="drumrow">
                  <button
                    className={muted ? "mute on" : "mute"}
                    onClick={() => useSequencerStore.getState().togglePadMute(pad)}
                    title={`mute pad ${pad + 1}`}
                  >
                    M
                  </button>
                  <input
                    type="range"
                    min={0}
                    max={1000}
                    value={Math.round(lvl * 1000)}
                    onChange={(e) => useSequencerStore.getState().setPadLevel(pad, Number(e.target.value) / 1000)}
                  />
                  <span className="val">pad {pad + 1}</span>
                </label>
              );
            })}
            <p className="note">
              {liveMode
                ? "Live mode: track 1 = rec-arm the rack · track buttons 2-8 = mute."
                : "Track buttons 1-8 = mute · SHIFT + 1-4 = fader mode (Vol/Pan/Send/Device). Faders = per-drum level."}
            </p>
          </div>

          <div className="card">
            <h3>MIDI ports</h3>
            {midiWarning(midiStatus) ? (
              <div className="warn">{midiWarning(midiStatus)}</div>
            ) : (
              <div className="portrow">
                <label className="ctl">APC input
                  <select value={s.portPicks.input ?? ""} onChange={(e) => pickPort("input", e.target.value)}>
                    <option value="">Auto</option>
                    {(midiStatus?.inputs ?? []).map((p) => (
                      <option key={p.id} value={p.name}>{p.name}{p.hint ? `  (${p.hint})` : ""}</option>
                    ))}
                  </select>
                </label>
                <label className="ctl">APC LED out
                  <select value={s.portPicks.apcOut ?? ""} onChange={(e) => pickPort("apcOut", e.target.value)}>
                    <option value="">Auto</option>
                    {(midiStatus?.outputs ?? []).map((p) => (
                      <option key={p.id} value={p.name}>{p.name}{p.hint ? `  (${p.hint})` : ""}</option>
                    ))}
                  </select>
                </label>
                <label className="ctl">Rack out (IAC)
                  <select value={s.portPicks.rackOut ?? ""} onChange={(e) => pickPort("rackOut", e.target.value)}>
                    <option value="">Auto</option>
                    {(midiStatus?.outputs ?? []).map((p) => (
                      <option key={p.id} value={p.name}>{p.name}{p.hint ? `  (${p.hint})` : ""}</option>
                    ))}
                  </select>
                </label>
                <div className="portbtns">
                  <button onClick={() => hub.refreshMidiPorts().then(setMidiStatus)}>Refresh</button>
                  <button onClick={() => setLedReport(hub.testLeds())} title="Light all 64 pads red on LED channel 6 for half a second">Test LEDs</button>
                  <button onClick={() => setLedReport(hub.probeLeds())} title="Flash the bottom-left pad on channels 0,1,6,10,14 to find which one reaches the device">Probe ch</button>
                </div>
              </div>
            )}
            <p className="note">
              Active: input <b>{s.midiDevice ?? "—"}</b> · LED <b>{s.apcOut ?? "—"}</b> · rack <b>{s.rackPort ?? "—"}</b>
            </p>
            {ledReport ? (
              <p className={`note ${ledReport.startsWith("Sent") ? "ok" : "warn"}`}>{ledReport}</p>
            ) : null}
          </div>

          <div className="card">
            <h3>MIDI diagnostics</h3>
            <div className="portbtns">
              <button
                onClick={() => hub.midiPing()}
                title="Send note 99 on LED ch6 and see if the iConnect loops it back (ghost/loop detector)"
              >
                Ping APC (loop test)
              </button>
              <button onClick={() => useSequencerStore.getState().clearMidiLog()}>Clear monitor</button>
              <button
                onClick={() => hub.startFaderCalibration()}
                title="Sweep all faders full range for 4s to map their real min-max to full 0-1"
              >
                {s.faderCalibrating ? "Calibrating… sweep faders" : "Calibrate faders"}
              </button>
            </div>
            <p className="note">Input rate: <b>{s.midiInRate}/s</b> · {s.pingResult ?? "no ping yet"}</p>
            <label className="slider-row">
              <span className="lbl">Reverse faders</span>
              <input
                type="checkbox"
                checked={s.reverseFaders}
                onChange={(e) => useSequencerStore.getState().setReverseFaders(e.target.checked)}
                style={{ justifySelf: "start" }}
              />
              <span className="val">{s.reverseFaders ? "down = quieter" : "down = louder"}</span>
            </label>
            {s.faderCalib ? (
              <p className="note">
                Fader ranges (lo-hi): {s.faderCalib!.lo.slice(0, 8).map((lo, i) => `${lo}-${s.faderCalib!.hi[i]}`).join(" · ")}
              </p>
            ) : null}
          </div>

          <div className="card">
            <h3>MIDI monitor — what the app receives</h3>
            <div className="midi-monitor">
              {s.midiLog.length === 0 ? <span className="dim">(no MIDI received yet — move a pad or fader)</span> : null}
              {s.midiLog.map((line, i) => (
                <div key={i} className="mm-line">{line}</div>
              ))}
            </div>
            <p className="note">Every raw MIDI message + how it resolves. Move a fader slowly and read the [B0 ...] bytes — that shows the exact values the APC sends.</p>
          </div>

          <div className="card">
            <h3>Scene buttons — transport &amp; utility</h3>
            <div className="rows">
              {SCENE_ROLES.map((r) => (
                <div className="row" key={r.lbl}><span className="lbl">{r.lbl}</span><span className="midi">{r.midi}</span></div>
              ))}
            </div>
          </div>
          <div className="card">
            <h3>Track buttons — FX</h3>
            <div className="rows">
              {TRACK_ROLES.map((r, i) => (
                <div className="row" key={r.lbl}>
                  <span className="lbl">{r.lbl}</span>
                  <span className={s.trackFx[i] ? "midi on" : "midi"}>{s.trackFx[i] ? "ON" : r.midi}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="card">
            <h3>Faders — device control</h3>
            <div className="rows">
              {FADER_ROLES.map((r) => (
                <div className="row" key={r.lbl}><span className="lbl">{r.lbl}</span><span className="midi">{r.midi}</span></div>
              ))}
              <div className="row"><span className="lbl">MASTER · global FX</span><span className="midi">cc 56</span></div>
            </div>
            <p className="note">→ /live/device/set/parameter/value on track {s.targetTrack}, device 0. Set up in Live: MIDI out → IAC "Bus 1" into the Drum Rack track.</p>
          </div>
        </div>
      </div>

      <footer>
        drum pads (bottom-left 4×4) = rack notes 36–51 · top 4×8 = selected pad's 32 steps · SHIFT + step N = set length (1-based)
        <br />
        hardware note = row×8 + col (ch 0, LED ch 6) · pad-mode sysex F0 47 7F 4F 62 00 01 &lt;mode&gt; F7 · scene 112–119 · track 100–107 · faders CC 48–55 · master CC 56 · shift 122
      </footer>
    </div>
  );
}

function renderPad(
  ledByCell: Map<string, { color: number; channel?: number }>,
  row: number,
  col: number,
  drum: DrumRackPattern,
  selectedPad: number,
  fx: boolean[],
  flashNote: number | null,
  advanced: boolean,
  setHover: (h: { row: number; col: number } | null) => void,
) {
  const region = regionOf(row, col);
  const led = ledByCell.get(`${row},${col}`);
  let cls = colorClass(led?.color ?? 0, led?.channel);
  // Flash the drum pad that was just auditioned (green), overriding its idle color.
  if (region === "drum" && rackNoteAt(row, col) === flashNote) {
    cls = "flash";
  }
  const boundary = (col >= 4 ? " boundary-v" : "") + (row >= 4 ? " boundary-h" : "");
  let label = "";
  let title = "";
  if (region === "step") {
    label = String(stepNumber(row, col));
    title = `step ${stepNumber(row, col)} of pad ${selectedPad + 1} · len ${padLength(drum, selectedPad)}`;
  } else if (region === "drum") {
    const pad = drumPadAt(row, col);
    label = String(rackNoteAt(row, col));
    title = `drum pad → rack note ${rackNoteAt(row, col)} · ${padMuted(drum, pad) ? "MUTED · " : ""}tap = audition · SHIFT+tap = select`;
  } else {
    const slot = fxSlotAt(row, col);
    label = advanced ? fxModeLabel(slot) : String(slot + 1);
    title = advanced ? fxModeTitle(slot) : `FX slot ${slot + 1} · ${fx[slot] ? "ON" : "OFF"}`;
  }
  return (
    <button
      key={`p${row}-${col}`}
      className={`pad ${cls}${boundary}`}
      title={title}
      onClick={() => hub.pressGrid(row, col)}
      onMouseEnter={() => setHover({ row, col })}
      onMouseLeave={() => setHover(null)}
    >
      <span className="n">{label}</span>
    </button>
  );
}

function describeCell(
  row: number,
  col: number,
  drum: DrumRackPattern,
  selectedPad: number,
  fx: boolean[],
): string {
  const region = regionOf(row, col);
  const hw = row * 8 + col;
  if (region === "step") {
    const st = stepNumber(row, col);
    const hit = getHit(drum, selectedPad, st - 1);
    return `STEP GRID — pad ${selectedPad + 1}\n  step ${st} of ${padLength(drum, selectedPad)}${st - 1 >= padLength(drum, selectedPad) ? " (beyond length)" : ""}\n  → ${hit ? "HIT" : "empty"} · note ${hw}`;
  }
  if (region === "drum") {
    const pad = Math.floor((row - 4) * 4 + col);
    return `DRUM PADS — pad ${pad + 1} · rack note ${rackNoteAt(row, col)}\n  tap = audition · SHIFT+tap = select for editing · note ${hw}`;
  }
  const slot = fxSlotAt(row, col);
  if (slot === 0) return `MODE — Bank A (bottom two drum rows) · note ${hw}`;
  if (slot === 1) return `MODE — Bank B (top two drum rows) · note ${hw}`;
  if (slot === 2) return `MODE — Device (faders → macros P0-P7) · note ${hw}`;
  if (slot === 3) return `MODE — Live (taps play · track 1 = rec-arm) · note ${hw}`;
  return `FX PADS — slot ${slot + 1} · ${fx[slot] ? "ON" : "OFF"} · note ${hw}`;
}

/** Labels for the FX mode-row cells (Bank A/B, Device, Live). */
function fxModeLabel(slot: number): string {
  return slot < 4 ? ["A", "B", "DEV", "LIVE"][slot] : String(slot + 1);
}

function fxModeTitle(slot: number): string {
  switch (slot) {
    case 0:
      return "MODE — select Bank A";
    case 1:
      return "MODE — select Bank B";
    case 2:
      return "MODE — Device (faders → macros P0-P7)";
    case 3:
      return "MODE — Live (taps play · track 1 = rec-arm)";
    default:
      return `FX slot ${slot + 1} · toggle`;
  }
}

function abletonClass(connected: boolean): string {
  return connected ? "chip play" : "chip";
}

/** Explain why the MIDI picker is empty, so the user knows exactly what to fix. */
function midiWarning(m: MidiStatus | null): string | null {
  if (!m) return "Checking MIDI…";
  if (!m.supported) {
    return "⚠️ Web MIDI isn't available in this browser — open the app in Chrome or Edge (the built-in preview can't see MIDI devices).";
  }
  if (m.permission === "denied") {
    return "⚠️ MIDI access was denied — click the lock icon in the address bar → Site settings → allow MIDI, then Refresh.";
  }
  if (m.inputs.length === 0 && m.outputs.length === 0) {
    return "⚠️ No MIDI devices found — is the APC plugged into this computer? (If it's behind an iConnect interface, its port shows under the iConnect name.)";
  }
  return null;
}
