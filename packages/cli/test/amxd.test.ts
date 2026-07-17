import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseAmxd, serializeAmxd } from "../src/amxd.js";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const REFERENCE_AMXD = path.join(REPO_ROOT, "templates", "m4l-device-basic", "reference.amxd");

describe("parseAmxd — against the real reference.amxd", () => {
  it("parses the header fields exactly", () => {
    const buffer = fs.readFileSync(REFERENCE_AMXD);
    const parsed = parseAmxd(buffer);
    expect(parsed.headerVersion).toBe(4);
    expect(parsed.metaVal1).toBe(4);
    expect(parsed.metaVal2).toBe(0);
  });

  it("parses the embedded patcher JSON and finds our actual objects", () => {
    const buffer = fs.readFileSync(REFERENCE_AMXD);
    const { patcher } = parseAmxd(buffer) as { patcher: { patcher: { boxes: Array<{ box: Record<string, unknown> }> } } };
    const classes = patcher.patcher.boxes.map((b) => b.box.maxclass);
    expect(classes).toEqual(expect.arrayContaining(["jweb", "inlet", "outlet", "newobj"]));

    const jweb = patcher.patcher.boxes.find((b) => b.box.maxclass === "jweb")!.box;
    expect(jweb.url).toContain("interface.html");
  });

  it("rejects a file that isn't ampf/mmmmmeta/ptch shaped", () => {
    const garbage = Buffer.from("not an amxd file at all, just plain text padding to be long enough");
    expect(() => parseAmxd(garbage)).toThrow(/magic/);
  });
});

describe("serializeAmxd — semantic round-trip against the real reference.amxd", () => {
  it("re-parsing the serialized output reproduces the same header fields and patcher content", () => {
    const original = fs.readFileSync(REFERENCE_AMXD);
    const parsed = parseAmxd(original);

    const reserialized = serializeAmxd(parsed);
    const reparsed = parseAmxd(reserialized);

    expect(reparsed.headerVersion).toBe(parsed.headerVersion);
    expect(reparsed.metaVal1).toBe(parsed.metaVal1);
    expect(reparsed.metaVal2).toBe(parsed.metaVal2);
    // Deep equality here is the real proof: JSON.parse normalizes 439.0 and
    // 439 to the identical JS number 439, so this catches any actual
    // structural or content difference while correctly ignoring the
    // unavoidable whole-number-float text formatting difference documented
    // in amxd.ts's module comment.
    expect(reparsed.patcher).toEqual(parsed.patcher);
  });

  it("produces a file structurally valid enough to be re-parsed by our own parser with no errors", () => {
    const original = fs.readFileSync(REFERENCE_AMXD);
    const parsed = parseAmxd(original);
    const reserialized = serializeAmxd(parsed);

    expect(() => parseAmxd(reserialized)).not.toThrow();
    // Header length is fixed (32 bytes); payload length will differ slightly
    // from the original due to the .0-formatting difference, not an error.
    expect(reserialized.subarray(0, 4).toString("ascii")).toBe("ampf");
  });
});
