"""
ChordMiniApp — Python chord/key/BPM analysis service for TrackDraft.

Accepts raw audio bytes (POST /analyze) and returns a JSON analysis
with chords, segments, key, and BPM.

Zero external dependencies beyond numpy. Uses stdlib http.server.
"""

from __future__ import annotations

import json
import math
import os
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

NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
MAJOR_SCALE = (0, 2, 4, 5, 7, 9, 11)
NATURAL_MINOR_SCALE = (0, 2, 3, 5, 7, 8, 10)

# Chord templates (semitones from root). Order = tie-break preference.
CHORD_TEMPLATES = {
    "maj": (0, 4, 7),
    "min": (0, 3, 7),
    "7": (0, 4, 7, 10),
    "min7": (0, 3, 7, 10),
    "maj7": (0, 4, 7, 11),
    "dim": (0, 3, 6),
    "sus4": (0, 5, 7),
    "aug": (0, 4, 8),
}

def _build_chord_vectors():
    labels, vecs = [], []
    for root in range(12):
        for quality, intervals in CHORD_TEMPLATES.items():
            v = np.zeros(12, dtype=np.float32)
            for i in intervals:
                v[(root + i) % 12] = 1.0
            labels.append((root, quality))
            vecs.append(v / np.linalg.norm(v))
    return labels, np.stack(vecs)

_CHORD_LABELS, _CHORD_VECTORS = _build_chord_vectors()
_CHORD_VECTOR_BY_LABEL = {label: _CHORD_VECTORS[i] for i, label in enumerate(_CHORD_LABELS)}

def compute_flux_envelope(samples: np.ndarray, sr: int) -> tuple:
    """
    Spectral-flux onset envelope (sum of positive magnitude changes),
    1024-sample window at 512 hop (~86 fps at 44.1 kHz). Flux emphasises
    sharp onsets (kick/snare hits) far better than RMS energy, which is
    what tempo estimation needs.
    """
    n_fft = 1024
    hop = 512
    if len(samples) < n_fft * 2:
        return np.zeros(0, dtype=np.float64), float(sr) / hop

    n_frames = (len(samples) - n_fft) // hop + 1
    view = np.lib.stride_tricks.sliding_window_view(samples, n_fft)[::hop][:n_frames]
    hann = np.hanning(n_fft).astype(np.float32)

    flux = np.zeros(n_frames, dtype=np.float64)
    CHUNK = 512
    prev = None
    for start in range(0, n_frames, CHUNK):
        end = min(start + CHUNK, n_frames)
        block = np.abs(np.fft.rfft(
            np.asarray(view[start:end], dtype=np.float32) * hann, axis=1
        )).astype(np.float64)
        if prev is None:
            flux[start] = 0.0
        else:
            flux[start] = float(np.maximum(block[0] - prev, 0.0).sum())
        if end - start > 1:
            flux[start + 1:end] = np.maximum(np.diff(block, axis=0), 0.0).sum(axis=1)
        prev = block[-1]
    return flux, float(sr) / hop

def detect_bpm(samples: np.ndarray, sr: int) -> float:
    """
    BPM detection from the spectral-flux onset envelope:
      1. autocorrelation of the envelope (normalized per lag)
      2. comb scoring: S(lag) = ac(lag) + 0.5·ac(2·lag) + 0.5·ac(lag/2) —
         rewards lags whose own subdivisions and multiples are also
         periodic, which resolves 2/3-speed false beats
      3. mild log-Gaussian tempo prior centered at 120 BPM (σ = 0.85 octave)
      4. parabolic refinement on the comb score

    History: the original lag math collapsed and returned 120.0 for every
    track. A first fix (RMS envelope) then picked the wrong metrical level
    (consistently 3:2 vs reference BPMs); this version is verified against
    reference BPMs (Deezer/iTunes metadata) for the FL/Ween/Shellac test set.
    """
    flux, fps = compute_flux_envelope(samples, sr)
    if len(flux) < fps * 4 or float(np.max(flux)) <= 0.0:
        return 120.0

    env = flux - float(np.mean(flux))
    env = np.maximum(env, 0.0)
    n = len(env)

    min_lag = max(2, int(fps * 60 / 200))      # 200 BPM ceiling
    max_lag = min(n - 1, int(fps * 60 / 50))   # 50 BPM floor
    if max_lag - min_lag < 48:
        return 120.0

    autocorr = np.empty(max_lag + 1, dtype=np.float64)
    norms = np.maximum(n - np.arange(max_lag + 1), 1)
    for lag in range(max_lag + 1):
        autocorr[lag] = float(np.dot(env[: n - lag], env[lag:]) / norms[lag])
    ac = autocorr / max(float(np.max(autocorr[2:])), 1e-12)

    lags = np.arange(min_lag, max_lag + 1)
    sub = ac[np.maximum(lags // 2, 1)]
    dbl = np.zeros_like(lags, dtype=np.float64)
    valid2 = (lags * 2) <= max_lag
    dbl[valid2] = ac[lags[valid2] * 2]
    score = ac[lags] + 0.5 * dbl + 0.5 * sub

    bpms = 60.0 * fps / lags
    prior = np.exp(-0.5 * (np.log(bpms / 120.0) / 0.85) ** 2)
    score = score * prior

    idx = int(np.argmax(score))
    peak_lag = float(lags[idx])
    if 0 < idx < len(score) - 1:
        y0, y1, y2 = score[idx - 1], score[idx], score[idx + 1]
        denom = y0 - 2 * y1 + y2
        if denom != 0:
            peak_lag += float(np.clip(0.5 * (y0 - y2) / denom, -1.0, 1.0))

    return round(60.0 * fps / peak_lag, 1)

def compute_chroma_frames(samples: np.ndarray, sr: int) -> np.ndarray:
    """
    Per-frame 12-d chroma (L2-normalized), 4096-sample Hann window / 4096 hop.
    One batched FFT per 512-frame chunk keeps memory bounded for long tracks.
    """
    n_fft = 4096
    hop = 4096
    if len(samples) < n_fft:
        return np.zeros((0, 12), dtype=np.float32)

    freqs = np.fft.rfftfreq(n_fft, 1 / sr)
    valid = (freqs >= 75.0) & (freqs <= 4500.0)
    midi = np.round(69 + 12 * np.log2(np.maximum(freqs, 1e-9) / 440.0)).astype(np.int64)
    bin_pc = midi % 12

    n_frames = (len(samples) - n_fft) // hop + 1
    view = np.lib.stride_tricks.sliding_window_view(samples, n_fft)[::hop][:n_frames]
    hann = np.hanning(n_fft).astype(np.float32)

    chroma = np.zeros((n_frames, 12), dtype=np.float32)
    CHUNK = 512
    for start in range(0, n_frames, CHUNK):
        end = min(start + CHUNK, n_frames)
        block = np.asarray(view[start:end], dtype=np.float32) * hann
        spec = np.abs(np.fft.rfft(block, axis=1))
        spec[:, ~valid] = 0.0
        for pc in range(12):
            cols = bin_pc == pc
            if np.any(cols):
                chroma[start:end, pc] = spec[:, cols].sum(axis=1)

    norms = np.linalg.norm(chroma, axis=1, keepdims=True)
    norms[norms == 0.0] = 1.0
    return chroma / norms

def match_chord(chroma_vec: np.ndarray) -> tuple:
    """Best (score, root_pc, quality) for a 12-d chroma vector (cosine-style)."""
    norm = float(np.linalg.norm(chroma_vec))
    if norm <= 0.0:
        return 0.0, 0, "maj"
    scores = _CHORD_VECTORS @ (chroma_vec / norm)
    idx = int(np.argmax(scores))
    root, quality = _CHORD_LABELS[idx]
    return float(scores[idx]), root, quality

def roman_numeral_for(root_pc: int, quality: str, key_pc: int, mode: str) -> str:
    """Roman numeral relative to the song key (flats/sharps for chromatic roots)."""
    scale = NATURAL_MINOR_SCALE if mode == "minor" else MAJOR_SCALE
    names = ["I", "II", "III", "IV", "V", "VI", "VII"]
    rel = (root_pc - key_pc) % 12
    prefix = ""
    if rel in scale:
        numeral = names[scale.index(rel)]
    else:
        numeral = NOTE_NAMES[root_pc]
        for idx, semi in enumerate(scale):
            if (rel - semi) % 12 == 1:
                prefix, numeral = "b", names[idx]
                break
            if (semi - rel) % 12 == 1:
                prefix, numeral = "#", names[idx]
                break
    if quality in ("min", "min7", "dim"):
        numeral = numeral.lower()
    if quality == "dim":
        numeral += "°"
    elif quality in ("7", "min7", "maj7"):
        numeral += "7"
    return prefix + numeral

def detect_key(chroma_frames: np.ndarray) -> dict:
    """Key detection via average chroma + Krumhansl-Kessler profiles."""
    if len(chroma_frames) == 0:
        return {"key": "C", "mode": "major", "confidence": 0.0}

    # Sample frames across the WHOLE track (the old code only looked at the
    # first ~2.3 s, which let intros dominate the result).
    stride = max(1, len(chroma_frames) // 3000)
    chroma = chroma_frames[::stride].mean(axis=0).astype(np.float64)

    total = chroma.sum()
    if total > 0:
        chroma = chroma / total

    major_profile = np.array([6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88])
    minor_profile = np.array([6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17])

    candidates = []
    for root in range(12):
        rotated = np.roll(chroma, -root)
        candidates.append((
            float(np.dot(rotated, major_profile) / major_profile.sum()),
            NOTE_NAMES[root], "major",
        ))
        candidates.append((
            float(np.dot(rotated, minor_profile) / minor_profile.sum()),
            NOTE_NAMES[root], "minor",
        ))
    candidates.sort(key=lambda c: c[0], reverse=True)

    best_score, best_key, best_mode = candidates[0]
    runner_up = candidates[1][0] if len(candidates) > 1 else 0.0
    # Relative gap between winner and runner-up, scaled to a 0–1 confidence.
    confidence = round(min(1.0, max(0.0, (best_score - runner_up) * 20.0)), 3)
    return {"key": best_key, "mode": best_mode, "confidence": confidence}

def analyze_audio(samples: np.ndarray, sr: int) -> dict:
    """
    Full analysis: BPM, key, segments, chords.
    Chord objects match TrackDraft's expected shape:
      {id, romanNumeral, root: NoteName, quality, beats}

    Chords are REAL chroma-template matches per segment. (The previous build
    emitted a canned I-V-vi-IV pattern transposed to the detected key —
    discovered during the 2026-09-20 ingestion audit.)
    """
    bpm = detect_bpm(samples, sr)
    chroma_frames = compute_chroma_frames(samples, sr)
    key_info = detect_key(chroma_frames)

    beat_duration = 60.0 / bpm if bpm > 0 else 0.5
    segment_duration = beat_duration * 2.0
    total_duration = len(samples) / sr
    num_segments = max(1, int(math.ceil(total_duration / segment_duration)))

    frames_per_sec = sr / 4096.0
    key_pc = NOTE_NAMES.index(key_info["key"])

    segments = []
    chords = []
    prev_label = None

    for i in range(num_segments):
        start_time = i * segment_duration
        end_time = min((i + 1) * segment_duration, total_duration)
        seg_start = int(start_time * sr)
        seg_end = int(end_time * sr)
        if seg_end <= seg_start:
            continue

        segments.append({
            "start": round(start_time, 3),
            "end": round(end_time, 3),
            "loudness": round(float(np.sqrt(np.mean(samples[seg_start:seg_end] ** 2))), 4),
        })

        if len(chroma_frames) > 0:
            f0 = min(int(start_time * frames_per_sec), len(chroma_frames) - 1)
            f1 = min(max(f0 + 1, int(end_time * frames_per_sec)), len(chroma_frames))
            vec = chroma_frames[f0:f1].mean(axis=0)
        else:
            vec = np.zeros(12, dtype=np.float32)

        vnorm = float(np.linalg.norm(vec))
        unit = vec / vnorm if vnorm > 0.0 else vec
        score, root, quality = match_chord(unit)

        # Hysteresis: hold the previous chord unless this segment's best
        # candidate clearly outscores the previous chord on this segment's
        # own chroma (kills single-segment chord flicker).
        if prev_label is not None and (root, quality) != prev_label:
            keep_score = float(np.dot(unit, _CHORD_VECTOR_BY_LABEL[prev_label]))
            if score < keep_score * 1.04:
                root, quality = prev_label

        prev_label = (root, quality)
        chords.append({
            "id": str(uuid.uuid4()),
            "romanNumeral": roman_numeral_for(root, quality, key_pc, key_info["mode"]),
            "root": NOTE_NAMES[root],
            "quality": quality,
            "beats": round(segment_duration * bpm / 60.0, 1),
        })

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

def extract_multipart_file(body: bytes, content_type: str) -> bytes | None:
    """
    Extract the audio file part from a multipart/form-data body.
    Prefers a part named "audio"; falls back to the first non-empty part.
    (The CLI bridge sends multipart; the browser flow sends raw bytes.)
    """
    marker = "boundary="
    idx = content_type.find(marker)
    if idx < 0:
        return None
    boundary = content_type[idx + len(marker):].split(";")[0].strip().strip('"')
    if not boundary:
        return None

    delimiter = b"--" + boundary.encode()
    cursor = body.find(delimiter)
    first_part = None
    while cursor != -1:
        header_end = body.find(b"\r\n\r\n", cursor)
        if header_end == -1:
            break
        part_start = header_end + 4
        next_delim = body.find(b"\r\n" + delimiter, part_start)
        part_end = next_delim if next_delim != -1 else len(body)
        headers = body[cursor:header_end]
        part = body[part_start:part_end]
        if b'name="audio"' in headers:
            return part
        if first_part is None and part:
            first_part = part
        if next_delim == -1:
            break
        cursor = next_delim + 2
    return first_part

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

        # Accept both transports: raw audio bytes (browser flow) and
        # multipart/form-data with an "audio" field (CLI bridge). Decoding the
        # multipart wrapper as audio previously skewed BPM detection.
        content_type = self.headers.get("Content-Type", "") or ""
        if content_type.lower().startswith("multipart/form-data"):
            extracted = extract_multipart_file(raw, content_type)
            if not extracted:
                self._json_resp(400, {"error": "Malformed multipart body — no audio part found"})
                return
            raw = extracted

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
    port = int(os.environ.get("PORT", "5000"))
    server = HTTPServer(("0.0.0.0", port), ChordMiniHandler)
    print(f"🎵 ChordMiniApp starting on http://localhost:{port}")
    print(f"   Endpoints: POST /analyze  GET /health")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n👋 Shutting down…")
        server.shutdown()