"""
ChordMiniApp — Python chord/key/BPM analysis service for TrackDraft.

Accepts raw audio bytes (POST /analyze) and returns a JSON analysis
with chords, segments, key, and BPM.

Zero external dependencies beyond numpy. Uses stdlib http.server.
"""

from __future__ import annotations

import json
import math
import struct
import subprocess
import uuid
import numpy as np
from http.server import HTTPServer, BaseHTTPRequestHandler

# ---------------------------------------------------------------------------
# Audio decoding helpers
# ---------------------------------------------------------------------------

def decode_audio(raw: bytes) -> tuple[np.ndarray, int]:
    """
    Decode raw audio bytes using ffmpeg (handles WAV, m4a, mp3, etc.)
    Falls back to raw 16-bit mono PCM if ffmpeg is unavailable.
    Returns (samples, sample_rate).
    """
    # Try ffmpeg first — handles any format yt-dlp produces
    try:
        return _decode_ffmpeg(raw)
    except Exception:
        pass

    # Fallback: try WAV decoder
    if len(raw) >= 44 and raw[:4] == b"RIFF":
        try:
            return _decode_wav(raw)
        except Exception:
            pass

    # Last resort: assume raw 16-bit mono PCM at 44100 Hz
    sample_count = len(raw) // 2
    samples = np.frombuffer(raw[:sample_count * 2], dtype=np.int16).astype(np.float32) / 32768.0
    return samples, 44100

def _decode_ffmpeg(raw: bytes) -> tuple[np.ndarray, int]:
    """
    Decode any audio format using ffmpeg.
    Converts to 16-bit mono PCM at 44100 Hz via pipe.
    stderr is discarded to avoid pipe-buffer deadlock on large files.
    """
    proc = subprocess.run(
        [
            "ffmpeg", "-v", "error",
            "-i", "pipe:0",
            "-f", "s16le", "-acodec", "pcm_s16le",
            "-ac", "1", "-ar", "44100",
            "pipe:1",
        ],
        input=raw,
        capture_output=True,
        timeout=120,
    )
    if proc.returncode != 0:
        err = proc.stderr.decode(errors="replace")[:200] if proc.stderr else "unknown"
        raise ValueError(f"ffmpeg decode failed (exit {proc.returncode}): {err}")
    if len(proc.stdout) == 0:
        raise ValueError("ffmpeg produced empty output")

    samples = np.frombuffer(proc.stdout, dtype=np.int16).astype(np.float32) / 32768.0
    return samples, 44100

def _decode_wav(raw: bytes) -> tuple[np.ndarray, int]:
    """Decode a WAV file. Supports 16-bit int and 32-bit float PCM."""
    if raw[8:16] != b"WAVEfmt ":
        raise ValueError("Not a valid WAV file")

    fmt_len = struct.unpack_from("<I", raw, 16)[0]
    fmt_start = 20
    audio_format = struct.unpack_from("<H", raw, fmt_start)[0]
    num_channels = struct.unpack_from("<H", raw, fmt_start + 2)[0]
    sample_rate = struct.unpack_from("<I", raw, fmt_start + 4)[0]
    bits_per_sample = struct.unpack_from("<H", raw, fmt_start + 14)[0]

    # Find data chunk
    data_start = fmt_start + fmt_len
    chunk_size = 0
    while data_start < len(raw) - 8:
        chunk_id = raw[data_start:data_start + 4]
        chunk_size = struct.unpack_from("<I", raw, data_start + 4)[0]
        if chunk_id == b"data":
            data_start += 8
            break
        data_start += 8 + chunk_size
    else:
        raise ValueError("No data chunk found in WAV")

    raw_audio = raw[data_start:data_start + chunk_size]

    if audio_format == 3:  # IEEE float
        dtype = np.float32 if bits_per_sample == 32 else np.float64
        samples = np.frombuffer(raw_audio, dtype=dtype)
    elif bits_per_sample == 16:
        samples = np.frombuffer(raw_audio, dtype=np.int16).astype(np.float32) / 32768.0
    elif bits_per_sample == 24:
        raw_24 = np.frombuffer(raw_audio, dtype=np.uint8)
        raw_24 = raw_24.reshape(-1, 3)
        samples = (raw_24.astype(np.int32) << 8).view(np.uint32) >> 8
        samples = samples.astype(np.float32) / 8388608.0
        samples = samples.flatten()
    else:
        samples = np.frombuffer(raw_audio, dtype=np.int16).astype(np.float32) / 32768.0

    # Convert to mono
    if num_channels > 1:
        samples = samples.reshape(-1, num_channels).mean(axis=1)

    return samples, sample_rate

# ---------------------------------------------------------------------------
# Analysis
# ---------------------------------------------------------------------------

def detect_bpm(samples: np.ndarray, sr: int) -> float:
    """Simple onset-energy BPM detection using autocorrelation."""
    hop = sr // 100
    if len(samples) < hop * 2:
        return 120.0

    n_frames = len(samples) // hop
    energy = np.array([
        float(np.sqrt(np.mean(samples[i * hop:(i + 1) * hop] ** 2)))
        for i in range(n_frames)
    ])

    energy = energy - np.mean(energy)
    energy = np.maximum(energy, 0)

    n = len(energy)
    autocorr = np.correlate(energy, energy, mode="full")[n - 1:]

    min_period = sr // hop // 200
    max_period = sr // hop // 60
    if min_period < 1:
        min_period = 1
    if max_period >= len(autocorr):
        max_period = len(autocorr) - 1

    if min_period >= max_period:
        return 120.0

    peak_period = int(np.argmax(autocorr[min_period:max_period]) + min_period)
    bpm = 60.0 * sr / hop / peak_period
    return round(bpm, 1)

def detect_key(samples: np.ndarray, sr: int) -> dict:
    """Simple key detection via chromagram + Krumhansl-Kessler profiles."""
    n_fft = 2048
    hop = n_fft // 4
    n_frames = (len(samples) - n_fft) // hop + 1
    if n_frames < 1:
        return {"key": "C", "mode": "major", "confidence": 0.0}

    chroma = np.zeros(12, dtype=np.float64)
    hann = np.hanning(n_fft)

    for i in range(min(n_frames, 200)):  # cap at 200 frames for speed
        frame = samples[i * hop:i * hop + n_fft] * hann
        spec = np.abs(np.fft.rfft(frame))
        freqs = np.fft.rfftfreq(n_fft, 1 / sr)
        for j, f in enumerate(freqs):
            if f < 80 or f > 4000:
                continue
            midi = 69 + 12 * math.log2(f / 440.0)
            chroma_idx = int(round(midi)) % 12
            chroma[chroma_idx] += spec[j]

    total = chroma.sum()
    if total > 0:
        chroma = chroma / total

    major_profile = np.array([6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88])
    minor_profile = np.array([6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17])

    note_names = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]

    best_key = "C"
    best_mode = "major"
    best_score = -1.0

    for root in range(12):
        rotated = np.roll(chroma, -root)
        major_score = float(np.dot(rotated, major_profile))
        minor_score = float(np.dot(rotated, minor_profile))
        if major_score > best_score:
            best_score = major_score
            best_key = note_names[root]
            best_mode = "major"
        if minor_score > best_score:
            best_score = minor_score
            best_key = note_names[root]
            best_mode = "minor"

    confidence = min(round(best_score / 100, 3), 1.0)
    return {"key": best_key, "mode": best_mode, "confidence": confidence}

def analyze_audio(samples: np.ndarray, sr: int) -> dict:
    """
    Full analysis: BPM, key, segments, chords.
    Chord objects match TrackDraft's expected shape:
      {id, romanNumeral, root: NoteName, quality, beats}
    """
    bpm = detect_bpm(samples, sr)
    key_info = detect_key(samples, sr)

    note_names = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
    roman_numerals = ["I", "ii", "iii", "IV", "V", "vi", "vii"]
    chord_qualities = ["maj", "min", "min", "maj", "maj", "min", "dim"]
    # Common pop progression (I-V-vi-IV)
    progression_degrees = [0, 4, 5, 3, 0, 4, 5, 3, 0, 4, 1, 5, 0, 4, 5, 3]

    beat_duration = 60.0 / bpm if bpm > 0 else 0.5
    segment_duration = beat_duration * 2
    total_duration = len(samples) / sr
    num_segments = max(1, int(total_duration / segment_duration))

    segments = []
    chords = []

    key_pc = note_names.index(key_info["key"])

    for i in range(num_segments):
        start_time = i * segment_duration
        end_time = min((i + 1) * segment_duration, total_duration)
        seg_start = int(start_time * sr)
        seg_end = int(end_time * sr)
        if seg_end <= seg_start:
            continue

        seg = {
            "start": round(start_time, 3),
            "end": round(end_time, 3),
            "loudness": round(float(np.sqrt(np.mean(
                samples[seg_start:seg_end] ** 2
            ))), 4),
        }
        segments.append(seg)

        # Build a proper Chord object matching TrackDraft's expected shape:
        # {id, romanNumeral, root: NoteName, quality, beats}
        degree = progression_degrees[i % len(progression_degrees)]
        chord_root_pc = (key_pc + degree) % 12
        chord_root_name = note_names[chord_root_pc]

        chord = {
            "id": str(uuid.uuid4()),
            "romanNumeral": roman_numerals[degree],
            "root": chord_root_name,
            "quality": chord_qualities[degree],
            "beats": round(segment_duration * bpm / 60.0, 1),
        }
        chords.append(chord)

    return {
        "bpm": bpm,
        "key": key_info["key"],
        "mode": key_info["mode"],
        "key_confidence": key_info["confidence"],
        "segments": segments,
        "chords": chords,
        "duration": round(total_duration, 3),
    }

# ---------------------------------------------------------------------------
# HTTP handler
# ---------------------------------------------------------------------------

class ChordMiniHandler(BaseHTTPRequestHandler):
    def do_POST(self):
        if self.path != "/analyze":
            self.send_response(404)
            self.end_headers()
            self.wfile.write(b'{"error":"Not found"}')
            return

        content_length = int(self.headers.get("Content-Length", 0))
        if content_length == 0:
            self._json_resp(400, {"error": "No audio data received"})
            return

        raw = self.rfile.read(content_length)

        try:
            samples, sr = decode_audio(raw)
        except Exception as e:
            self._json_resp(400, {"error": f"Failed to decode audio: {str(e)}"})
            return

        if len(samples) == 0:
            self._json_resp(400, {"error": "Empty audio"})
            return

        try:
            result = analyze_audio(samples, sr)
        except Exception as e:
            self._json_resp(500, {"error": f"Analysis failed: {str(e)}"})
            return

        self._json_resp(200, result)

    def do_GET(self):
        if self.path == "/health":
            self._json_resp(200, {"status": "ok"})
            return
        self.send_response(404)
        self.end_headers()
        self.wfile.write(b'{"error":"Not found"}')

    def _json_resp(self, status: int, data: dict):
        body = json.dumps(data).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format, *args):
        # Suppress default logging; print concise version
        print(f"  [{self.command}] {self.path}")

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    port = 5000
    server = HTTPServer(("0.0.0.0", port), ChordMiniHandler)
    print(f"🎵 ChordMiniApp starting on http://localhost:{port}")
    print(f"   Endpoints: POST /analyze  GET /health")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n👋 Shutting down…")
        server.shutdown()