import model from "../data/melody_model.json";
import type { MelodyModel } from "./melody.js";

/**
 * The shipped melody model: 1.94M chords / 1.42M melody points from the
 * Tegridy/LA general-MIDI corpus (see `scripts/extract_melody_model.py`).
 * Bundled as a 1.8 KB table — small enough that both the web app and the
 * progression-studio extension can carry it without an async fetch.
 */
export const DEFAULT_MELODY_MODEL = model as unknown as MelodyModel;
