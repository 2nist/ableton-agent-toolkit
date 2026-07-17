import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseAmxd } from "../src/amxd.js";
import { scaffoldDevice } from "../src/scaffold-device.js";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const REFERENCE_AMXD = path.join(REPO_ROOT, "templates", "m4l-device-basic", "reference.amxd");
const REFERENCE_HTML = path.join(REPO_ROOT, "templates", "m4l-device-basic", "ui", "interface.html");

interface PatcherBox {
  box: Record<string, unknown>;
}
interface PatcherRoot {
  patcher: { boxes: PatcherBox[] };
}

let tmpDir: string;
let targetDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cli-scaffold-device-"));
  targetDir = path.join(tmpDir, "my-device");
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("scaffoldDevice", () => {
  beforeEach(() => {
    scaffoldDevice({
      targetDir,
      deviceName: "my-device",
      referenceAmxdPath: REFERENCE_AMXD,
      referenceHtmlPath: REFERENCE_HTML,
    });
  });

  it("writes <name>.amxd and ui/interface.html", () => {
    expect(fs.existsSync(path.join(targetDir, "my-device.amxd"))).toBe(true);
    expect(fs.existsSync(path.join(targetDir, "ui", "interface.html"))).toBe(true);
  });

  it("the written .amxd is itself parseable by our own parser", () => {
    const buffer = fs.readFileSync(path.join(targetDir, "my-device.amxd"));
    expect(() => parseAmxd(buffer)).not.toThrow();
  });

  it("patches both the jweb url attribute and the read message to point at this device's own ui/interface.html — not the reference template's path", () => {
    const buffer = fs.readFileSync(path.join(targetDir, "my-device.amxd"));
    const { patcher } = parseAmxd(buffer) as unknown as { patcher: PatcherRoot };
    const expectedPath = path.join(targetDir, "ui", "interface.html");

    const jweb = patcher.patcher.boxes.find((b) => b.box.maxclass === "jweb")!.box;
    expect(jweb.url).toBe(`file://${expectedPath}`);
    expect(jweb.url).not.toContain("m4l-device-basic"); // must not still point at the template

    const messageBox = patcher.patcher.boxes.find((b) => b.box.maxclass === "message")!.box;
    expect(messageBox.text).toBe(`read file://${expectedPath}`);
  });

  it("preserves every other box untouched (inlet, outlet, loadbang, midiin/midiout, comments)", () => {
    const buffer = fs.readFileSync(path.join(targetDir, "my-device.amxd"));
    const { patcher } = parseAmxd(buffer) as unknown as { patcher: PatcherRoot };
    const classes = patcher.patcher.boxes.map((b) => b.box.maxclass).sort();
    // 11 boxes total: the hidden "Device vertical limit" comment (maxclass
    // "comment") is distinct from the 3 visible "live.comment" boxes —
    // easy to undercount from a quick read, so pinned here explicitly.
    expect(classes).toEqual(["comment", "inlet", "jweb", "live.comment", "live.comment", "live.comment", "message", "newobj", "newobj", "newobj", "outlet"]);
  });

  it("copies the actual reference HTML content, not an empty file", () => {
    const html = fs.readFileSync(path.join(targetDir, "ui", "interface.html"), "utf-8");
    expect(html).toContain("window.max");
  });
});

describe("scaffoldDevice — safety", () => {
  it("refuses to scaffold into a non-empty directory", () => {
    fs.mkdirSync(targetDir, { recursive: true });
    fs.writeFileSync(path.join(targetDir, "existing.txt"), "hi");

    expect(() =>
      scaffoldDevice({
        targetDir,
        deviceName: "my-device",
        referenceAmxdPath: REFERENCE_AMXD,
        referenceHtmlPath: REFERENCE_HTML,
      }),
    ).toThrow(/not empty/);
  });
});
