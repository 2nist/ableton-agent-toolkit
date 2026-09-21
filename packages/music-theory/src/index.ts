export * from "./types";
export * from "./notes";
export * from "./scales";
export * from "./substitutions";
export * from "./progressions";
export * from "./chords";
// `chords.ts` historically shipped its own inline `applyPerformanceEffect`;
// `performance.ts` has the canonical dispatcher (undefined-safe, velocity
// aware) that every consumer actually resolves to. The explicit re-export
// below shadows the chords.ts wildcard one (TypeScript lets an explicit
// re-export win over a `export *`), resolving the TS2308 ambiguity while
// keeping ALL of performance.ts's public surface available.
export {
  applyPerformanceEffect,
  applyStrum,
  applyPulse,
  applyArp,
  planChordNotes,
  type ChordPerformanceNote,
  type ChordPerformanceEffect,
  type PlannedChordNote,
} from "./performance";
