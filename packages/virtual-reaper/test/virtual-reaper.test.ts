/**
 * Baseline regression suite for the ported @daw/virtual-reaper.
 * See @music-theory/core's test file for why this exists despite not
 * mirroring an upstream suite — there wasn't one to mirror.
 */

import { afterEach, describe, expect, it } from "vitest";
import {
  SWS,
  detectEnvironment,
  EnvironmentAdapter,
  generateMockSyncDiff,
  SWS_COMMAND_IDS,
  TestRunner,
} from "../src/index.js";

afterEach(() => {
  delete (globalThis as any).reaper;
});

describe("detectEnvironment", () => {
  it("reports 'standalone' when no global reaper object exists", () => {
    expect(detectEnvironment()).toBe("standalone");
  });

  it("reports 'reaper' when a plain reaper global is present", () => {
    (globalThis as any).reaper = {};
    expect(detectEnvironment()).toBe("reaper");
  });

  it("reports 'envirement' when reaper._ENVIREAMENT is set", () => {
    (globalThis as any).reaper = { _ENVIREAMENT: true };
    expect(detectEnvironment()).toBe("envirement");
  });
});

describe("EnvironmentAdapter", () => {
  it("exposes isStandalone/isReaper/isEnvirement based on the detected environment", () => {
    const standalone = new EnvironmentAdapter();
    expect(standalone.isStandalone).toBe(true);

    (globalThis as any).reaper = { _virtual: true };
    const virtual = new EnvironmentAdapter();
    expect(virtual.isEnvirement).toBe(true);
  });

  it("hasAPI checks for a named function on the reaper object", () => {
    (globalThis as any).reaper = { GetPlayPosition: () => 0 };
    const adapter = new EnvironmentAdapter();
    expect(adapter.hasAPI("GetPlayPosition")).toBe(true);
    expect(adapter.hasAPI("NotARealFunction")).toBe(false);
  });

  it("hasSWS detects the BR_/SNM_ function family", () => {
    (globalThis as any).reaper = { BR_GetColor: () => 0 };
    expect(new EnvironmentAdapter().hasSWS()).toBe(true);
  });

  it("safeCall returns the fallback in standalone mode without invoking the callback", () => {
    const adapter = new EnvironmentAdapter();
    const result = adapter.safeCall(() => {
      throw new Error("should not be called");
    }, "fallback");
    expect(result).toBe("fallback");
  });

  it("safeCall catches exceptions thrown by the callback and returns the fallback", () => {
    (globalThis as any).reaper = {};
    const adapter = new EnvironmentAdapter();
    const result = adapter.safeCall(() => {
      throw new Error("boom");
    }, "fallback");
    expect(result).toBe("fallback");
  });
});

describe("SWS API mocks", () => {
  it("BR_GetColor cycles through a fixed palette by index", () => {
    expect(SWS.BR_GetColor(0)).toBe(0xff0000);
    expect(SWS.BR_GetColor(16)).toBe(SWS.BR_GetColor(0)); // wraps at palette length
  });

  it("exposes SWS command ID constants used for Main_OnCommand lookups", () => {
    expect(SWS_COMMAND_IDS.SWS_ZOOM_FULL_PROJ).toBe("_SWS_ZOOM_FULL_PROJ");
  });
});

describe("TestRunner", () => {
  it("runTest records a failing test's error message instead of throwing", () => {
    const runner = new TestRunner();
    const result = runner.runTest("boom", () => {
      throw new Error("kaboom");
    });
    expect(result.passed).toBe(false);
    expect(result.error).toBe("kaboom");
  });

  it("endPhase aggregates pass/fail across its tests", () => {
    const runner = new TestRunner();
    runner.beginPhase("Standalone");
    const tests = [
      runner.runTest("a", () => {}),
      runner.runTest("b", () => {
        throw new Error("fail");
      }),
    ];
    const phase = runner.endPhase("Standalone", tests);
    expect(phase.passed).toBe(false);
    expect(phase.errors).toEqual(["fail"]);
  });

  it("flags unbalanced ImGui Begin/End calls", () => {
    const runner = new TestRunner();
    runner.imguiBegin("Main Window");
    runner.imguiEnd();
    runner.imguiEnd(); // extra End with no matching Begin
    expect(runner.validateImGuiStack()).toBe(false);
    expect(runner.getImGuiStack().errors.length).toBeGreaterThan(0);
  });

  it("validateImGuiStack passes when Begin/End calls are balanced", () => {
    const runner = new TestRunner();
    runner.imguiBegin("Main Window");
    runner.imguiEnd();
    expect(runner.validateImGuiStack()).toBe(true);
  });
});

describe("generateMockSyncDiff", () => {
  it("classifies functions as missing (real-only) or added (mock-only)", () => {
    const diff = generateMockSyncDiff(
      ["BR_GetColor", "BR_SetTrackColor", "NF_GetTCPTrack"],
      ["BR_GetColor", "SNM_GetMainWindow"]
    );
    expect(diff.missing.sort()).toEqual(["BR_SetTrackColor", "NF_GetTCPTrack"]);
    expect(diff.added).toEqual(["SNM_GetMainWindow"]);
  });
});
