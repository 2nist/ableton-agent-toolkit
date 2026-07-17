/**
 * Environment Detection & Adapter
 *
 * Detects whether code is running in real REAPER, EnviREAment virtual
 * environment, or standalone mode. Provides the appropriate API surface.
 *
 * Pattern from EnviREAment enhanced_virtual_reaper.lua (lines 27-55):
 *   - IS_ENVIREAMENT detection via reaper._ENVIREAMENT flag
 *   - IS_STANDALONE_TEST detection via missing reaper object
 *   - ImGui compatibility shim (reaper.ImGui_* → ImGui metatable)
 *
 * Ported to TypeScript for use in build pipelines and test frameworks.
 */

import type { RuntimeEnvironment, VirtualReaperState } from "./types";

/**
 * Detect the current runtime environment.
 */
export function detectEnvironment(): RuntimeEnvironment {
  // Check for EnviREAment flag (set by enhanced_virtual_reaper.lua)
  if (
    typeof (globalThis as any).reaper !== "undefined" &&
    ((globalThis as any).reaper._ENVIREAMENT ||
     (globalThis as any).reaper._virtual)
  ) {
    return "envirement";
  }

  // Check for real REAPER
  if (typeof (globalThis as any).reaper !== "undefined") {
    return "reaper";
  }

  // Standalone — no REAPER API available
  return "standalone";
}

/**
 * Environment adapter — provides the correct API surface based on
 * the detected runtime environment.
 *
 * This is the core architectural pattern from EnviREAment:
 * polymorphic environment adapter with graceful fallbacks.
 */
export class EnvironmentAdapter {
  private env: RuntimeEnvironment;

  constructor() {
    this.env = detectEnvironment();
  }

  /** Get the current runtime environment */
  get environment(): RuntimeEnvironment {
    return this.env;
  }

  /** Whether running in real REAPER */
  get isReaper(): boolean {
    return this.env === "reaper";
  }

  /** Whether running in EnviREAment virtual environment */
  get isEnvirement(): boolean {
    return this.env === "envirement";
  }

  /** Whether running standalone (no REAPER API) */
  get isStandalone(): boolean {
    return this.env === "standalone";
  }

  /**
   * Get the appropriate reaper API object.
   * In real REAPER: returns the real reaper object
   * In EnviREAment: returns the mock reaper object
   * In standalone: returns null (caller should handle graceful exit)
   */
  getReaperAPI(): any | null {
    if (this.isReaper || this.isEnvirement) {
      return (globalThis as any).reaper;
    }
    return null;
  }

  /**
   * Check if a specific API function is available.
   */
  hasAPI(functionName: string): boolean {
    const reaper = this.getReaperAPI();
    if (!reaper) return false;
    return typeof reaper[functionName] === "function";
  }

  /**
   * Check if ImGui is available in the current environment.
   */
  hasImGui(): boolean {
    const reaper = this.getReaperAPI();
    if (!reaper) return false;
    return typeof reaper.ImGui_CreateContext === "function";
  }

  /**
   * Check if SWS extension is available.
   */
  hasSWS(): boolean {
    const reaper = this.getReaperAPI();
    if (!reaper) return false;
    // SWS functions are typically prefixed with BR_, SNM_, NF_, or CF_
    return (
      typeof reaper.BR_GetColor === "function" ||
      typeof reaper.SNM_GetMainWindow === "function"
    );
  }

  /**
   * Check if ReaPack is available.
   */
  hasReaPack(): boolean {
    const reaper = this.getReaperAPI();
    if (!reaper) return false;
    return typeof reaper.ReaPack_GetOwner === "function";
  }

  /**
   * Check if Helgobox (ReaLearn/Playtime) is available.
   */
  hasHelgobox(): boolean {
    const reaper = this.getReaperAPI();
    if (!reaper) return false;
    return typeof reaper.helgobox !== "undefined";
  }

  /**
   * Run a callback that depends on the reaper API, safely.
   * If the API is not available, returns the fallback value.
   */
  safeCall<T>(callback: (reaper: any) => T, fallback: T): T {
    const reaper = this.getReaperAPI();
    if (!reaper) return fallback;
    try {
      return callback(reaper);
    } catch {
      return fallback;
    }
  }

  /**
   * Get a version string for the current environment.
   */
  getVersion(): string {
    return this.safeCall(
      (r) => r.GetAppVersion?.() ?? "unknown",
      "standalone"
    );
  }
}

/**
 * Default singleton instance — use this or create your own.
 */
export const env = new EnvironmentAdapter();

/**
 * Convenience: check if we should exit early in standalone mode.
 * (Matches EnviREAment's early return pattern at line 42-48 of main.lua)
 */
export function shouldExitEarly(): boolean {
  if (env.isStandalone) {
    console.log("[TEST] Standalone mode detected — exiting early");
    return true;
  }
  return false;
}

export default EnvironmentAdapter;
