import { DrumRack, RackDevice, Simpler, type ApiVersion, type Device, type MidiTrack } from "@ableton-extensions/sdk";

/**
 * Read a Drum Rack's actual pad layout and velocity configuration.
 *
 * Everything downstream of this depends on assumptions we can't verify from
 * documentation: which MIDI note a kit's kick actually sits on, and whether
 * a note's velocity survives into audible dynamics. Both have already caused
 * silent, audible errors once — the pedal hi-hat (14.6% of all hits in the
 * corpus) lands on a low tom in both 808 and 909 Core Kits, and a groove
 * whose dynamics get flattened still plays, it just stops sounding human.
 *
 * So rather than reason about Ableton's behaviour, this reports what a real
 * loaded rack says about itself.
 */

export interface PadParameter {
  name: string;
  value: number;
  min: number;
  max: number;
  defaultValue: number;
}

export interface PadReport {
  /** MIDI note that triggers this pad. */
  receivingNote: number;
  /** Devices in the pad's chain, named as Live names them. */
  devices: string[];
  /** Sample loaded in the pad's Simpler, if it has one. */
  samplePath: string | null;
  /**
   * Parameters whose names mention velocity. Enumerated rather than looked
   * up by name: the SDK exposes no velocity API, and Simpler's parameter
   * naming isn't documented anywhere we can rely on, so the only honest way
   * to find them is to read every parameter and filter.
   */
  velocityParameters: PadParameter[];
  /** Every parameter, for the pads where the velocity ones aren't obvious. */
  allParameters: PadParameter[];
}

export interface RackReport {
  trackName: string;
  deviceName: string;
  pads: PadReport[];
}

function isVelocityRelated(name: string): boolean {
  return /vel/i.test(name);
}

async function readParameters(device: Device<ApiVersion>): Promise<PadParameter[]> {
  const parameters: PadParameter[] = [];
  for (const parameter of device.parameters) {
    // Values are read one at a time rather than in parallel: a rack can hold
    // 128 pads with dozens of parameters each, and flooding the host with
    // concurrent reads is a good way to take the extension process down.
    const value = await parameter.getValue();
    parameters.push({
      name: parameter.name,
      value,
      min: parameter.min,
      max: parameter.max,
      defaultValue: parameter.defaultValue,
    });
  }
  return parameters;
}

/**
 * Find the first Drum Rack anywhere in a track's device chain, including
 * inside other racks.
 *
 * A Drum Rack wrapped in an outer Instrument Rack — for a shared macro, a
 * send chain, whatever — is a completely ordinary setup, and only checking
 * `track.devices` misses it: that list contains the outer rack, not what's
 * inside it. Recursing through every `RackDevice`'s chains is what makes
 * this actually find a rack that isn't sitting bare on the track.
 */
export function findDrumRack(track: MidiTrack<ApiVersion>): DrumRack<ApiVersion> | null {
  return searchDevices(track.devices);
}

function searchDevices(devices: Device<ApiVersion>[]): DrumRack<ApiVersion> | null {
  for (const device of devices) {
    if (device instanceof DrumRack) return device;
    if (device instanceof RackDevice) {
      for (const chain of device.chains) {
        const found = searchDevices(chain.devices);
        if (found) return found;
      }
    }
  }
  return null;
}

export async function probeDrumRack(
  track: MidiTrack<ApiVersion>,
  rack: DrumRack<ApiVersion>,
): Promise<RackReport> {
  const pads: PadReport[] = [];

  for (const chain of rack.chains) {
    const devices = chain.devices;
    let samplePath: string | null = null;
    const allParameters: PadParameter[] = [];

    for (const device of devices) {
      if (device instanceof Simpler) {
        samplePath = device.sample?.filePath ?? null;
      }
      allParameters.push(...(await readParameters(device)));
    }

    pads.push({
      receivingNote: chain.receivingNote,
      devices: devices.map((device) => device.name),
      samplePath,
      velocityParameters: allParameters.filter((parameter) => isVelocityRelated(parameter.name)),
      allParameters,
    });
  }

  pads.sort((a, b) => a.receivingNote - b.receivingNote);
  return { trackName: track.name, deviceName: rack.name, pads };
}

/** Note names as Live displays them — C1 is MIDI 36, matching a rack's bottom-left pad. */
export function noteName(midi: number): string {
  const names = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  return `${names[midi % 12]}${Math.floor(midi / 12) - 2}`;
}

/**
 * What our fold-down currently assumes each note is. Rendered alongside what
 * the rack actually reports, so a mismatch is visible rather than inferred.
 */
const ASSUMED: Record<number, string> = {
  36: "kick",
  37: "rim",
  38: "snare",
  39: "clap",
  42: "closed hat",
  45: "mid tom",
  46: "open hat",
  47: "hi tom",
  49: "crash",
  51: "ride",
};

export function buildProbeHtml(report: RackReport): string {
  const rows = report.pads
    .map((pad) => {
      const sample = pad.samplePath ? pad.samplePath.split("/").pop() : "—";
      const assumed = ASSUMED[pad.receivingNote] ?? "";
      const velocity =
        pad.velocityParameters.length > 0
          ? pad.velocityParameters
              .map((p) => `${escapeHtml(p.name)} <b>${p.value.toFixed(3)}</b>`)
              .join("<br>")
          : `<span class="muted">none of ${pad.allParameters.length} params</span>`;
      return `<tr>
        <td class="n">${pad.receivingNote}<span class="muted"> ${noteName(pad.receivingNote)}</span></td>
        <td>${escapeHtml(pad.devices.join(" › ") || "—")}</td>
        <td>${escapeHtml(sample ?? "—")}</td>
        <td class="assumed">${escapeHtml(assumed)}</td>
        <td class="vel">${velocity}</td>
      </tr>`;
    })
    .join("");

  return `<!doctype html><meta charset="utf-8">
<style>
  body { font: 12px -apple-system, system-ui, sans-serif; margin: 0; padding: 16px;
         background: #1a1a1a; color: #ddd; }
  h1 { font-size: 14px; margin: 0 0 2px; }
  .sub { color: #888; margin-bottom: 14px; }
  table { border-collapse: collapse; width: 100%; }
  th, td { text-align: left; padding: 5px 8px; border-bottom: 1px solid #2e2e2e;
           vertical-align: top; }
  th { color: #999; font-weight: 600; position: sticky; top: 0; background: #1a1a1a; }
  .n { font-variant-numeric: tabular-nums; white-space: nowrap; }
  .muted { color: #666; }
  .assumed { color: #7ec699; }
  .vel { font-family: ui-monospace, Menlo, monospace; font-size: 11px; }
  b { color: #ffcc66; }
  #closeBtn { margin-top: 14px; background: transparent; color: #999; border: 1px solid #444;
              border-radius: 4px; padding: 5px 12px; cursor: pointer; font: inherit; }
</style>
<h1>${escapeHtml(report.deviceName)} — ${report.pads.length} pads</h1>
<div class="sub">track: ${escapeHtml(report.trackName)}</div>
<table>
  <tr><th>note</th><th>devices</th><th>sample</th><th>we assume</th><th>velocity params</th></tr>
  ${rows}
</table>
<button id="closeBtn">Close</button>
<script>${CLOSE_SCRIPT}</script>`;
}

/**
 * The SDK closes a modal only when the page sends a specific
 * `close_and_send` message through its host bridge — there is no default
 * window chrome for this. Every dialog this extension shows needs it, or
 * the only way out is force-quitting the window. Exported so every hand-
 * built dialog string in this extension can share the one implementation.
 */
export const CLOSE_SCRIPT = `
function sendClose() {
  var message = { method: "close_and_send", params: [""] };
  if (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.live) {
    window.webkit.messageHandlers.live.postMessage(message);
  } else if (window.chrome && window.chrome.webview) {
    window.chrome.webview.postMessage(message);
  }
}
var btn = document.getElementById("closeBtn");
if (btn) btn.addEventListener("click", sendClose);
`;

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
