import type { Chord } from "../../../types/blueprint";
import type { Vec3 } from "../../../lib/harmony/scene3d";

/** A chord placed on the floor: the chord itself plus where it sits in space. */
export interface Node {
  chord: Chord;
  index: number;
  start: number;
  beats: number;
  /** Semitones above the tonic, 0..11 — the ladder row the box stands on. */
  step: number;
  /** How the analysis reads it (a chromatic step has two readings). */
  degree: number;
  accidental: number;
  center: Vec3;
  size: Vec3;
  /** Which loop pass this box is: 0 the first time through the progression.
   *  Later passes are the same chord sounding again, drawn as such. */
  pass?: number;
}

/** A live drag preview, drawn as a ghost box instead of the real one. */
export interface Preview {
  id: string;
  step?: number;
  spelling?: "sharp" | "flat";
  start?: number;
  beats?: number;
}
