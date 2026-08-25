/**
 * Implements the exact five-module contract the real SDK's `initialize()`
 * destructures from `ActivationContext.initializeExtensionHost()` — verified
 * directly against the vendored SDK's compiled `dist/index.d.mts`
 * (`EXTENSIONS_API["1.0.0"]` = `{commands, dataModel, environment, resources, ui}`).
 *
 * Deliberately NOT reimplementing Track/Clip/MidiTrack/etc. — those stay the
 * real SDK classes. This file only fakes the boundary those classes call
 * into, so `initialize()` (real, vendored) produces real `instanceof`-correct
 * SDK objects backed by this mock's state.
 *
 * Fidelity note: methods not exercised by the platform's own extensions
 * (drum racks, scenes, cue points, device parameters) are implemented to the
 * correct shape and behave plausibly, but haven't been exercised against
 * real Live behavior — only tracks/clips/take-lanes/transactions have.
 */

import * as os from "node:os";
import * as path from "node:path";
import type { EXTENSIONS_API, Handle } from "@ableton-extensions/sdk";
import type { CallLog } from "./call-log.js";
import { type Kind, MockState, seedDefaultState } from "./mock-state.js";

type Api = EXTENSIONS_API["1.0.0"];

export interface MockNativeModule {
  commands: Api["commands"];
  dataModel: Api["dataModel"];
  environment: Api["environment"];
  resources: Api["resources"];
  ui: Api["ui"];
  state: MockState;
  applicationHandle: Handle;
  /** Test-setup helper: adds a track under the Song and returns its handle. */
  addTrack(kind: "AudioTrack" | "MidiTrack", name: string): Handle;
  /** Test-setup helper: invokes a registered command by id. */
  invokeCommand(commandId: string, ...args: unknown[]): void;
  /** Depth of the currently-nested `withinTransaction` calls (0 when idle). Nested calls collapse per the real SDK's documented behavior. */
  transactionDepth(): number;
}

export interface MockNativeModuleOptions {
  /** Called for every `showModalDialog` — defaults to always erroring, since there's no real webview in a headless test. */
  onShowModalDialog?: (url: string) => { result: string } | { error: true };
  /**
   * Records exactly one `"transaction.begin"` / `"transaction.end"` pair per
   * *outermost* `withinTransaction` call — nested calls (every property
   * setter and every `create*` call issues its own internally) collapse into
   * it, matching the real SDK's documented undo-grouping behavior. This is
   * distinct from the generic per-call logging `withCallLogging` adds in
   * `create-mock-context.ts`, which logs every nested call too — use
   * `"transaction.begin"` specifically to assert "one grouped undo step."
   */
  log?: CallLog;
}

export function createMockNativeModule(options: MockNativeModuleOptions = {}): MockNativeModule {
  const { state, applicationHandle } = seedDefaultState();
  const songHandle = { id: state.getProp<bigint>(applicationHandle, "song") };

  let depth = 0;
  const withinTransaction = <T>(fn: () => T): T => {
    if (depth === 0) options.log?.record("transaction.begin", []);
    depth++;
    try {
      return fn();
    } finally {
      depth--;
      if (depth === 0) options.log?.record("transaction.end", []);
    }
  };

  const trackDefaults = () => ({ clipSlots: [] as bigint[], takeLanes: [] as bigint[], arrangementClips: [] as bigint[], devices: [] as bigint[] });

  const clipDefaults = (startTime: number, duration: number) => ({
    startTime,
    endTime: startTime + duration,
    startMarker: startTime,
    endMarker: startTime + duration,
    looping: false,
    loopStart: startTime,
    loopEnd: startTime + duration,
    color: 0,
    muted: false,
  });

  const dataModel: Api["dataModel"] = {
    getObjectIsOfClass: (handle, className) => state.isOfClass(handle, className),
    getObjectCanonicalParent: (handle) => state.parentOf(handle),
    getRoot: () => applicationHandle,

    rootGetSong: () => songHandle,
    songGetTempo: (h) => state.getProp<number>(h, "tempo"),
    songSetTempo: (h, v) => state.setProp(h, "tempo", v),
    songGetTracks: (h) => state.getRefs(h, "tracks"),
    songGetReturnTracks: (h) => state.getRefs(h, "returnTracks"),
    songGetMainTrack: (h) => ({ id: state.getProp<bigint>(h, "mainTrack") }),
    songGetGridQuantization: (h) => state.getProp(h, "gridQuantization"),
    songGetGridIsTriplet: (h) => state.getProp(h, "gridIsTriplet"),
    songGetRootNote: (h) => state.getProp(h, "rootNote"),
    songGetScaleName: (h) => state.getProp(h, "scaleName"),
    songGetScaleMode: (h) => state.getProp(h, "scaleMode"),
    songGetScaleIntervals: (h) => state.getProp(h, "scaleIntervals"),

    trackGetName: (h) => state.getProp(h, "name"),
    trackSetName: (h, v) => state.setProp(h, "name", v),
    trackGetMute: (h) => state.getProp<boolean>(h, "mute") ?? false,
    trackSetMute: (h, v) => state.setProp(h, "mute", v),
    trackGetSolo: (h) => state.getProp<boolean>(h, "solo") ?? false,
    trackSetSolo: (h, v) => state.setProp(h, "solo", v),
    trackGetMutedViaSolo: () => false,
    trackGetArm: (h) => state.getProp<boolean>(h, "arm") ?? false,
    trackSetArm: (h, v) => state.setProp(h, "arm", v),
    trackGetGroupTrack: () => null,
    trackGetClipSlots: (h) => state.getRefs(h, "clipSlots"),
    trackGetTakeLanes: (h) => state.getRefs(h, "takeLanes"),
    trackGetArrangementClips: (h) => state.getRefs(h, "arrangementClips"),
    trackGetDevices: (h) => state.getRefs(h, "devices"),
    trackGetMixerDevice: (h) =>
      state.getOrCreateChild(h, "mixer", "MixerDevice", { volume: undefined, panning: undefined, sends: [] }),
    trackCreateTakeLane: (h, onResult) => {
      const lane = state.createObject("TakeLane", { name: "Take", clips: [] }, h.id);
      state.pushRef(h, "takeLanes", lane.id);
      onResult(lane);
    },
    trackCreateMidiClip: (h, startTime, duration, onResult) => {
      const clip = state.createObject("MidiClip", { name: "MIDI Clip", notes: [], ...clipDefaults(startTime, duration) }, h.id);
      state.pushRef(h, "arrangementClips", clip.id);
      onResult(clip);
    },
    trackCreateAudioClip: (h, args, onResult) => {
      const duration = args.duration ?? 4;
      const clip = state.createObject(
        "AudioClip",
        {
          name: path.basename(args.filePath),
          filePath: args.filePath,
          warping: args.isWarped ?? true,
          warpMode: 0,
          warpMarkers: [],
          ...clipDefaults(args.startTime, duration),
        },
        h.id,
      );
      state.pushRef(h, "arrangementClips", clip.id);
      onResult(clip);
    },
    trackInsertDevice: (h, deviceName, index, onResult) => {
      const device = state.createObject("Device", { name: deviceName, parameters: [] }, h.id);
      state.insertRef(h, "devices", device.id, Number(index));
      onResult(device);
    },
    trackDeleteDevice: (h, deviceHandle, onResult) => {
      state.removeRef(h, "devices", deviceHandle.id);
      onResult();
    },
    trackDuplicateDevice: (h, deviceHandle, onResult) => {
      const clone = state.cloneObject(deviceHandle);
      state.pushRef(h, "devices", clone.id);
      onResult(clone);
    },
    trackDeleteClip: (h, clipHandle, onResult) => {
      state.removeRef(h, "arrangementClips", clipHandle.id);
      onResult();
    },
    trackClearClipsInRange: (h, startTime, endTime, onResult) => {
      const remaining = state
        .getRefs(h, "arrangementClips")
        .filter((clipHandle) => {
          const s = state.getProp<number>(clipHandle, "startTime");
          const e = state.getProp<number>(clipHandle, "endTime");
          return !(s >= startTime && e <= endTime);
        })
        .map((clipHandle) => clipHandle.id);
      state.setProp(h, "arrangementClips", remaining);
      onResult();
    },

    withinTransaction,

    clipGetName: (h) => state.getProp(h, "name"),
    clipSetName: (h, v) => state.setProp(h, "name", v),
    clipGetStartTime: (h) => state.getProp(h, "startTime"),
    clipGetEndTime: (h) => state.getProp(h, "endTime"),
    clipGetStartMarker: (h) => state.getProp(h, "startMarker"),
    clipGetEndMarker: (h) => state.getProp(h, "endMarker"),
    clipGetLooping: (h) => state.getProp(h, "looping"),
    clipSetLooping: (h, v) => state.setProp(h, "looping", v),
    clipGetLoopStart: (h) => state.getProp(h, "loopStart"),
    clipGetLoopEnd: (h) => state.getProp(h, "loopEnd"),
    clipGetColor: (h) => state.getProp(h, "color"),
    clipSetColor: (h, v) => state.setProp(h, "color", v),
    clipGetMuted: (h) => state.getProp(h, "muted"),
    clipSetMuted: (h, v) => state.setProp(h, "muted", v),

    midiclipGetNotes: (h) => state.getProp(h, "notes"),
    midiclipSetNotes: (h, notes) => state.setProp(h, "notes", notes),

    audioclipGetFilePath: (h) => state.getProp(h, "filePath"),
    audioclipGetWarping: (h) => state.getProp(h, "warping"),
    audioclipSetWarping: (h, v) => state.setProp(h, "warping", v),
    audioclipGetWarpMode: (h) => state.getProp(h, "warpMode"),
    audioclipSetWarpMode: (h, v) => state.setProp(h, "warpMode", v),
    audioclipGetWarpMarkers: (h) => state.getProp(h, "warpMarkers"),

    clipslotGetClip: (h) => {
      const clipId = state.getProp<bigint | undefined>(h, "clip");
      return clipId !== undefined ? { id: clipId } : null;
    },
    clipslotDeleteClip: (h, onResult) => {
      state.setProp(h, "clip", undefined);
      onResult();
    },
    clipslotCreateMidiClip: (h, length, onResult) => {
      const clip = state.createObject("MidiClip", { name: "MIDI Clip", notes: [], ...clipDefaults(0, length) }, h.id);
      state.setProp(h, "clip", clip.id);
      onResult(clip);
    },
    clipslotCreateAudioClip: (h, args, onResult) => {
      const clip = state.createObject(
        "AudioClip",
        {
          name: path.basename(args.filePath),
          filePath: args.filePath,
          warping: args.isWarped ?? true,
          warpMode: 0,
          warpMarkers: [],
          ...clipDefaults(0, 4),
        },
        h.id,
      );
      state.setProp(h, "clip", clip.id);
      onResult(clip);
    },

    takelaneGetClips: (h) => state.getRefs(h, "clips"),
    takelaneGetName: (h) => state.getProp(h, "name"),
    takelaneSetName: (h, v) => state.setProp(h, "name", v),
    takelaneCreateMidiClip: (h, startTime, duration, onResult) => {
      const clip = state.createObject("MidiClip", { name: "MIDI Clip", notes: [], ...clipDefaults(startTime, duration) }, h.id);
      state.pushRef(h, "clips", clip.id);
      onResult(clip);
    },
    takelaneCreateAudioClip: (h, args, onResult) => {
      const duration = args.duration ?? 4;
      const clip = state.createObject(
        "AudioClip",
        {
          name: path.basename(args.filePath),
          filePath: args.filePath,
          warping: args.isWarped ?? true,
          warpMode: 0,
          warpMarkers: [],
          ...clipDefaults(args.startTime, duration),
        },
        h.id,
      );
      state.pushRef(h, "clips", clip.id);
      onResult(clip);
    },

    deviceGetName: (h) => state.getProp(h, "name"),
    deviceGetParameters: (h) => state.getRefs(h, "parameters"),

    sampleGetFilePath: (h) => state.getProp(h, "filePath"),

    simplerGetSample: (h) => {
      const id = state.getProp<bigint | undefined>(h, "sample");
      return id !== undefined ? { id } : null;
    },
    simplerReplaceSample: (h, filePath, onResult) => {
      const sample = state.createObject("Sample", { filePath }, h.id);
      state.setProp(h, "sample", sample.id);
      onResult(sample);
    },

    chainGetDevices: (h) => state.getRefs(h, "devices"),
    chainGetMixerDevice: (h) =>
      state.getOrCreateChild(h, "mixer", "ChainMixerDevice", { volume: undefined, panning: undefined, sends: [] }),
    chainInsertDevice: (h, deviceName, index, onResult) => {
      const device = state.createObject("Device", { name: deviceName, parameters: [] }, h.id);
      state.insertRef(h, "devices", device.id, Number(index));
      onResult(device);
    },
    chainDeleteDevice: (h, deviceHandle, onResult) => {
      state.removeRef(h, "devices", deviceHandle.id);
      onResult();
    },
    chainDuplicateDevice: (h, deviceHandle, onResult) => {
      const clone = state.cloneObject(deviceHandle);
      state.pushRef(h, "devices", clone.id);
      onResult(clone);
    },

    rackdeviceGetChains: (h) => state.getRefs(h, "chains"),
    rackdeviceInsertChain: (h, index, onResult) => {
      const chain = state.createObject("Chain", { devices: [] }, h.id);
      state.insertRef(h, "chains", chain.id, Number(index));
      onResult(chain);
    },

    drumchainGetReceivingNote: (h) => state.getProp<bigint>(h, "receivingNote") ?? 60n,
    drumchainSetReceivingNote: (h, v) => state.setProp(h, "receivingNote", v),

    songGetScenes: (h) => state.getRefs(h, "scenes"),
    sceneGetName: (h) => state.getProp(h, "name"),
    sceneSetName: (h, v) => state.setProp(h, "name", v),
    sceneGetTempo: (h) => state.getProp<number>(h, "tempo") ?? state.getProp<number>(songHandle, "tempo"),
    sceneGetSignatureNumerator: (h) => state.getProp<number>(h, "signatureNumerator") ?? 4,
    sceneGetSignatureDenominator: (h) => state.getProp<number>(h, "signatureDenominator") ?? 4,

    songGetCuePoints: (h) => state.getRefs(h, "cuePoints"),
    songCreateScene: (h, index, onResult) => {
      const scene = state.createObject("Scene", { name: "Scene" }, h.id);
      state.insertRef(h, "scenes", scene.id, Number(index));
      onResult(scene);
    },
    songCreateMidiTrack: (h, onResult) => {
      const track = state.createObject("MidiTrack", { name: "MIDI Track", ...trackDefaults() }, h.id);
      state.pushRef(h, "tracks", track.id);
      onResult(track);
    },
    songCreateAudioTrack: (h, onResult) => {
      const track = state.createObject("AudioTrack", { name: "Audio Track", ...trackDefaults() }, h.id);
      state.pushRef(h, "tracks", track.id);
      onResult(track);
    },
    songDeleteTrack: (h, trackHandle, onResult) => {
      state.removeRef(h, "tracks", trackHandle.id);
      onResult();
    },
    songDeleteScene: (h, sceneHandle, onResult) => {
      state.removeRef(h, "scenes", sceneHandle.id);
      onResult();
    },
    songDuplicateTrack: (h, trackHandle, onResult) => {
      const clone = state.cloneObject(trackHandle);
      state.pushRef(h, "tracks", clone.id);
      onResult(clone);
    },
    songDuplicateScene: (h, sceneHandle, onResult) => {
      const clone = state.cloneObject(sceneHandle);
      state.pushRef(h, "scenes", clone.id);
      onResult(clone);
    },
    songCreateCuePoint: (h, time, onResult) => {
      const cue = state.createObject("CuePoint", { time, name: "Cue" }, h.id);
      state.pushRef(h, "cuePoints", cue.id);
      onResult(cue);
    },
    songDeleteCuePoint: (h, cuePointHandle, onResult) => {
      state.removeRef(h, "cuePoints", cuePointHandle.id);
      onResult();
    },

    cuePointGetTime: (h) => state.getProp(h, "time"),
    cuePointGetName: (h) => state.getProp(h, "name"),
    cuePointSetName: (h, v) => state.setProp(h, "name", v),

    deviceParameterGetName: (h) => state.getProp<string>(h, "name") ?? "Parameter",
    deviceParameterGetInternalMin: (h) => state.getProp<number>(h, "min") ?? 0,
    deviceParameterGetInternalMax: (h) => state.getProp<number>(h, "max") ?? 1,
    deviceParameterGetIsQuantized: (h) => state.getProp<boolean>(h, "isQuantized") ?? false,
    deviceParameterGetDefaultValue: (h) => state.getProp<number>(h, "defaultValue") ?? 0,
    deviceParameterGetValueItems: (h) => state.getProp(h, "valueItems") ?? [],
    deviceParameterGetInternalValue: (h, onResult) => onResult(state.getProp<number>(h, "value") ?? state.getProp<number>(h, "defaultValue") ?? 0),
    deviceParameterSetInternalValue: (h, value, onResult) => {
      state.setProp(h, "value", value);
      onResult();
    },

    mixerdeviceGetVolume: (h) => state.getOrCreateChild(h, "volume", "DeviceParameter", { name: "Volume", min: 0, max: 1, defaultValue: 0.85 }),
    mixerdeviceGetPanning: (h) => state.getOrCreateChild(h, "panning", "DeviceParameter", { name: "Pan", min: -1, max: 1, defaultValue: 0 }),
    mixerdeviceGetSends: (h) => state.getRefs(h, "sends"),
    chainmixerdeviceGetVolume: (h) => state.getOrCreateChild(h, "volume", "DeviceParameter", { name: "Volume", min: 0, max: 1, defaultValue: 0.85 }),
    chainmixerdeviceGetPanning: (h) => state.getOrCreateChild(h, "panning", "DeviceParameter", { name: "Pan", min: -1, max: 1, defaultValue: 0 }),
    chainmixerdeviceGetSends: (h) => state.getRefs(h, "sends"),
  };

  const registeredCommands = new Map<string, (...args: unknown[]) => void>();
  const commands: Api["commands"] = {
    registerCommand: (commandId, callback) => registeredCommands.set(commandId, callback),
    executeCommand: (commandId, ...args) => {
      const cb = registeredCommands.get(commandId);
      if (!cb) throw new Error(`test-harness: no command registered with id "${commandId}"`);
      cb(...args);
    },
  };

  const ui: Api["ui"] = {
    registerContextMenuAction: (_scope, _title, _commandId, onRegisterSuccessful) => {
      onRegisterSuccessful((onUnregisterSuccessful) => onUnregisterSuccessful());
    },
    showModalDialog: (url, _width, _height, onResult, onError) => {
      const outcome = options.onShowModalDialog?.(url) ?? { error: true as const };
      if ("result" in outcome) onResult(outcome.result);
      else onError();
    },
    showProgressDialog: (_options, onShowDialog) => {
      onShowDialog({
        update: (_opts, onUpdated) => onUpdated?.(),
        close: (onClosed) => onClosed?.(),
      });
    },
  };

  const environment: Api["environment"] = {
    storageDirectory: path.join(os.tmpdir(), "ableton-agent-toolkit-test-harness", "storage"),
    tempDirectory: path.join(os.tmpdir(), "ableton-agent-toolkit-test-harness", "temp"),
    language: "EN",
  };

  const resources: Api["resources"] = {
    renderPreFxAudio: (_lane, args, onResult) => {
      onResult(path.join(environment.tempDirectory!, `render-${args.startTime}-${args.endTime}.wav`));
    },
    importIntoProject: (filePath, onResult) => {
      onResult(path.join(environment.storageDirectory!, path.basename(filePath)));
    },
  };

  return {
    commands,
    dataModel,
    environment,
    resources,
    ui,
    state,
    applicationHandle,
    addTrack: (kind: "AudioTrack" | "MidiTrack", name: string) => {
      const track = state.createObject(kind, { name, ...trackDefaults() }, songHandle.id);
      state.pushRef(songHandle, "tracks", track.id);
      return track;
    },
    invokeCommand: (commandId, ...args) => commands.executeCommand(commandId, ...args),
    transactionDepth: () => depth,
  };
}

export type { Kind };
