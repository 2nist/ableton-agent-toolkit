/**
 * Minimal PCM WAV read/write. Written by hand rather than pulled in as a
 * dependency because the sample library is uniformly 16-bit 44.1kHz mono
 * PCM, which is the simplest case the format has — and an audio dependency
 * in a package that otherwise only does maths isn't worth the weight.
 */

export interface AudioBuffer {
  sampleRate: number;
  /** Mono, normalised to roughly -1..1. */
  samples: Float32Array;
}

/**
 * Decode a PCM WAV. Chunks are walked rather than assumed to sit at fixed
 * offsets: plenty of these files carry `LIST`/`fact` chunks before `data`,
 * and reading from a hardcoded offset would return metadata as audio.
 */
export function decodeWav(bytes: Uint8Array): AudioBuffer {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, false) !== 0x52494646) throw new Error("not a RIFF file");
  if (view.getUint32(8, false) !== 0x57415645) throw new Error("not a WAVE file");

  let channels = 1;
  let sampleRate = 44100;
  let bitsPerSample = 16;
  let format = 1;
  let dataStart = -1;
  let dataLength = 0;

  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const id = String.fromCharCode(
      bytes[offset],
      bytes[offset + 1],
      bytes[offset + 2],
      bytes[offset + 3],
    );
    const size = view.getUint32(offset + 4, true);
    const body = offset + 8;

    if (id === "fmt ") {
      format = view.getUint16(body, true);
      channels = view.getUint16(body + 2, true);
      sampleRate = view.getUint32(body + 4, true);
      bitsPerSample = view.getUint16(body + 14, true);
    } else if (id === "data") {
      dataStart = body;
      dataLength = Math.min(size, bytes.length - body);
    }

    // Chunks are word-aligned; an odd size is followed by a pad byte.
    offset = body + size + (size % 2);
  }

  if (dataStart < 0) throw new Error("no data chunk");
  if (format !== 1) throw new Error(`unsupported WAV format ${format} (only PCM)`);

  const bytesPerSample = bitsPerSample / 8;
  const frames = Math.floor(dataLength / (bytesPerSample * channels));
  const samples = new Float32Array(frames);

  for (let i = 0; i < frames; i++) {
    // Mixing channels down to mono keeps the renderer simple; the library is
    // mono anyway, so this only matters for stray stereo files.
    let sum = 0;
    for (let channel = 0; channel < channels; channel++) {
      const at = dataStart + (i * channels + channel) * bytesPerSample;
      if (bitsPerSample === 16) sum += view.getInt16(at, true) / 32768;
      else if (bitsPerSample === 24) {
        const raw = (view.getUint8(at) | (view.getUint8(at + 1) << 8) | (view.getInt8(at + 2) << 16));
        sum += raw / 8388608;
      } else if (bitsPerSample === 32) sum += view.getInt32(at, true) / 2147483648;
      else if (bitsPerSample === 8) sum += (view.getUint8(at) - 128) / 128;
      else throw new Error(`unsupported bit depth ${bitsPerSample}`);
    }
    samples[i] = sum / channels;
  }

  return { sampleRate, samples };
}

/** Encode mono float samples as a 16-bit PCM WAV, hard-clipping out-of-range values. */
export function encodeWav(buffer: AudioBuffer): Uint8Array {
  const { samples, sampleRate } = buffer;
  const bytes = new Uint8Array(44 + samples.length * 2);
  const view = new DataView(bytes.buffer);

  const writeAscii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) bytes[offset + i] = text.charCodeAt(i);
  };

  writeAscii(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  writeAscii(8, "WAVE");
  writeAscii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  writeAscii(36, "data");
  view.setUint32(40, samples.length * 2, true);

  for (let i = 0; i < samples.length; i++) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(44 + i * 2, Math.round(clamped * 32767), true);
  }

  return bytes;
}
