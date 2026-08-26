import { useEffect, useState } from "react";
import * as hub from "./lib/hub";
import { BANK_FADER_LABELS, BANK_TRIGGER_LABEL, describeBankParams } from "./lib/clipEdit";
import type { LearnTarget } from "./lib/learn";
import { learnTargetLabel } from "./lib/learn";
import { getMidiStatus, type MidiPortInfo } from "./lib/midi";
import { getOsc, type OscState } from "./lib/osc";
import { GLOBAL_ACTIONS, useMk1Store } from "./lib/store";
import { TEMPLATE_TRACK_NAMES } from "./lib/trackSync";

function PortPicker({
  label,
  ports,
  value,
  activeName,
  onChange,
}: {
  label: string;
  ports: MidiPortInfo[];
  value: string | undefined;
  activeName: string | null;
  onChange: (value: string | undefined) => void;
}) {
  return (
    <label className="port-picker">
      <span>{label}</span>
      <select
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value === "" ? undefined : e.target.value)}
      >
        <option value="">(auto)</option>
        {ports.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name} {p.hint ? `[${p.hint}]` : ""}
          </option>
        ))}
      </select>
      <span className="port-status">{activeName ?? "— not connected —"}</span>
    </label>
  );
}

export default function App() {
  const state = useMk1Store();
  const [inputs, setInputs] = useState<MidiPortInfo[]>([]);
  const [outputs, setOutputs] = useState<MidiPortInfo[]>([]);
  const [midiSupported, setMidiSupported] = useState(true);
  const [midiPermission, setMidiPermission] = useState<"granted" | "denied" | "unknown">("unknown");
  const [midiError, setMidiError] = useState<string | undefined>(undefined);
  const [osc, setOsc] = useState<OscState>({ connected: false });

  useEffect(() => {
    hub.start();
    getMidiStatus().then((status) => {
      setMidiSupported(status.supported);
      setMidiPermission(status.permission);
      setMidiError(status.error);
      setInputs(status.inputs);
      setOutputs(status.outputs);
    });
    const unsubscribe = getOsc().onChange(setOsc);
    return () => {
      hub.stop();
      unsubscribe();
    };
  }, []);

  const setPick = (kind: "input" | "apcOut", value: string | undefined) => {
    state.setPortPick(kind, value);
    hub.applyPortPicks();
  };

  const faderLabels = BANK_FADER_LABELS[state.activeBank];
  const triggerLabel = BANK_TRIGGER_LABEL[state.activeBank];
  const faderValuesLive = describeBankParams(state.activeBank, state.faderValues);

  return (
    <div className="app">
      <h1>APC mini mk1 — Clip Editor</h1>
      <p className="subtitle">
        Reads the mk1 over Web MIDI and edits the currently-selected clip in Live directly through
        AbletonOSC — no MIDI mapping step. Faders set a bank's transform parameters; scene buttons
        and grid pads apply it to whatever clip is selected in Live.
      </p>

      <section className="card">
        <h2>
          OSC Bridge{" "}
          <span className="shift-indicator" data-active={osc.connected}>
            {osc.connected ? "connected" : "disconnected"}
          </span>
        </h2>
        <p className="subtitle">
          Requires <code>packages/osc-bridge</code>'s relay running (defaults to{" "}
          <code>ws://127.0.0.1:8081</code>) and AbletonOSC active as a Control Surface in Live.
        </p>
      </section>

      {!midiSupported && (
        <p className="warning">
          Web MIDI isn't available in this browser — use Chrome. The on-screen controls below
          still work without hardware.
        </p>
      )}
      {midiSupported && midiPermission === "denied" && (
        <p className="warning">
          MIDI access was denied{midiError ? `: ${midiError}` : ""}. Check Chrome's site
          permissions (chrome://settings/content/midiDevices) for this page and reload.
        </p>
      )}
      {midiSupported && midiPermission === "granted" && inputs.length === 0 && outputs.length === 0 && (
        <p className="warning">
          MIDI access is granted, but the browser sees zero input/output ports at all — this is
          an OS/driver-level visibility issue, not something this app controls.
        </p>
      )}

      <section className="card">
        <h2>MIDI Ports</h2>
        <PortPicker
          label="mk1 input"
          ports={inputs}
          value={state.portPicks.input}
          activeName={state.ports.input?.name ?? null}
          onChange={(v) => setPick("input", v)}
        />
        <PortPicker
          label="mk1 LED output"
          ports={outputs}
          value={state.portPicks.apcOut}
          activeName={state.ports.apcOut?.name ?? null}
          onChange={(v) => setPick("apcOut", v)}
        />
      </section>

      <section className="card">
        <h2>
          Track Select (scene buttons){" "}
          <span className="shift-indicator" data-active={state.shiftHeld}>
            SHIFT {state.shiftHeld ? "held" : ""}
          </span>
        </h2>
        <p className="subtitle">
          Lives on the scene buttons — the physical vertical column on the mk1 — to match
          Arrangement View's own vertical track layout. Unshifted: selects a track and syncs
          Live's screen to show it (playhead too, if that track has a clip there — only visibly
          scrolls if Live's "Follow" is on). Shifted: transport/navigation instead.
        </p>
        <div className="scene-row">
          {Array.from({ length: 8 }, (_, i) => {
            const globalAction = GLOBAL_ACTIONS[i];
            return (
              <button
                key={i}
                className="scene-button"
                data-active={!state.shiftHeld && i === state.activeTrack}
                onMouseDown={() => state.pressSceneButton(i, true)}
                onMouseUp={() => state.pressSceneButton(i, false)}
                onMouseLeave={() => state.pressSceneButton(i, false)}
              >
                <div className="scene-note">S{i + 1}</div>
                <div className="scene-label">
                  {state.shiftHeld ? (globalAction?.label ?? "") : TEMPLATE_TRACK_NAMES[i]}
                </div>
              </button>
            );
          })}
        </div>
        <label className="shift-toggle">
          <input
            type="checkbox"
            checked={state.shiftHeld}
            onChange={(e) => state.setShiftHeld(e.target.checked)}
          />
          Hold Shift (on-screen)
        </label>
      </section>

      <section className="card">
        <h2>Track Buttons — reserved</h2>
        <p className="subtitle">
          Freed up now that track selection lives on the scene buttons instead. Recognized but
          does nothing yet — pending a fresh design pass.
        </p>
        <div className="bank-row">
          {Array.from({ length: 8 }, (_, i) => (
            <button
              key={i}
              className="bank-button"
              onClick={() => state.pressTrackButton(i, true)}
            >
              T{i + 1}
            </button>
          ))}
        </div>
      </section>

      <section className="card">
        <h2>Faders / Fader Banks (vestigial — pending Macro-dispatch rework)</h2>
        <p className="subtitle">
          Still reflects the earlier transform-bank design (Pitch/Time/Transform/Generate), not
          yet reworked to control the active track's Macro Rack.
        </p>
        <div className="fader-row">
          {state.faderValues.map((value, i) => (
            <div className="fader" key={i}>
              <input
                type="range"
                className="fader-slider"
                min={0}
                max={127}
                value={value}
                onChange={(e) => state.pressFader(i, Number(e.target.value))}
              />
              <div className="fader-label">
                F{i + 1}
                <br />
                {faderLabels[i] || "(unused)"}
                {faderLabels[i] && faderValuesLive[i] && (
                  <>
                    <br />
                    <strong>{faderValuesLive[i]}</strong>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="card">
        <h2>Grid (any pad triggers the active bank, same as a scene button)</h2>
        <div className="grid-pads">
          {Array.from({ length: 64 }, (_, i) => (
            <button
              key={i}
              className="grid-pad"
              title={triggerLabel}
              onMouseDown={() => state.pressGridPad(i, true)}
              onMouseUp={() => state.pressGridPad(i, false)}
              onMouseLeave={() => state.pressGridPad(i, false)}
            >
              {i + 1}
            </button>
          ))}
        </div>
      </section>

      <LearnPanel />

      <section className="card">
        <h2>Log</h2>
        <div className="log">
          {state.log.length === 0 && <div className="log-empty">No events yet.</div>}
          {state.log
            .slice()
            .reverse()
            .map((line) => (
              <div key={line.id} className="log-line">
                {line.text}
              </div>
            ))}
        </div>
      </section>
    </div>
  );
}

function LearnPanel() {
  const state = useMk1Store();

  const targets: LearnTarget[] = [
    { kind: "shift" },
    ...Array.from({ length: 8 }, (_, i): LearnTarget => ({ kind: "fader", index: i })),
    ...Array.from({ length: 5 }, (_, i): LearnTarget => ({ kind: "trackButton", index: i })),
    ...Array.from({ length: 8 }, (_, i): LearnTarget => ({ kind: "sceneButton", index: i })),
  ];

  const isSameTarget = (a: LearnTarget, b: LearnTarget) =>
    a.kind === b.kind && (!("index" in a) || a.index === (b as { index?: number }).index);

  return (
    <section className="card">
      <h2>Learn Mode (optional)</h2>
      <p className="subtitle">
        The default note/CC numbers are sourced from Ableton's own shipped mk1 remote script, so
        this shouldn't be needed. Use it only if a specific control doesn't respond.
      </p>
      {state.learnTarget && (
        <p className="learn-active">
          Listening for <strong>{learnTargetLabel(state.learnTarget)}</strong> — move/press it on
          the hardware now. <button onClick={() => state.cancelLearn()}>Cancel</button>
        </p>
      )}
      <div className="learn-grid">
        {targets.map((target, i) => (
          <button
            key={i}
            className="learn-button"
            data-active={state.learnTarget ? isSameTarget(state.learnTarget, target) : false}
            onClick={() => state.startLearn(target)}
          >
            {learnTargetLabel(target)}
          </button>
        ))}
      </div>
      <button className="reset-button" onClick={() => state.resetOverrides()}>
        Reset all learned overrides
      </button>
    </section>
  );
}
