/**
 * A generic object graph backing the mock native module. Every SDK-visible
 * object (Application, Song, Track, Clip, ...) is stored as one record here,
 * keyed by its class name via `kind`. `getObjectIsOfClass` resolution in
 * mock-native-module.ts just checks `kind === className` — the real SDK's
 * DataModelObjectRegistry does the rest (it walks its own class list,
 * specific-before-generic, e.g. MidiTrack before Track).
 *
 * `kind` must match the real SDK class's *`static className`*, not its
 * exported identifier — those differ for three classes (`DrumRack`'s is
 * `"DrumRackDevice"`, `TrackMixer`'s is `"MixerDevice"`, `ChainMixer`'s is
 * `"ChainMixerDevice"`; verified against the vendored SDK's compiled
 * `dist/index.mjs`). A mismatch here doesn't fail loudly at creation time —
 * `createObject` accepts any `Kind` string — it fails later, deep inside
 * the *real* SDK's own `DataModelObjectRegistry.getOrCreateObjectFromHandle`
 * with a generic "Unknown object type", the first time something actually
 * resolves the handle (e.g. `track.devices`). Found via drum-studio's Phase
 * 3 pad-mapping tests, the first real exercise of drum-rack mocking this
 * harness has had — its own fidelity note above already flagged this
 * family as untested against real behavior.
 */

import type { Handle } from "@ableton-extensions/sdk";

export type Kind =
  | "Application"
  | "Song"
  | "AudioTrack"
  | "MidiTrack"
  | "Track"
  | "AudioClip"
  | "MidiClip"
  | "ClipSlot"
  | "TakeLane"
  | "Simpler"
  | "DrumRackDevice"
  | "RackDevice"
  | "Device"
  | "Sample"
  | "DrumChain"
  | "Chain"
  | "Scene"
  | "CuePoint"
  | "DeviceParameter"
  | "MixerDevice"
  | "ChainMixerDevice";

interface MockObject {
  id: bigint;
  kind: Kind;
  props: Record<string, unknown>;
}

export class MockState {
  private nextId = 1n;
  private objects = new Map<bigint, MockObject>();
  private parents = new Map<bigint, bigint>();

  createObject(kind: Kind, props: Record<string, unknown> = {}, parentId?: bigint): Handle {
    const id = this.nextId++;
    this.objects.set(id, { id, kind, props });
    if (parentId !== undefined) this.parents.set(id, parentId);
    return { id };
  }

  private get(handle: Handle): MockObject {
    const obj = this.objects.get(handle.id);
    if (!obj) throw new Error(`test-harness: unknown handle ${handle.id} — was it deleted, or never created?`);
    return obj;
  }

  kindOf(handle: Handle): Kind {
    return this.get(handle).kind;
  }

  isOfClass(handle: Handle, className: string): boolean {
    return this.get(handle).kind === className;
  }

  parentOf(handle: Handle): Handle | null {
    const parentId = this.parents.get(handle.id);
    return parentId !== undefined ? { id: parentId } : null;
  }

  setParent(handle: Handle, parentHandle: Handle): void {
    this.parents.set(handle.id, parentHandle.id);
  }

  getProp<T>(handle: Handle, key: string): T {
    return this.get(handle).props[key] as T;
  }

  setProp(handle: Handle, key: string, value: unknown): void {
    this.get(handle).props[key] = value;
  }

  /** Reads a `bigint[]` prop as `Handle[]`. Missing prop reads as empty. */
  getRefs(handle: Handle, key: string): Handle[] {
    return ((this.get(handle).props[key] as bigint[] | undefined) ?? []).map((id) => ({ id }));
  }

  pushRef(handle: Handle, key: string, childId: bigint): void {
    const arr = (this.get(handle).props[key] as bigint[] | undefined) ?? [];
    arr.push(childId);
    this.setProp(handle, key, arr);
  }

  insertRef(handle: Handle, key: string, childId: bigint, index: number): void {
    const arr = (this.get(handle).props[key] as bigint[] | undefined) ?? [];
    const at = index < 0 ? arr.length : Math.min(index, arr.length);
    arr.splice(at, 0, childId);
    this.setProp(handle, key, arr);
  }

  removeRef(handle: Handle, key: string, childId: bigint): void {
    const arr = (this.get(handle).props[key] as bigint[] | undefined) ?? [];
    this.setProp(
      handle,
      key,
      arr.filter((id) => id !== childId),
    );
  }

  /** Deep-ish clone of an object's own props (refs arrays are copied, not walked) — enough for duplicateTrack/duplicateScene/duplicateDevice mocks. */
  cloneObject(handle: Handle): Handle {
    const src = this.get(handle);
    const clonedProps: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(src.props)) {
      clonedProps[key] = Array.isArray(value) ? [...value] : value;
    }
    return this.createObject(src.kind, clonedProps, this.parents.get(handle.id));
  }

  /** Lazily creates (and caches on the parent's props under `cacheKey`) a singleton child object — used for mixer devices and their volume/panning parameters. */
  getOrCreateChild(handle: Handle, cacheKey: string, kind: Kind, defaultProps: Record<string, unknown>): Handle {
    const cached = this.get(handle).props[cacheKey] as bigint | undefined;
    if (cached !== undefined) return { id: cached };
    const child = this.createObject(kind, defaultProps, handle.id);
    this.setProp(handle, cacheKey, child.id);
    return child;
  }
}

/** Seeds a minimal Application → Song → main Track graph, matching what `getRoot()` must always resolve to. */
export function seedDefaultState(): { state: MockState; applicationHandle: Handle } {
  const state = new MockState();
  const applicationHandle = state.createObject("Application", {});
  const songHandle = state.createObject(
    "Song",
    {
      tempo: 120,
      tracks: [] as bigint[],
      returnTracks: [] as bigint[],
      scenes: [] as bigint[],
      cuePoints: [] as bigint[],
      gridQuantization: 8, // Sixteenth
      gridIsTriplet: false,
      rootNote: 0n,
      scaleName: "Major",
      scaleMode: false,
      scaleIntervals: [0n, 2n, 4n, 5n, 7n, 9n, 11n],
    },
    applicationHandle.id,
  );
  state.setProp(applicationHandle, "song", songHandle.id);

  const mainTrackHandle = state.createObject(
    "Track",
    { name: "Main", clipSlots: [], takeLanes: [], arrangementClips: [], devices: [] },
    songHandle.id,
  );
  state.setProp(songHandle, "mainTrack", mainTrackHandle.id);

  return { state, applicationHandle };
}
