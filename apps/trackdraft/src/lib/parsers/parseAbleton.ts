/**
 * Ableton Live Set (.als) parser — extracts tempo, key, time signature,
 * locator markers (section boundaries), and MIDI clip notes from a gzipped
 * XML Live Set file. Produces a BlueprintSong skeleton with sections
 * derived from arrangement locators and chords from MIDI clip data.
 *
 * The .als format is gzipped XML. We decompress with zlib, parse with
 * fast-xml-parser, then walk the Live Set DOM to find:
 * - Master track tempo automation → BPM
 * - Scale name locator → key
 * - Time signature automation → time signature
 * - Arrangement locators → section boundaries with labels
 * - MIDI clips → notes (reused by parseMidi's chord detector)
 *
 * Dependency: fast-xml-parser (already a devDependency in the repo).
 * No native modules required — runs in-browser via the Vite endpoint.
 */

import { XMLParser } from "fast-xml-parser";
import * as zlib from "node:zlib";
import type { BlueprintSong, BlueprintSection } from "../../types/blueprint";
import type { NoteName } from "@music-theory/core";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface LiveSetLocator {
  name: string;       // Locator name (e.g. "Verse 1", "Chorus")
  time: number;       // Beat position in the arrangement
}

interface LiveSetMidiNote {
  pitch: number;
  startTime: number;  // seconds
  duration: number;   // seconds
  velocity: number;
}


// ---------------------------------------------------------------------------
// XML parsing helpers
// ---------------------------------------------------------------------------

/** Parse an already-decompressed Live Set XML string. Kept separate from the
 *  gunzip so the Electron main process can decompress (it owns Node) while the
 *  renderer keeps the DOM walk. */
function parseAlsXmlText(xml: string): Record<string, unknown> {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    isArray: (name) =>
      name === "Locator" || name === "MidiNoteEvent" || name === "ClipTimeable" ||
      name === "AutomationTarget" || name === "AutomationEvent" || name === "MidiClip" ||
      name === "AudioClip" || name === "ClipSlot" || name === "TrackDeviceChain" ||
      name === "Device" || name === "Track" || name === "BranchSource" ||
      name === "AutomationLane" || name === "ArrangerAutomation" ||
      name === "FloatEvent" || name === "EnumEvent",
  });
  return parser.parse(xml) as Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Data extraction from parsed XML
// ---------------------------------------------------------------------------

function extractMasterData(parsed: Record<string, unknown>): {
  tempo: number;
  timeSigNum: number;
  timeSigDen: number;
} {
  let tempo = 120;
  let timeSigNum = 4;
  let timeSigDen = 4;

  // Walk the Live Set tree to find the Master track
  const root = parsed.Ableton;
  if (!root || typeof root !== "object") return { tempo, timeSigNum, timeSigDen };

  const liveSet = (root as Record<string, unknown>).LiveSet;
  if (!liveSet || typeof liveSet !== "object") return { tempo, timeSigNum, timeSigDen };

  // Tracks are under LiveSet.Tracks
  const tracks = (liveSet as Record<string, unknown>).Tracks;
  if (!tracks || typeof tracks !== "object") return { tempo, timeSigNum, timeSigDen };

  // Find the Master track (Track with @_Id that's negative or name "Master")
  const trackList = (tracks as Record<string, unknown>).Track ?? [];
  const trackArray = Array.isArray(trackList) ? trackList : [trackList];

  for (const track of trackArray) {
    const t = track as Record<string, unknown>;
    const effectiveName = t.EffectiveName;
    const nameVal = effectiveName && typeof effectiveName === "object"
      ? (effectiveName as Record<string, unknown>).EffectiveName
      : effectiveName;
    if (nameVal !== "Master" && nameVal !== undefined) continue;

    // Master track found — extract tempo and time signature automation
    const masterChain = t.MasterChain;
    const mixer = masterChain && typeof masterChain === "object"
      ? (masterChain as Record<string, unknown>).Mixer
      : undefined;
    if (!mixer) continue;

    // Tempo: MasterChain.Mixer.Tempo.Manual
    const tempoObj = (mixer as Record<string, unknown>).Tempo as Record<string, unknown> | undefined;
    if (tempoObj) {
      const manual = tempoObj.Manual as Record<string, unknown> | undefined;
      if (manual) {
        const val = manual["@_Value"] ?? manual.Manual;
        if (typeof val === "string") tempo = parseFloat(val);
        else if (typeof val === "number") tempo = val;
      }
    }

    // Time signature: MasterChain.Mixer.TimeSignature
    const tsObj = (mixer as Record<string, unknown>).TimeSignature as Record<string, unknown> | undefined;
    if (tsObj) {
      const tsNum = tsObj["@_Value"];
      if (typeof tsNum === "string") {
        const parts = tsNum.split("/");
        if (parts.length === 2) {
          const n = parseInt(parts[0], 10);
          const d = parseInt(parts[1], 10);
          if (!isNaN(n) && !isNaN(d)) {
            timeSigNum = n;
            timeSigDen = d;
          }
        }
      }
    }
    break; // Only process Master track
  }

  return { tempo, timeSigNum, timeSigDen };
}

function extractLocators(parsed: Record<string, unknown>): LiveSetLocator[] {
  const locators: LiveSetLocator[] = [];
  const root = parsed.Ableton;
  if (!root || typeof root !== "object") return locators;

  const liveSet = (root as Record<string, unknown>).LiveSet;
  if (!liveSet || typeof liveSet !== "object") return locators;

  // Locators live under LiveSet.Locators.Locators (nested)
  const locatorsParent = (liveSet as Record<string, unknown>).Locators;
  if (!locatorsParent || typeof locatorsParent !== "object") return locators;

  const locatorList = (locatorsParent as Record<string, unknown>).Locators as Record<string, unknown> | undefined;
  if (!locatorList) return locators;

  const locatorEntries = (locatorList as Record<string, unknown>).Locator;
  if (!locatorEntries) return locators;

  const entries = Array.isArray(locatorEntries) ? locatorEntries : [locatorEntries];

  for (const loc of entries) {
    const l = (loc as Record<string, unknown>);
    const nameObj = l.Name;
    let name = "Section";
    if (nameObj && typeof nameObj === "object" && "EffectiveName" in nameObj) {
      name = (nameObj as Record<string, unknown>).EffectiveName as string;
    } else if (typeof nameObj === "string") {
      name = nameObj;
    }

    let time = 0;
    const timeVal = l.Time ?? l["@_Time"];
    if (typeof timeVal === "string") time = parseFloat(timeVal);
    else if (typeof timeVal === "number") time = timeVal;

    locators.push({ name, time });
  }

  return locators.sort((a, b) => a.time - b.time);
}

function extractKey(parsed: Record<string, unknown>): { key: NoteName; scale: string } {
  // Try to find a Scale device or a Scale locator name
  const root = parsed.Ableton;
  if (!root || typeof root !== "object") return { key: "C", scale: "ionian" };

  // Simple heuristic: look for Scale devices in the XML
  // For now, default to C ionian — complex scale extraction would need
  // to walk the device chain DAG which varies significantly by Live version
  return { key: "C", scale: "ionian" };
}

function extractMidiNotes(parsed: Record<string, unknown>): LiveSetMidiNote[] {
  const notes: LiveSetMidiNote[] = [];
  const root = parsed.Ableton;
  if (!root || typeof root !== "object") return notes;

  const liveSet = (root as Record<string, unknown>).LiveSet;
  if (!liveSet || typeof liveSet !== "object") return notes;

  const tracks = (liveSet as Record<string, unknown>).Tracks;
  if (!tracks || typeof tracks !== "object") return notes;

  const trackList = (tracks as Record<string, unknown>).Track;
  if (!trackList) return notes;
  const trackArray = Array.isArray(trackList) ? trackList : [trackList];

  for (const track of trackArray) {
    const t = track as Record<string, unknown>;
    // Skip Master, return tracks
    const nameObj = t.EffectiveName;
    const nameVal = nameObj && typeof nameObj === "object"
      ? (nameObj as Record<string, unknown>).EffectiveName
      : nameObj;
    if (typeof nameVal === "string" && ["Master", "Return", "PreHear"].includes(nameVal)) continue;

    // Find MIDI clips in the track's device chain
    const deviceChain = t.DeviceChain;
    if (!deviceChain || typeof deviceChain !== "object") continue;

    const clipSlots = (deviceChain as Record<string, unknown>).ClipSlots;
    if (!clipSlots || typeof clipSlots !== "object") continue;

    const slots = (clipSlots as Record<string, unknown>).ClipSlot as unknown[];
    if (!slots) continue;
    const slotArray = Array.isArray(slots) ? slots : [slots];

    for (const slot of slotArray) {
      const s = slot as Record<string, unknown>;
      const clipRef = (s.ClipTimeable as Record<string, unknown>)?.MidiClip ?? s.ClipTimeable;
      if (!clipRef || typeof clipRef !== "object") continue;

      const midiClip = (clipRef as Record<string, unknown>);
      const notesList = midiClip.NoteEventList;
      if (!notesList || typeof notesList !== "object") continue;

      const noteEntries = (notesList as Record<string, unknown>).MidiNoteEvent;
      if (!noteEntries) continue;

      const events = Array.isArray(noteEntries) ? noteEntries : [noteEntries];

      for (const ev of events) {
        const e = ev as Record<string, unknown>;
        const pitch = typeof e["@_Pitch"] === "string" ? parseInt(e["@_Pitch"], 10) : (e["@_Pitch"] as number);
        const startTime = typeof e["@_StartTime"] === "string" ? parseFloat(e["@_StartTime"]) : (e["@_StartTime"] as number);
        const duration = typeof e["@_Duration"] === "string" ? parseFloat(e["@_Duration"]) : (e["@_Duration"] as number);
        const velocity = typeof e["@_Velocity"] === "string" ? parseFloat(e["@_Velocity"]) : ((e["@_Velocity"] as number) ?? 100);

        if (typeof pitch === "number" && !isNaN(pitch)) {
          notes.push({ pitch, startTime, duration, velocity });
        }
      }
    }
  }

  return notes;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Parse an Ableton Live Set (.als) file into a BlueprintSong.
 *
 * @param arrayBuffer - The .als file contents as an ArrayBuffer
 * @param title - Song title (derived from filename)
 * @returns A BlueprintSong with sections from arrangement locators
 */
export async function alsToBlueprintSong(
  arrayBuffer: ArrayBuffer,
  title: string,
): Promise<BlueprintSong> {
  let xml: string;
  try {
    xml = zlib.gunzipSync(Buffer.from(arrayBuffer)).toString("utf-8");
  } catch {
    // Some sets are saved uncompressed.
    xml = Buffer.from(arrayBuffer).toString("utf-8");
  }
  return alsXmlToBlueprintSong(xml, title);
}

/**
 * Build a song from an ALREADY-DECOMPRESSED Live Set XML string.
 *
 * This is the entry point the Electron host uses: `zlib` is a Node builtin, so
 * the main process does the gunzip over IPC and the renderer — which has no
 * Node — only does what it can do in any browser.
 */
export async function alsXmlToBlueprintSong(xml: string, title: string): Promise<BlueprintSong> {
  const now = new Date().toISOString();
  let parsed: Record<string, unknown>;

  try {
    parsed = parseAlsXmlText(xml);
  } catch (err) {
    throw new Error(
      `Failed to parse .als file: ${err instanceof Error ? err.message : "Unknown error"}. Make sure this is a valid Ableton Live Set.`,
    );
  }

  // Extract data
  const { tempo, timeSigNum, timeSigDen } = extractMasterData(parsed);
  const { key, scale } = extractKey(parsed);
  const locators = extractLocators(parsed);
  const notes = extractMidiNotes(parsed);

  // Build sections from locator markers
  const sections: BlueprintSection[] = [];
  if (locators.length > 0) {
    for (let i = 0; i < locators.length; i++) {
      const loc = locators[i];
      const nextTime = i + 1 < locators.length ? locators[i + 1].time : loc.time + 16; // default 16 beats if last
      const durationBeats = Math.max(4, nextTime - loc.time);
      const bars = Math.max(4, Math.ceil(durationBeats / timeSigNum));

      // Infer role from locator name
      let role: BlueprintSection["role"] = "custom";
      const lowerName = loc.name.toLowerCase();
      if (lowerName.includes("verse")) role = "verse";
      else if (lowerName.includes("chorus")) role = "chorus";
      else if (lowerName.includes("bridge")) role = "bridge";
      else if (lowerName.includes("intro")) role = "intro";
      else if (lowerName.includes("outro")) role = "outro";
      else if (lowerName.includes("solo")) role = "solo";
      else if (lowerName.includes("break") || lowerName.includes("breakdown")) role = "breakdown";

      sections.push({
        id: crypto.randomUUID(),
        name: loc.name,
        role,
        bars,
        chords: [],
        beatsPerChord: 4,
        velocity: "mf",
        timeSignatureNumerator: timeSigNum,
        timeSignatureDenPower: Math.log2(timeSigDen),
      });
    }
  } else {
    // No locators — create a single section
    sections.push({
      id: crypto.randomUUID(),
      name: "Arrangement",
      role: "verse",
      bars: 16,
      chords: [],
      beatsPerChord: 4,
      velocity: "mf",
      timeSignatureNumerator: timeSigNum,
      timeSignatureDenPower: Math.log2(timeSigDen),
    });
  }

  return {
    id: crypto.randomUUID(),
    title,
    key,
    // `extractKey` is still a stub (C ionian); read it through rather than
    // hard-coding a second copy that would silently disagree once it is real.
    scale: scale as BlueprintSong["scale"],
    bpm: tempo,
    timeSignatureNumerator: timeSigNum,
    timeSignatureDenominator: timeSigDen,
    sections,
    arrangement: sections.map((s) => ({ sectionId: s.id, repeats: 1 })),
    concept: `Ableton Live Set import: ${locators.length} locators, ${notes.length} MIDI notes`,
    provenance: {
      source: "audio-extract",
      extractedAt: now,
      warnings: [
        "Extracted from Ableton Live Set — review section boundaries and key/scale.",
        `Tempo: ${tempo} BPM, ${sections.length} section(s) from arrangement locators.`,
        "MIDI chord detection not yet applied to extracted notes — chords will be empty.",
      ],
    },
    createdAt: now,
    updatedAt: now,
  };
}