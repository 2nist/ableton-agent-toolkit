/**
 * Reads and writes Ableton's `.amxd` binary wrapper format — NOT plain JSON,
 * despite `.maxpat` files (the underlying Max patcher format) being plain
 * JSON. Reverse-engineered by byte-level inspection of a real file saved
 * from Live's own Max for Live device editor (see
 * templates/m4l-device-basic/reference.amxd), since this format isn't
 * publicly documented by Cycling '74 or Ableton.
 *
 * Verified, not assumed: `test/amxd.test.ts` round-trips the real reference
 * file — parses it, re-serializes it, and re-parses that output to confirm
 * the header fields and JSON payload are semantically identical to the
 * original. NOT byte-identical: Max writes whole-number floats with an
 * explicit trailing `.0` (e.g. `439.0`), but JavaScript's `JSON.stringify`
 * has no way to distinguish the number 439 from 439.0 and always emits
 * `439`. That's an inherent JSON-serialization limitation, not a gap in
 * this format's understanding — semantic round-tripping is the strongest
 * verification actually achievable here, and it's still real proof the
 * header/wrapper structure above is completely and correctly understood.
 *
 * Structure (32-byte fixed header, then a null-terminated JSON payload):
 *
 * | offset | bytes | content                                          |
 * |--------|-------|---------------------------------------------------|
 * | 0      | 4     | magic: "ampf"                                    |
 * | 4      | 4     | uint32 LE — always seen as 4, purpose unconfirmed |
 * | 8      | 8     | literal marker: "mmmmmeta"                       |
 * | 16     | 4     | uint32 LE — always seen as 4, purpose unconfirmed |
 * | 20     | 4     | uint32 LE — always seen as 0, purpose unconfirmed |
 * | 24     | 4     | literal marker: "ptch"                           |
 * | 28     | 4     | uint32 LE — length of the payload that follows   |
 * | 32     | N     | UTF-8 JSON text + one trailing 0x00 byte, N bytes total |
 *
 * Scope: only confirmed for a minimal device (no exposed Live-mappable
 * parameters, no factory patcher preview, no automation state) — more
 * complex real-world devices may have additional trailing sections this
 * hasn't encountered. Don't assume this covers every `.amxd` a user might
 * hand you; it covers what `create device` itself produces, which never
 * exceeds this shape since it's always derived from the same reference file.
 */

const MAGIC = "ampf";
const META_MARKER = "mmmmmeta";
const PTCH_MARKER = "ptch";
const HEADER_LENGTH = 32;

export interface ParsedAmxd {
  headerVersion: number;
  metaVal1: number;
  metaVal2: number;
  /** The decoded `patcher` JSON object — mutate this, then pass to `serializeAmxd`. */
  patcher: unknown;
}

export function parseAmxd(buffer: Buffer): ParsedAmxd {
  if (buffer.subarray(0, 4).toString("ascii") !== MAGIC) {
    throw new Error(`Not a recognized .amxd file: expected magic "${MAGIC}", got "${buffer.subarray(0, 4).toString("ascii")}"`);
  }
  const headerVersion = buffer.readUInt32LE(4);
  if (buffer.subarray(8, 16).toString("ascii") !== META_MARKER) {
    throw new Error(`Unexpected .amxd structure: expected "${META_MARKER}" marker at offset 8`);
  }
  const metaVal1 = buffer.readUInt32LE(16);
  const metaVal2 = buffer.readUInt32LE(20);
  if (buffer.subarray(24, 28).toString("ascii") !== PTCH_MARKER) {
    throw new Error(`Unexpected .amxd structure: expected "${PTCH_MARKER}" marker at offset 24`);
  }
  const length = buffer.readUInt32LE(28);
  const payload = buffer.subarray(HEADER_LENGTH, HEADER_LENGTH + length);
  if (payload.length !== length) {
    throw new Error(`Truncated .amxd file: declared payload length ${length}, but only ${payload.length} bytes available`);
  }
  if (payload[payload.length - 1] !== 0x00) {
    throw new Error("Unexpected .amxd structure: payload is not null-terminated");
  }
  const jsonText = payload.subarray(0, payload.length - 1).toString("utf-8");

  return { headerVersion, metaVal1, metaVal2, patcher: JSON.parse(jsonText) };
}

export function serializeAmxd(parsed: ParsedAmxd): Buffer {
  const jsonText = JSON.stringify(parsed.patcher, null, 4);
  const jsonBytes = Buffer.from(jsonText, "utf-8");
  const payload = Buffer.concat([jsonBytes, Buffer.from([0x00])]);

  const header = Buffer.alloc(HEADER_LENGTH);
  header.write(MAGIC, 0, "ascii");
  header.writeUInt32LE(parsed.headerVersion, 4);
  header.write(META_MARKER, 8, "ascii");
  header.writeUInt32LE(parsed.metaVal1, 16);
  header.writeUInt32LE(parsed.metaVal2, 20);
  header.write(PTCH_MARKER, 24, "ascii");
  header.writeUInt32LE(payload.length, 28);

  return Buffer.concat([header, payload]);
}
