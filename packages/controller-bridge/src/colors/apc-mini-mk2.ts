/**
 * APC mini mk2 RGB LED palette.
 *
 * Source: AbletonLive11_MIDIRemoteScripts APC_mini_mk2/colors.py
 *
 * Pads light via note-on on the pad's LED channel (FULL_BRIGHTNESS_CHANNEL = 6
 * for the clip-launch/drum matrices) with velocity = palette value. Brightness
 * "channels" are separate MIDI channels carrying the same palette index —
 * a color rendered at PULSE channel blinks/slow-pulses, BLINK flashes fast,
 * HALF dims. The sequencer's LED layer (packages/step-sequencer) uses these.
 */
export interface RgbPaletteColor {
  /** Palette index sent as note velocity to light the pad. */
  value: number;
  /** MIDI channel used to carry this color (default: the pad's ledChannel). */
  channel?: number;
  /** Human-readable name. */
  name: string;
}

export interface RgbPalette {
  /** Brightness channels that modify the default channel. */
  channels: {
    half: number;
    full: number;
    pulse: number;
    blink: number;
  };
  colors: {
    black: RgbPaletteColor;
    grey: RgbPaletteColor;
    red: RgbPaletteColor;
    amber: RgbPaletteColor;
    yellow: RgbPaletteColor;
    green: RgbPaletteColor;
    ocean: RgbPaletteColor;
    blue: RgbPaletteColor;
  };
}

export const APC_MINI_MK2_PALETTE: RgbPalette = {
  channels: {
    half: 1,
    full: 6,
    pulse: 10,
    blink: 14,
  },
  colors: {
    black: { value: 0, name: "Black" },
    grey: { value: 1, name: "Grey" },
    red: { value: 5, name: "Red" },
    amber: { value: 9, name: "Amber" },
    yellow: { value: 13, name: "Yellow" },
    green: { value: 21, name: "Green" },
    ocean: { value: 41, name: "Ocean" },
    blue: { value: 45, name: "Blue" },
  },
};

/** All named palette colors in index order, for lookups/cycling. */
export const APC_MINI_MK2_PALETTE_ORDER: RgbPaletteColor[] = [
  APC_MINI_MK2_PALETTE.colors.black,
  APC_MINI_MK2_PALETTE.colors.grey,
  APC_MINI_MK2_PALETTE.colors.red,
  APC_MINI_MK2_PALETTE.colors.amber,
  APC_MINI_MK2_PALETTE.colors.yellow,
  APC_MINI_MK2_PALETTE.colors.green,
  APC_MINI_MK2_PALETTE.colors.ocean,
  APC_MINI_MK2_PALETTE.colors.blue,
];
