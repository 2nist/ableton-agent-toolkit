import { DrumRack, MidiTrack, RackDevice, Simpler, type ApiVersion, type Device, type Song } from "@ableton-extensions/sdk";

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
 *
 * Shared between `trackdraft-bridge` (blueprint-driven "Generate Drum
 * Clips") and `drum-studio` (interactive pattern/outline picker) — both
 * need to write notes that land on a specific kit's actual pads, not an
 * assumed GM layout, and this logic is Extensions-SDK-coupled (imports
 * `DrumRack`/`MidiTrack`/`Simpler` directly), so it lives in its own small
 * package rather than in `@drum/library` (which stays SDK-free and
 * DAW-agnostic) or duplicated per extension.
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

/**
 * Look for a Drum Rack on the given track first; if it has none, fall back
 * to a track literally named "kit" (case-insensitive) anywhere in the song.
 *
 * Matthew's project template fixes the Drum Rack on a track named `kit`
 * (first in the track order). A caller invoked from elsewhere — the
 * `chord` track, or a Session slot — would otherwise find nothing and fall
 * all the way back to the `ASSUMED` table. This fallback is the template
 * convention, not a hard requirement: a project with its own DrumRack on
 * the targeted track always wins, since that's the more specific answer.
 */
export function findDrumRackWithKitFallback(
  track: MidiTrack<ApiVersion>,
  song: Song<ApiVersion>,
): DrumRack<ApiVersion> | null {
  const direct = findDrumRack(track);
  if (direct) return direct;
  const kitTrack = song.tracks.find(
    (t): t is MidiTrack<ApiVersion> => t instanceof MidiTrack && /^kit$/i.test(t.name),
  );
  return kitTrack ? findDrumRack(kitTrack) : null;
}

/** Roles this fold-down currently recognizes — matches the keys of `ASSUMED` below. */
export type LogicalDrumRole =
  | "kick"
  | "rim"
  | "snare"
  | "clap"
  | "closed hat"
  | "mid tom"
  | "open hat"
  | "hi tom"
  | "crash"
  | "ride";

/**
 * Role → actual receiving note on a real, probed rack — the inverse of
 * `ASSUMED`, restricted to roles this rack demonstrably has a pad for at
 * the expected note.
 *
 * IMPORTANT, non-obvious limitation: because a pad's role is derived FROM
 * its receiving note via `ASSUMED` (the only signal available without
 * guessing from a sample name), `mapping[role]` can only ever equal the
 * same note `ASSUMED` already assigns that role — there is no way for this
 * function to discover that, say, a kit's "kick" sound has been placed on
 * note 40 instead of 36, because nothing here identifies a pad as "the
 * kick" other than it already sitting at 36. Concretely: for any report,
 * `remapPitch(pitch, resolvePadMapping(report))` is mathematically
 * equivalent to `pitch` — every note that resolves a mapping entry at all
 * resolves to itself. This is confirmed both by proof (see above) and by
 * `drum-studio`'s own extension tests, where the "remap" case and the
 * "no rack found" case produce identical output.
 *
 * What this *does* legitimately do: confirm whether a rack has a pad at
 * each expected note at all (useful to know a sparse/partial kit exists,
 * even though — see `remapPitch` — it changes no note values today) and
 * provide the plumbing (`findDrumRack`/`probeDrumRack`/`resolvePadMapping`/
 * `remapPitch`, already wired end-to-end into both `trackdraft-bridge` and
 * `drum-studio`) that a real fix could slot into. A real fix needs an
 * independent way to identify a pad's role that doesn't start from the
 * note it already occupies — most plausibly, matching each pad's
 * `PadReport.samplePath` against role-indicative filename keywords — which
 * is new work, not implemented here, and deliberately not guessed at:
 * this file's whole design principle is reporting what a rack says about
 * itself rather than reasoning about what it "should" be, and a fuzzy
 * filename match would cross that line.
 */
export function resolvePadMapping(report: RackReport): Partial<Record<LogicalDrumRole, number>> {
  const mapping: Partial<Record<LogicalDrumRole, number>> = {};
  for (const pad of report.pads) {
    const role = ASSUMED[pad.receivingNote] as LogicalDrumRole | undefined;
    if (role) mapping[role] = pad.receivingNote;
  }
  return mapping;
}

/**
 * Remap a generated note's pitch through a resolved pad mapping. See
 * `resolvePadMapping`'s docstring for an important caveat: for any mapping
 * that function can actually produce, this is currently a no-op — it
 * returns `pitch` unchanged in every case. Kept as the intended call site
 * for when `resolvePadMapping` gains real role-classification power, so
 * callers (`trackdraft-bridge`, `drum-studio`) don't need to change again.
 */
export function remapPitch(pitch: number, mapping: Partial<Record<LogicalDrumRole, number>>): number {
  const role = ASSUMED[pitch] as LogicalDrumRole | undefined;
  if (!role) return pitch;
  return mapping[role] ?? pitch;
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
      // The SDK's native layer can surface this as BigInt even though it's
      // typed `number` (same story as `Song.rootNote` elsewhere in this
      // codebase) — never observed until pad mapping started going through
      // real DrumChain objects instead of plain test fixtures, but worth
      // guarding unconditionally since a BigInt receivingNote would silently
      // poison every downstream `===`/object-key comparison.
      receivingNote: Number(chain.receivingNote),
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
 * built dialog string in a consuming extension can share the one
 * implementation.
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
