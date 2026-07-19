// The canonical schema lives in @music-theory/song-blueprint, shared with
// extensions/trackdraft-bridge (which used to maintain its own duplicate
// subset of these same types independently). Re-exported here so the
// many existing call sites in this app don't need updating individually.
export * from "@music-theory/song-blueprint";
