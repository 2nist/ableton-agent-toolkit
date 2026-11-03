import type { ChordQuality } from "@music-theory/core";
import type { BlueprintSong } from "../../types/blueprint";
import { layoutChart } from "../harmony/chartLayout";
import { encodeChordString, type IrealBar, type IrealSection } from "./chordString";

/** Our quality union → iReal's symbol dialect. iReal writes `-` for minor,
 *  `^` for major sevenths, `h` for half-diminished, `o` for diminished and
 *  `+` for augmented; everything extended keeps its plain spelling.
 *
 *  The two qualities iReal has no word for are approximated rather than
 *  dropped: `69` becomes `6/9` and `maj7#5` becomes `^7#5`, which play the
 *  same notes. `5` (a bare power chord) has no iReal equivalent and is
 *  written as the triad. */
const SUFFIX: Record<ChordQuality, string> = {
  maj: "",
  min: "-",
  "7": "7",
  maj7: "^7",
  min7: "-7",
  m7b5: "h7",
  sus2: "sus2",
  sus4: "sus4",
  dim: "o",
  aug: "+",
  "5": "",
  "6": "6",
  min6: "-6",
  "69": "6/9",
  add9: "add9",
  dim7: "o7",
  mMaj7: "-^7",
  "maj7#5": "^7#5",
  "7sus4": "7sus4",
  "7b5": "7b5",
  "7#5": "7#5",
  "9": "9",
  maj9: "^9",
  min9: "-9",
  "9sus4": "9sus4",
  "7b9": "7b9",
  "7#9": "7#9",
  "7#11": "7#11",
  "7b13": "7b13",
  "11": "11",
  min11: "-11",
  "13": "13",
  maj13: "^13",
  min13: "-13",
  // iReal has one diminished-seventh token and no eleventh-inclusive major, so
  // these four fall back to the family's base spelling — the same approximation
  // the header describes for `69` and `5`.
  dim11: "o7",
  maj11: "^7",
};

/** iReal writes accidentals as `b`/`#` after the letter, never as ♭/♯. */
function rootToken(root: string): string {
  return root.replace("♭", "b").replace("♯", "#");
}

export function irealSymbol(root: string, quality: ChordQuality): string {
  return `${rootToken(root)}${SUFFIX[quality] ?? ""}`;
}

/** The chart as iReal sections: same letters, bars and meters the Rehearse
 *  desk draws, because both come from `layoutChart`. */
export function toIrealSections(song: BlueprintSong): IrealSection[] {
  const chart = layoutChart(song, {
    keyName: song.key,
    scale: song.scale,
    label: (event) => event?.roman ?? "",
  });
  return chart.map((section) => ({
    letter: section.letter,
    repeats: section.repeats,
    bars: section.systems.flatMap((system) =>
      system.bars.map<IrealBar>((bar) => ({
        meter: bar.meter,
        cells: bar.chords
          .filter((chord) => chord.root)
          .map((chord) => ({ symbol: irealSymbol(chord.root, chord.quality as ChordQuality), beat: chord.beat })),
      })),
    ),
  }));
}

/** What the export could not carry. Reported to the user, never swallowed. */
export function exportLosses(song: BlueprintSong): string[] {
  const losses: string[] = [];
  const hasMelody = song.sections.some((section) => (section.melody?.notes.length ?? 0) > 0);
  if (hasMelody) losses.push("melody — iReal charts are chords only");
  if (song.sections.some((section) => section.lyrics?.trim())) losses.push("lyrics");
  if (song.sections.some((section) => section.drumPattern || section.bassProfile || section.colorFlavor)) {
    losses.push("drum / bass / colour instrumentation");
  }
  if (song.sections.some((section) => (section.meterMap?.length ?? 0) > 0)) {
    losses.push("meter changes are written as iReal time signatures — check them on import");
  }
  return losses;
}

/**
 * The `irealb://` URL for one song.
 *
 * Field order is iReal's, not ours: title, composer, style, key, [transpose],
 * music, comp-style, bpm, repeats. The chord string is obfuscated in 50-char
 * blocks (the swap is its own inverse, so the same routine unscrambles) and
 * then percent-encoded.
 */
export function encodeIrealUrl(song: BlueprintSong, options: { style?: string } = {}): string {
  const music = `1r34LbKcu7${scramble(encodeChordString(toIrealSections(song)))}`;
  const fields = [
    song.title,
    song.artist ?? "",
    options.style ?? "",
    song.key,
    music,
    options.style ?? "",
    String(Math.round(song.bpm)),
    "1",
  ];
  return `irealb://${fields.map(encodeURIComponent).join("=")}`;
}

/** iReal's obfuscation: in every 50-character block the first five characters
 *  swap with the last five, and 10–23 swap with 39–26. A final short block is
 *  left alone. The operation is an involution. */
export function scramble(music: string): string {
  let out = "";
  let rest = music;
  while (rest.length > 50) {
    out += swapBlock(rest.slice(0, 50));
    rest = rest.slice(50);
  }
  return out + rest;
}

function swapBlock(block: string): string {
  const chars = block.split("");
  for (let i = 0; i < 5; i++) {
    chars[49 - i] = block[i];
    chars[i] = block[49 - i];
  }
  for (let i = 10; i < 24; i++) {
    chars[49 - i] = block[i];
    chars[i] = block[49 - i];
  }
  return chars.join("");
}

/** A playlist file iReal Pro opens (drag it onto the app, or share to iOS).
 *  The skeleton — including the help text — is iReal's own, so the app
 *  recognises the file instead of showing a bare list of links. */
export function irealPlaylistHtml(entries: { title: string; composer?: string; url: string }[]): string {
  const lines = entries
    .map(
      (entry) =>
        `      <h3><a href="${entry.url}">${entry.title}</a> - ${entry.composer ?? ""}</h3><br/>`,
    )
    .join("\n");
  return `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml">
   <head>
      <meta name="viewport" content="width=device-width, minimum-scale=1, maximum-scale=1" />
      <meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
      <title>iReal Pro</title>
      <style type="text/css">
         .help {
         font-size: small;
         color: #999999;
         }
         .metadata {
         font-size: x-small;
         color: #666666;
         }
      </style>
   </head>
   <body style="color: rgb(230, 227, 218); background-color: rgb(27, 39, 48); font-family: Helvetica,Arial,sans-serif;" alink="#b2e0ff" link="#94d5ff" vlink="#b2e0ff">
      <br/><br/>
${lines}
      <p></p><br/>
      <br/>Made with TrackDraft
      <br/><br/><span class="help">- iOS: tap Share/Export and choose iReal Pro.<br />- Mac: drag the .html file on the iReal Pro App icon in the dock.</span><br/>
   </body>
</html>
`;
}
