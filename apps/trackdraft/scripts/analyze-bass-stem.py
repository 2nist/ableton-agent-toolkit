#!/usr/bin/env python3
"""
analyze-bass-stem.py — "big picture" bass profile for TrackDraft.

Captures the IDEA of the bass part, not a transcription:
  - register:    low rumble vs high on the neck
  - intensity:   how hard they play (relative level, dynamics range)
  - rhythm:      notes per bar, note-length character (pumping vs sustained)
  - function:    root / fifth / third / other-scale / chromatic share
  - movement:    same-note repeats vs intervals (pedal vs walking)

Bass stems are effectively monophonic, so per-frame spectral-peak f0 tracking
+ note segmentation is quick and robust. numpy only, same env as the other
analyzers.

Usage:
  <env-python> scripts/analyze-bass-stem.py <bass.wav> --bpm 141.2 \
      [--blueprint <song.trackdraft.json>] [--out <profile.json>]
"""

import argparse
import json
import wave

import numpy as np

NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
MAJOR_SCALE = (0, 2, 4, 5, 7, 9, 11)
NATURAL_MINOR_SCALE = (0, 2, 3, 5, 7, 8, 10)

def load_wav_mono(path):
    w = wave.open(path, "rb")
    sr, ch, sw = w.getframerate(), w.getnchannels(), w.getsampwidth()
    data = w.readframes(w.getnframes())
    w.close()
    if sw != 2:
        raise SystemExit("expect 16-bit PCM wav")
    a = np.frombuffer(data, dtype=np.int16).astype(np.float32) / 32768.0
    if ch > 1:
        a = a.reshape(-1, ch).mean(axis=1)
    return a, sr

def stft_mag(x, n_fft=4096, hop=1024):
    n = (len(x) - n_fft) // hop + 1
    view = np.lib.stride_tricks.sliding_window_view(x, n_fft)[::hop][:n]
    hann = np.hanning(n_fft).astype(np.float32)
    out = np.empty((n, n_fft // 2 + 1), dtype=np.float32)
    for s in range(0, n, 256):
        e = min(s + 256, n)
        out[s:e] = np.abs(np.fft.rfft(np.asarray(view[s:e]) * hann, axis=1))
    return out

def pname(midi):
    return NOTE_NAMES[midi % 12] + str(midi // 12 - 1)

def track_f0(spec, freqs):
    """
    Per-frame fundamental via parabolic peak interpolation in 35-420 Hz
    (bass range up to ~G#4). Returns (f0_hz, activity_env).
    """
    cols = (freqs >= 35.0) & (freqs <= 420.0)
    band = spec[:, cols].astype(np.float64)
    bfreqs = freqs[cols]
    env = band.sum(axis=1)
    peak = np.argmax(band, axis=1)
    k = len(bfreqs)
    left = np.maximum(peak - 1, 0)
    right = np.minimum(peak + 1, k - 1)
    rows = np.arange(len(band))
    y0, y1, y2 = band[rows, left], band[rows, peak], band[rows, right]
    denom = y0 - 2.0 * y1 + y2
    shift = np.where(np.abs(denom) > 1e-12, 0.5 * (y0 - y2) / denom, 0.0)
    shift = np.clip(shift, -0.5, 0.5)
    df = float(bfreqs[1] - bfreqs[0]) if k > 1 else 0.0
    return bfreqs[peak] + shift * df, env

def segment_notes(f0, env, fps, min_dur=0.06, jump_tol=0.06):
    floor = float(np.percentile(env, 5))
    p90 = float(np.percentile(env, 90))
    thr = floor + 0.15 * (p90 - floor)
    active = env > thr
    notes = []
    i, n = 0, len(f0)
    while i < n:
        if not active[i]:
            i += 1
            continue
        j = i
        fs = [f0[i]]
        med = f0[i]
        while j + 1 < n and active[j + 1]:
            cand = f0[j + 1]
            if med > 0 and abs(cand - med) / med > jump_tol:
                break
            fs.append(cand)
            med = float(np.median(fs))
            j += 1
        dur = (j - i + 1) / fps
        if dur >= min_dur and med > 0:
            notes.append({
                "start": i / fps,
                "dur": dur,
                "f0": med,
                "midi": int(round(69 + 12 * np.log2(med / 440.0))),
                "level": float(np.sqrt(np.mean(env[i:j + 1] ** 2))),
            })
        i = j + 1
    return notes

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("wav")
    ap.add_argument("--bpm", type=float, required=True)
    ap.add_argument("--blueprint")
    ap.add_argument("--out")
    args = ap.parse_args()

    x, sr = load_wav_mono(args.wav)
    dur = len(x) / sr
    spec = stft_mag(x)
    freqs = np.fft.rfftfreq(4096, 1 / sr)
    fps = sr / 1024.0

    bpm = args.bpm
    key_name = "A"
    scale_name = "ionian"
    sections = []
    if args.blueprint:
        bp = json.load(open(args.blueprint))
        bpm = bp.get("bpm") or bpm
        key_name = bp.get("key") or "A"
        scale_name = bp.get("scale") or "ionian"
        sec_per_bar = (60.0 / bpm) * 4.0
        bar = 0
        for s in bp["sections"]:
            t0 = bar * sec_per_bar
            bar += s["bars"]
            sections.append((s["name"], t0, min(bar * sec_per_bar, dur)))
    else:
        sections.append(("Full", 0.0, dur))

    f0, env = track_f0(spec, freqs)
    notes = segment_notes(f0, env, fps)
    total_bars = dur / ((60.0 / bpm) * 4.0)
    sec_per_beat = 60.0 / bpm

    root_pc = NOTE_NAMES.index(key_name)
    scale = NATURAL_MINOR_SCALE if scale_name == "aeolian" else MAJOR_SCALE
    third_pc = (root_pc + (3 if scale_name == "aeolian" else 4)) % 12
    fifth_pc = (root_pc + 7) % 12
    diatonic = set((root_pc + s) % 12 for s in scale)

    def profile(sel, bars=None):
        if not sel:
            return None
        span_bars = bars if bars else total_bars
        durs = np.array([n["dur"] for n in sel])
        midis = np.array([n["midi"] for n in sel])
        levels = np.array([n["level"] for n in sel])
        pc_w = np.zeros(12)
        for n, d in zip(sel, durs):
            pc_w[n["midi"] % 12] += d
        tot_w = pc_w.sum() or 1.0
        pc = pc_w / tot_w
        beats = [(d / sec_per_beat) for d in durs]
        pcs = np.full(12, 0.0)
        pcs[:] = pc
        same_repeat = 0
        intervals = []
        for a, b in zip(sel, sel[1:]):
            iv = b["midi"] - a["midi"]
            intervals.append(abs(iv))
            if iv == 0:
                same_repeat += 1
        return {
            "notes": len(sel),
            "notes_per_bar": round(len(sel) / max(span_bars, 0.25), 2),
            "register_min": pname(int(midis.min())),
            "register_med": pname(int(np.median(midis))),
            "register_max": pname(int(midis.max())),
            "low_share_pct": round(100 * float(np.mean(midis <= 43)), 0),  # <= G2
            "level_med_db": round(float(20 * np.log10(np.median(levels) + 1e-9)), 1),
            "dynamics_range_db": round(float(20 * np.log10((np.percentile(levels, 90) + 1e-9) / (np.percentile(levels, 10) + 1e-9))), 1),
            "beats_short_pct": round(100 * float(np.mean(np.array(beats) < 0.3)), 0),
            "beats_medium_pct": round(100 * float(np.mean((np.array(beats) >= 0.3) & (np.array(beats) < 1.0))), 0),
            "beats_long_pct": round(100 * float(np.mean(np.array(beats) >= 1.0)), 0),
            "root_pct": round(100 * float(pc[root_pc]), 0),
            "fifth_pct": round(100 * float(pc[fifth_pc]), 0),
            "third_pct": round(100 * float(pc[third_pc]), 0),
            "other_scale_pct": round(100 * float(sum(pc[(root_pc + s) % 12] for s in scale) - pc[root_pc] - pc[third_pc] - pc[fifth_pc]), 0),
            "chromatic_pct": round(100 * float(sum(v for i, v in enumerate(pc) if i not in diatonic)), 0),
            "same_repeat_pct": round(100 * same_repeat / max(1, len(sel) - 1), 0),
            "median_interval_st": int(np.median(intervals)) if intervals else 0,
            "pc_histogram": [round(float(v), 3) for v in pc],
        }

    prof_all = profile(notes)
    report = {
        "wav": args.wav, "bpm": bpm, "durationSec": round(dur, 1),
        "bars": round(total_bars, 1), "key": f"{key_name} {scale_name}",
        "overall": prof_all, "sections": [],
    }
    for (name, t0, t1) in sections:
        sel = [n for n in notes if t0 <= n["start"] < t1]
        p = profile(sel, (t1 - t0) / sec_per_bar)
        if p is None:
            continue
        p["name"] = name
        p["startSec"] = round(t0, 1)
        report["sections"].append(p)

    o = prof_all
    print(f"\n=== BASS PROFILE: {args.wav.split('/')[-1]} ===")
    print(f"BPM {bpm} | {total_bars:.0f} bars | key {key_name} {scale_name}")
    print(f"  register:  {o['register_min']} … {o['register_med']} … {o['register_max']}"
          f"   (low ≤G2: {o['low_share_pct']}%)")
    print(f"  rhythm:    {o['notes_per_bar']} notes/bar | lengths:"
          f" short {o['beats_short_pct']}% / medium {o['beats_medium_pct']}% / long {o['beats_long_pct']}%")
    print(f"  function:  root {o['root_pct']}%  fifth {o['fifth_pct']}%  third {o['third_pct']}%"
          f"  other-scale {o['other_scale_pct']}%  chromatic {o['chromatic_pct']}%")
    top = sorted(enumerate(o["pc_histogram"]), key=lambda kv: -kv[1])[:4]
    print("  top tones: " + "  ".join(f"{NOTE_NAMES[i]} {round(100 * v):.0f}%" for i, v in top))
    print(f"  movement:  repeats {o['same_repeat_pct']}% | median interval {o['median_interval_st']} st")
    print(f"  intensity: dynamics range {o['dynamics_range_db']} dB"
          f" ({'steady' if o['dynamics_range_db'] < 6 else 'dynamic'})")
    print("\nPER SECTION:")
    for s in report["sections"]:
        print(f"  {s['name'][:14]:14s} {s['notes_per_bar']:5.2f} n/bar  reg {s['register_med']:>4s}"
              f"  root {s['root_pct']:3.0f}% fifth {s['fifth_pct']:3.0f}%"
              f"  short {s['beats_short_pct']:3.0f}%  lvl {s['level_med_db']:5.1f} rel-dB")

    if args.out:
        with open(args.out, "w") as f:
            json.dump(report, f, indent=1)
        print(f"\n✅ Written: {args.out}")

if __name__ == "__main__":
    main()
