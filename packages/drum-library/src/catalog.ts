import type { BeatType, TimeSignature } from "./types.js";

/**
 * One row of E-GMD's own `e-gmd-v1.0.0.csv`. The dataset ships an
 * authoritative index, so we read that rather than parsing filenames —
 * filenames encode most of this, but the CSV is the source of truth and
 * also carries `kit_name` and the train/test/validation split, neither of
 * which appears in the name.
 */
export interface CatalogEntry {
  drummer: string;
  session: string;
  style: string;
  bpm: number;
  beatType: BeatType;
  timeSignature: TimeSignature;
  /** Seconds, per the dataset. Only a rough guide — we measure real length from the MIDI. */
  duration: number;
  split: string;
  midiFilename: string;
  kitName: string;
}

/**
 * Minimal RFC-4180 field splitter. E-GMD's rows don't currently quote
 * anything, but `kit_name` holds free text like `JingleStacks (2nd Hi-Hat)`,
 * so quoting could appear in a future revision and a naive `split(",")`
 * would silently shift every column after it.
 */
function splitCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (inQuotes) {
      if (char === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      fields.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  fields.push(current);
  return fields;
}

function parseTimeSignature(raw: string): TimeSignature {
  // E-GMD writes these as `4-4`, `6-8`, `5-4`. Odd meters are only ~1.1% of
  // the corpus but they're real, and treating them as 4/4 would misalign
  // every bar boundary in them.
  const [numerator, denominator] = raw.split("-").map((part) => Number.parseInt(part, 10));
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || numerator <= 0 || denominator <= 0) {
    throw new Error(`Unparseable time signature: ${raw}`);
  }
  return { numerator, denominator };
}

/** Quarter notes per bar. A 6/8 bar is 3 quarter notes, not 6. */
export function beatsPerBar(timeSignature: TimeSignature): number {
  return timeSignature.numerator * (4 / timeSignature.denominator);
}

export function parseCatalog(csv: string): CatalogEntry[] {
  const lines = csv.split("\n").filter((line) => line.trim().length > 0);
  const header = splitCsvLine(lines[0]).map((name) => name.trim());
  const columnOf = (name: string): number => {
    const index = header.indexOf(name);
    if (index < 0) throw new Error(`E-GMD catalog is missing the '${name}' column`);
    return index;
  };

  const drummer = columnOf("drummer");
  const session = columnOf("session");
  const style = columnOf("style");
  const bpm = columnOf("bpm");
  const beatType = columnOf("beat_type");
  const timeSignature = columnOf("time_signature");
  const duration = columnOf("duration");
  const split = columnOf("split");
  const midiFilename = columnOf("midi_filename");
  const kitName = columnOf("kit_name");

  const entries: CatalogEntry[] = [];
  for (const line of lines.slice(1)) {
    const fields = splitCsvLine(line);
    if (fields.length < header.length) continue;
    const type = fields[beatType].trim();
    entries.push({
      drummer: fields[drummer].trim(),
      session: fields[session].trim(),
      style: fields[style].trim(),
      bpm: Number.parseFloat(fields[bpm]),
      beatType: type === "fill" ? "fill" : "beat",
      timeSignature: parseTimeSignature(fields[timeSignature].trim()),
      duration: Number.parseFloat(fields[duration]),
      split: fields[split].trim(),
      midiFilename: fields[midiFilename].trim(),
      kitName: fields[kitName].trim(),
    });
  }
  return entries;
}
