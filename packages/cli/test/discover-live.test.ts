import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { findMacLiveInstallations } from "../src/discover-live.js";

let tmpAppsDir: string;

function makeFakeLiveApp(appsDir: string, name: string, withExtensionHost: boolean) {
  const appDir = path.join(appsDir, name);
  const hostDir = path.join(appDir, "Contents", "Helpers", "ExtensionHost");
  fs.mkdirSync(hostDir, { recursive: true });
  if (withExtensionHost) {
    fs.writeFileSync(path.join(hostDir, "ExtensionHostNodeModule.node"), "");
  }
}

beforeEach(() => {
  tmpAppsDir = fs.mkdtempSync(path.join(os.tmpdir(), "cli-discover-live-"));
});

afterEach(() => {
  fs.rmSync(tmpAppsDir, { recursive: true, force: true });
});

describe("findMacLiveInstallations", () => {
  it("finds Live installs that have the Extension Host module", () => {
    makeFakeLiveApp(tmpAppsDir, "Ableton Live 12 Beta.app", true);
    makeFakeLiveApp(tmpAppsDir, "Ableton Live 12 Suite.app", true);

    const installs = findMacLiveInstallations(tmpAppsDir);

    expect(installs).toHaveLength(2);
    expect(installs.map((i) => i.displayName).sort()).toEqual(["Ableton Live 12 Beta.app", "Ableton Live 12 Suite.app"]);
  });

  it("excludes Live installs without the Extension Host module (pre-Extensions versions)", () => {
    makeFakeLiveApp(tmpAppsDir, "Ableton Live 9.app", false);
    makeFakeLiveApp(tmpAppsDir, "Ableton Live 12 Beta.app", true);

    const installs = findMacLiveInstallations(tmpAppsDir);

    expect(installs).toHaveLength(1);
    expect(installs[0]!.displayName).toBe("Ableton Live 12 Beta.app");
  });

  it("ignores non-Ableton .app bundles", () => {
    makeFakeLiveApp(tmpAppsDir, "Some Other App.app", true);

    expect(findMacLiveInstallations(tmpAppsDir)).toHaveLength(0);
  });

  it("returns an empty array when the Applications directory doesn't exist, rather than throwing", () => {
    expect(findMacLiveInstallations(path.join(tmpAppsDir, "does-not-exist"))).toEqual([]);
  });
});
