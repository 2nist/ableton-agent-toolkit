/**
 * SWS Extension API Mocks
 *
 * SWS (Standing Water Studios) is the most widely used REAPER extension,
 * providing 1,000+ additional actions and API functions. ~50% of REAPER
 * scripts depend on SWS functions.
 *
 * These mocks enable offline testing of scripts that use SWS functions
 * by providing realistic stub implementations.
 *
 * Source: SWS Extension v2.14+ API reference
 * https://www.sws-extension.org/
 *
 * Pattern: EnviREAment enhanced_virtual_reaper.lua mock architecture
 */

/** Logging helper */
let logCalls = false;
export function setSwsLogging(enabled: boolean): void {
  logCalls = enabled;
}

function log(fn: string, ...args: any[]): void {
  if (logCalls) {
    console.log(`[SWS Mock] ${fn}(${args.map(String).join(", ")})`);
  }
}

/**
 * SWS Utility Functions
 */
export const SWS = {
  // ============================================================================
  // COLOR MANAGEMENT (BR_* family)
  // ============================================================================

  /** Get custom color from the SWS color picker */
  BR_GetColor(colorSet: number): number {
    log("BR_GetColor", colorSet);
    const swsColors = [
      0xff0000, 0x00ff00, 0x0000ff, 0xffff00,
      0xff00ff, 0x00ffff, 0xff8000, 0x8000ff,
      0x0080ff, 0x80ff00, 0xff0080, 0x00ff80,
      0x808080, 0xffffff, 0x000000, 0x8b4513,
    ];
    return swsColors[colorSet % swsColors.length] ?? 0x808080;
  },

  /** Set track to a custom SWS color */
  BR_SetTrackColor(track: any, colorSet: number): boolean {
    log("BR_SetTrackColor", colorSet);
    if (track) {
      track.color = SWS.BR_GetColor(colorSet);
      return true;
    }
    return false;
  },

  // ============================================================================
  // ZOOM / VIEW FUNCTIONS
  // ============================================================================

  /** Zoom to selected items */
  BR_ZoomToItems(): void {
    log("BR_ZoomToItems");
  },

  /** Get arrange view start/end */
  BR_GetArrangeView(startOut: number[], endOut: number[]): void {
    log("BR_GetArrangeView");
    startOut[0] = 0.0;
    endOut[0] = 60.0;
  },

  // ============================================================================
  // ENVELOPE FUNCTIONS
  // ============================================================================

  /** Get the next envelope point after the given position */
  BR_GetNextEnvelopePoint(
    envelope: any,
    position: number
  ): [boolean, number, number, number, number, boolean] {
    log("BR_GetNextEnvelopePoint", position);
    // Mock: return a point slightly ahead
    return [true, position + 1.0, 0.5, 0, 0, true];
  },

  /** Get the previous envelope point */
  BR_GetPrevEnvelopePoint(
    envelope: any,
    position: number
  ): [boolean, number, number, number, number, boolean] {
    log("BR_GetPrevEnvelopePoint", position);
    return [true, Math.max(0, position - 1.0), 0.5, 0, 0, true];
  },

  // ============================================================================
  // MEDIA ITEM FUNCTIONS
  // ============================================================================

  /** Get the active take of a media item */
  BR_ItemAtMouseCursor(): any {
    log("BR_ItemAtMouseCursor");
    return { id: 0, position: 0.0, length: 10.0 };
  },

  // ============================================================================
  // CONSOLE FUNCTIONS
  // ============================================================================

  /** Clear the REAPER console */
  BR_ClearConsole(): void {
    log("BR_ClearConsole");
    console.clear();
  },

  /** Output to the REAPER console (capturable for testing) */
  BR_OutputToConsole(msg: string): void {
    log("BR_OutputToConsole", msg);
    console.log("[REAPER Console]", msg);
  },

  // ============================================================================
  // PEAK WATCHER
  // ============================================================================

  /** Get peak value for a track (SWS Loudness/Peak Watcher) */
  BR_GetMediaTrackPeak(
    track: any,
    channel: number
  ): number {
    log("BR_GetMediaTrackPeak", channel);
    // Mock: return a random peak value
    return Math.random() * 0.8 + 0.1;
  },

  // ============================================================================
  // ITEM EDGE FUNCTIONS
  // ============================================================================

  /** Get item fade shape */
  BR_GetMediaItemFadeShape(item: any): number {
    log("BR_GetMediaItemFadeShape");
    return 0; // Default shape
  },

  /** Set item fade shape */
  BR_SetMediaItemFadeShape(item: any, shape: number, fadeType: number): void {
    log("BR_SetMediaItemFadeShape", shape, fadeType);
  },
};

/**
 * SWS/SNM (SWS Native Management) Functions
 *
 * Project state management, window positioning, and utility functions.
 */
export const SNM = {
  // ============================================================================
  // WINDOW MANAGEMENT
  // ============================================================================

  /** Get the main REAPER window handle */
  SNM_GetMainWindow(): any {
    log("SNM_GetMainWindow");
    return { type: "window", id: 0, title: "REAPER v7.0 (Virtual)" };
  },

  /** Get window position */
  SNM_GetWindowRect(
    hwnd: any
  ): { left: number; top: number; right: number; bottom: number } {
    log("SNM_GetWindowRect");
    return { left: 100, top: 100, right: 1200, bottom: 800 };
  },

  /** Set window position */
  SNM_SetWindowRect(hwnd: any, rect: any): void {
    log("SNM_SetWindowRect");
  },

  // ============================================================================
  // PROJECT MANAGEMENT
  // ============================================================================

  /** Get the current project state chunk */
  SNM_GetProjectState(): string {
    log("SNM_GetProjectState");
    return "<REAPER_PROJECT 0.1 VIRTUAL\n>\n";
  },

  /** Create a fast string (shared memory string) */
  SNM_CreateFastString(value?: string): { get: () => string; set: (v: string) => void } {
    log("SNM_CreateFastString");
    let val = value ?? "";
    return {
      get: () => val,
      set: (v: string) => { val = v; },
    };
  },

  /** Set the active project tab */
  SNM_SetIntConfigVar(varname: string, newValue: number): boolean {
    log("SNM_SetIntConfigVar", varname, newValue);
    return true;
  },

  /** Get an integer config variable */
  SNM_GetIntConfigVar(
    varname: string,
    defaultValue: number
  ): number {
    log("SNM_GetIntConfigVar", varname);
    return defaultValue;
  },

  // ============================================================================
  // MEDIA EXPLORER
  // ============================================================================

  /** Get selected media explorer source */
  SNM_GetMediaExplorerFocusedSource(): string {
    log("SNM_GetMediaExplorerFocusedSource");
    return "/mock/path/audio.wav";
  },

  // ============================================================================
  // FONT / UI
  // ============================================================================

  /** Set font for a window */
  SNM_SetStringConfigVar(varname: string, value: string): boolean {
    log("SNM_SetStringConfigVar", varname, value);
    return true;
  },

  /** Get a string config variable */
  SNM_GetStringConfigVar(
    varname: string,
    defaultValue: string
  ): string {
    log("SNM_GetStringConfigVar", varname);
    return defaultValue;
  },
};

/**
 * SWS/NF (SWS Native Functions) — Navigation and utility functions
 */
export const NF = {
  // ============================================================================
  // TRACK NAVIGATION
  // ============================================================================

  /** Get the track at a specific TCP index (ignoring folder structure) */
  NF_GetTCPTrack(tcpIndex: number): any {
    log("NF_GetTCPTrack", tcpIndex);
    return {
      id: tcpIndex,
      name: `Track ${tcpIndex + 1}`,
      volume: 1.0,
      pan: 0.0,
    };
  },

  /** Get total number of TCP tracks */
  NF_GetTCPTrackCount(): number {
    log("NF_GetTCPTrackCount");
    return 8; // Mock project with 8 TCP tracks
  },

  /** Scroll arrange view to a track */
  NF_ScrollToTrack(track: any): void {
    log("NF_ScrollToTrack");
  },
};

/**
 * SWS/CF (Cockos Functions extended by SWS) — File and shell operations
 */
export const CF = {
  // ============================================================================
  // SHELL / FILE OPERATIONS
  // ============================================================================

  /** Execute a shell command */
  CF_ShellExecute(command: string, mode?: string): number {
    log("CF_ShellExecute", command, mode);
    // Mock: returns 0 for success
    return 0;
  },

  /** Open a file dialog */
  CF_GetUserFileNameForRead(
    defaultPath: string,
    title?: string,
    filter?: string
  ): string {
    log("CF_GetUserFileNameForRead", defaultPath);
    return defaultPath || "/mock/path/file.wav";
  },

  /** Get the ReaPack path */
  CF_GetReaPackPath(): string {
    log("CF_GetReaPackPath");
    return "/mock/reaper/Scripts";
  },
};

/**
 * Full SWS API object — combined namespace for accessing all SWS functions
 * through a single import.
 *
 * Usage:
 *   import { SWS_API } from "@daw/virtual-reaper";
 *   const peak = SWS_API.BR_GetMediaTrackPeak(track, 0);
 */
export const SWS_API = {
  ...SWS,
  ...SNM,
  ...NF,
  ...CF,
};

/**
 * SWS command ID constants for Main_OnCommand lookups
 * These are the most commonly used SWS action command IDs.
 */
export const SWS_COMMAND_IDS = {
  // SWS Transport
  SWS_PLAY_PAUSE: "_SWS_PLAY_PAUSE",
  SWS_STOP: "_SWS_STOP",
  SWS_RECORD: "_SWS_RECORD",

  // SWS Zoom
  SWS_ZOOM_TO_SEL_ITEMS: "_SWS_ZOOM_TO_SEL_ITEMS",
  SWS_ZOOM_TIME_SEL: "_SWS_ZOOM_TIME_SEL",
  SWS_ZOOM_FULL_PROJ: "_SWS_ZOOM_FULL_PROJ",

  // SWS Snapshots
  SWS_SNAPSHOT_SAVE: "_SWS_SNAPSHOT_SAVE",
  SWS_SNAPSHOT_RECALL: "_SWS_SNAPSHOT_RECALL",

  // SWS Marker/Region Utilities
  SWS_CONVERT_MARKERS_TO_REGIONS: "_SWS_CONVERT_MARKERS_TO_REGIONS",
  SWS_CONVERT_REGIONS_TO_MARKERS: "_SWS_CONVERT_REGIONS_TO_MARKERS",

  // SWS Color
  SWS_AUTO_COLOR: "_SWS_AUTOCOLOR",
  SWS_AUTO_ICON: "_SWS_AUTOICON",

  // SWS Loudness
  SWS_LOUDNESS_ANALYZE: "_SWS_LOUDNESS_ANALYZE",
  SWS_LOUDNESS_NORMALIZE: "_SWS_LOUDNESS_NORMALIZE",

  // SWS Resources
  SWS_PROJ_MEDIA_BAY: "_SWS_PROJ_MEDIA_BAY",
  SWS_OPEN_RESOURCES: "_SWS_OPEN_RESOURCES",
} as const;

export default SWS_API;
