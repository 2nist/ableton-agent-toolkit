/**
 * Builds a fake `ActivationContext` and hands it to the REAL, vendored
 * `@ableton-extensions/sdk`'s own `initialize()`. Extension code under test
 * gets real `Track`/`MidiTrack`/`AudioClip` instances resolved through the
 * real `DataModelObjectRegistry` — so `instanceof` checks behave exactly as
 * they would against real Live, with zero duplicated class logic here.
 */

import { initialize, type ActivationContext, type ExtensionContext, type Handle } from "@ableton-extensions/sdk";
import { CallLog } from "./call-log.js";
import { withCallLogging } from "./call-log.js";
import { createMockNativeModule, type MockNativeModuleOptions } from "./mock-native-module.js";
import type { MockState } from "./mock-state.js";

export interface MockContext {
  /** The fake `ActivationContext` — pass this to your extension's `activate(activation)`. */
  activation: ActivationContext;
  /** The real SDK's `ExtensionContext`, already initialized against the mock — most tests just use this. */
  sdk: ExtensionContext<"1.0.0">;
  /** Every native-module call, in order, prefixed by module (`dataModel.trackCreateMidiClip`, `ui.showModalDialog`, ...). */
  log: CallLog;
  /** The raw object graph backing the mock — use for setup/assertions beyond what the SDK's own getters expose. */
  state: MockState;
  applicationHandle: Handle;
  /** Test-setup helper: adds a track under the Song and returns its handle, without going through a command. */
  addTrack(kind: "AudioTrack" | "MidiTrack", name: string): Handle;
  /** Invokes a command registered via `sdk.commands.registerCommand`. */
  invokeCommand(commandId: string, ...args: unknown[]): void;
}

export function createMockContext(options: MockNativeModuleOptions = {}): MockContext {
  const log = new CallLog();
  const native = createMockNativeModule({ ...options, log });

  const activation: ActivationContext = {
    hostApiVersion: "1.0.0",
    initializeExtensionHost: () => ({
      commands: withCallLogging(native.commands, "commands", log),
      dataModel: withCallLogging(native.dataModel, "dataModel", log),
      environment: native.environment, // plain data, nothing to wrap
      resources: withCallLogging(native.resources, "resources", log),
      ui: withCallLogging(native.ui, "ui", log),
    }),
  };

  const sdk = initialize(activation, "1.0.0");

  return {
    activation,
    sdk,
    log,
    state: native.state,
    applicationHandle: native.applicationHandle,
    addTrack: native.addTrack,
    invokeCommand: native.invokeCommand,
  };
}
