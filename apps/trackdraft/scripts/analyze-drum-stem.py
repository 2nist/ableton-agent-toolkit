#!/usr/bin/env python3
"""
analyze-drum-stem.py — quick "ground truth" profile for a drum stem.

Extracts per-band onset patterns (kick / snare / hats) from an isolated drum
stem, aligns them to a 16th-note grid at a known BPM (sub-cell phase search),
fits Euclidean rhythm families E(k, 16), and reports energy / density /
backbeat / fill stats per section. This is the pass that gives the generated
patterns "providence" — real numbers from the recording instead of guesses.

Usage:
  <env-python> scripts/analyze-drum-stem.py <drums.wav> --bpm 141.2 \
      [--blueprint <song.trackdraft.json>] [--out <profile.json>]

Env: runs on the chord-extractor-env python (numpy only, no scipy).
"""

import argparse
import json
import wave

import numpy as np

# ---------------------------------------------------------------------------
# IO + STFT
# ---------------------------------------------------------------------------

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

def stft_mag(x, n_fft=1024, hop=512):
    n = (len(x) - n_fft) // hop + 1
    view = np.lib.stride_tricks.sliding_window_view(x, n_fft)[::hop][:n]
    hann = np.hanning(n_fft).astype(np.float32)
    out = np.empty((n, n_fft // 2 + 1), dtype=np.float32)
    for s in range(0, n, 512):
        e = min(s + 512, n)
        out[s:e] = np.abs(np.fft.rfft(np.asarray(view[s:e]) * hann, axis=1))
    return out

# ---------------------------------------------------------------------------
# Band onsets
# ---------------------------------------------------------------------------

def band_energy(spec, freqs, subbands):
    """Summed magnitude within one or more frequency sub-bands (per frame)."""
    env = np.zeros(len(spec), dtype=np.float64)
    for (lo, hi) in subbands:
        cols = (freqs >= lo) & (freqs <= hi)
        env += spec[:, cols].sum(axis=1)
    return env

def groove_periodicity(env, fps, bpm):
    """
    Envelope autocorrelation at musical lags — the phase-free "is there a
    groove at this metrical level" test. Snare strong at 2-beat = backbeat;
    hats strong at beat = steady ride/hats; kick strong at 2-bar = phrase
    pattern. Robust where per-cell grids smear on noisy stems.
    """
    e = env - np.mean(env)
    e = e / (np.sqrt(np.mean(e ** 2)) or 1.0)
    ac = np.correlate(e, e, mode="full")[len(e) - 1:]
    ac = ac / (ac[0] or 1.0)
    beat = fps * 60.0 / bpm
    out = {}
    for mult, tag in ((0.5, "eighth"), (1.0, "beat"), (1.5, "dotted"),
                      (2.0, "twoBeat"), (4.0, "bar"), (8.0, "twoBar")):
        lag = int(round(beat * mult))
        out[tag] = round(float(ac[lag]) if lag < len(ac) else 0.0, 2)
    return out

BANDS = {
    "kick":  [(35, 110)],
    "snare": [(140, 400), (1800, 5200)],
    "hat":   [(6500, 13000)],
}

# ---------------------------------------------------------------------------
# Grid alignment + Euclidean fitting
# ---------------------------------------------------------------------------

def global_phase_and_rotation(envs, fps, bpm, search_end=90.0):
    """
    16th-grid sub-cell phase from the first `search_end` seconds (kick+snare
    energy concentration), and a bar rotation convention that reads a 2&4
    backbeat as cells 4/12 when one exists (tie-break kick at cell 0).
    """
    cell = (60.0 / bpm) / 4.0
    bar = cell * 16.0
    n = min(len(envs["kick"]), int(search_end * fps))
    t = np.arange(n) / fps
    pos = (t % bar) / cell
    k = envs["kick"][:n]
    s = envs["snare"][:n]
    combo = k / (np.max(k) or 1.0) + s / (np.max(s) or 1.0)
    best_phi, best_score = 0.0, -1.0
    for phi in np.linspace(0.0, 1.0, 33)[:-1]:
        idx = np.floor((pos - phi) % 16).astype(int)
        sums = np.bincount(idx, weights=combo, minlength=16)
        sc = float(np.sum(sums ** 2))
        if sc > best_score:
            best_score, best_phi = sc, float(phi)
    idx = np.floor((pos - best_phi) % 16).astype(int)
    ksums = np.bincount(idx, weights=k, minlength=16)
    ssums = np.bincount(idx, weights=s, minlength=16)
    best = None
    for r in (0, 4, 8, 12):
        s2 = np.roll(ssums, -r)
        k2 = np.roll(ksums, -r)
        key = (float(s2[4] + s2[12]), float(k2[0]))
        if best is None or key > best[0]:
            best = (key, r)
    return best_phi, int(best[1])

def frame_cells(bpm, fps, n_frames, phi0, rot, focus_env, chunk_bars=8):
    """
    Per-frame 16th-cell index (0-15) for the whole track. The grid phase is
    re-fit per 8-bar chunk (±0.75 cell around the running phase) to absorb
    small BPM drift; the rotation stays fixed so spans stay comparable.
    """
    cell = (60.0 / bpm) / 4.0
    bar = cell * 16.0
    cells = np.zeros(n_frames, dtype=np.int64)
    if n_frames == 0:
        return cells
    t = np.arange(n_frames) / fps
    chunk = chunk_bars * bar
    phi = float(phi0)
    n_chunks = int(t[-1] / chunk) + 1
    for ci in range(n_chunks):
        c0, c1 = ci * chunk, (ci + 1) * chunk
        sel = (t >= c0) & (t < c1)
        if not np.any(sel):
            continue
        pos = (t[sel] % bar) / cell
        e = focus_env[sel]
        best_sc, best_phi = -1.0, phi
        for cand in np.linspace(phi - 0.75, phi + 0.75, 25):
            idx = np.floor((pos - cand) % 16).astype(int)
            sums = np.bincount(idx, weights=e, minlength=16)
            tot = float(np.sum(sums)) or 1.0
            sc = float(np.sum((sums / tot) ** 2))
            if sc > best_sc:
                best_sc, best_phi = sc, float(cand)
        phi = best_phi
        idx = (np.floor((pos - phi) % 16).astype(int) - rot) % 16
        cells[sel] = idx
    return cells

def euclid(k, n=16):
    return sorted(set((i * n) // k for i in range(k)))

def fit_euclid(binary):
    """Best match among E(k,16) with free rotation. Returns (matches, k, rot)."""
    best = (int(np.sum(binary)), None, None)
    for k in range(2, 9):
        e = np.zeros(16)
        e[euclid(k)] = 1
        for r in range(16):
            m = int(np.sum(binary == np.roll(e, r)))
            if m > best[0]:
                best = (m, k, r)
    return best

def grid16(counts, bars):
    """Normalized 16-cell display: 0-9, scaled to the span's busiest cell."""
    per = [float(v) / max(bars, 0.25) for v in counts]
    mx = max(per) if len(per) else 0.0
    if mx <= 0:
        return "." * 16
    out = []
    for v in per:
        if v <= 0.02 * mx:
            out.append(".")
        else:
            out.append(str(int(min(9, max(1, round(9 * v / mx))))))
    return "".join(out)

def bar_of(cell_str):
    """Insert a bar separator after every 4 cells."""
    return " ".join(cell_str[i:i + 4] for i in range(0, 16, 4))

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

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
    freqs = np.fft.rfftfreq(1024, 1 / sr)
    fps = sr / 512.0

    envs = {}
    for name, subbands in BANDS.items():
        envs[name] = band_energy(spec, freqs, subbands)

    bpm = args.bpm
    sec_per_bar = (60.0 / bpm) * 4.0

    # Sections from the blueprint, or one global block
    sections = []
    if args.blueprint:
        bp = json.load(open(args.blueprint))
        bpm = bp.get("bpm") or bpm
        sec_per_bar = (60.0 / bpm) * 4.0
        bar = 0
        for s in bp["sections"]:
            start = bar * sec_per_bar
            bar += s["bars"]
            sections.append((s["name"], start, bar * sec_per_bar, bar * sec_per_bar - start))
    else:
        sections.append(("Full", 0.0, dur, dur))

    # Track-global grid: sub-cell phase (first 90s, kick+snare energy) +
    # backbeat-anchored rotation; per-frame cell assignment follows drift.
    phi, rot = global_phase_and_rotation(envs, fps, bpm, search_end=90.0)
    kmax = float(np.max(envs["kick"])) or 1.0
    smax = float(np.max(envs["snare"])) or 1.0
    focus = envs["kick"] / kmax + envs["snare"] / smax
    cells_all = frame_cells(bpm, fps, len(spec), phi, rot, focus)

    report = {
        "wav": args.wav,
        "bpm": bpm,
        "durationSec": round(dur, 1),
        "totalBars": round(dur / sec_per_bar, 1),
        "sections": [],
        "global": {},
        "gridPhaseCell": round(phi, 3),
        "gridRotation": rot,
    }

    # Global aggregate (sum of locally aligned section grids)
    gtot = {k: np.zeros(16) for k in BANDS}

    for (name, t0, t1, dsec) in sections:
        t1e = min(t1, dur)
        sec_report = {"name": name, "startSec": round(t0, 2), "bars": round((t1e - t0) / sec_per_bar, 2)}
        seg = x[int(t0 * sr):int(t1e * sr)]
        sec_report["energyDb"] = round(20 * np.log10(float(np.sqrt(np.mean(seg ** 2))) + 1e-9), 1)

        sec_bars = max(0.25, (t1e - t0) / sec_per_bar)
        i0 = max(0, min(len(spec) - 1, int(t0 * fps)))
        i1 = min(len(spec), max(i0 + 1, int(t1e * fps)))
        cell_idx = cells_all[i0:i1]
        for band, env in envs.items():
            seg_env = env[i0:i1]
            v = np.bincount(cell_idx, weights=seg_env, minlength=16).astype(np.float64) / sec_bars
            vmax = float(np.max(v)) or 1.0
            sec_report[f"{band}_grid"] = grid16(v, 1.0)
            sec_report[f"{band}_energy16"] = [round(float(q / vmax), 3) for q in v]
            sec_report[f"{band}_share_pct"] = round(100 * float(np.sum(seg_env)) / max(float(np.sum(spec[i0:i1])), 1e-9), 1)
            sec_report[f"{band}_spread"] = int(np.sum(v > 0.35 * vmax))
            if band == "snare":
                tot = float(np.sum(v)) or 1.0
                sec_report["backbeat_index"] = round((v[4] + v[12]) / (tot / 8.0), 2)
                sec_report["on13_index"] = round((v[0] + v[8]) / (tot / 8.0), 2)
            if band in ("kick", "snare"):
                m, k, r = fit_euclid((v > 0.5 * vmax).astype(int))
                sec_report[f"{band}_euclid"] = f"E({k},16) r{r}" if k else "n/a"
                sec_report[f"{band}_euclid_match"] = round(100 * m / 16)

        # Fill ratio: last full bar of drum activity vs the section mean
        last_start_i = max(i0, int((t1e - sec_per_bar) * fps))
        e_last = float(np.sum(focus[last_start_i:i1]))
        e_span = float(np.sum(focus[i0:i1]))
        sec_report["fill_ratio"] = round(e_last / max(e_span / sec_bars, 1e-9), 2)
        report["sections"].append(sec_report)

    # Global patterns (same grid convention, whole track)
    for band, env in envs.items():
        v = np.bincount(cells_all, weights=env, minlength=16).astype(np.float64)
        v = v / max(1.0, dur / sec_per_bar)
        tot = float(np.sum(v)) or 1.0
        vmax = float(np.max(v)) or 1.0
        entry = {
            "grid": grid16(v, 1.0),
            "energy16": [round(float(q / vmax), 3) for q in v],
            "share_pct": round(100 * float(np.sum(env)) / max(float(np.sum(spec)), 1e-9), 1),
            "periodicity": groove_periodicity(env, fps, bpm),
        }
        if band in ("kick", "snare"):
            m, k, r = fit_euclid((v > 0.5 * vmax).astype(int))
            entry["euclid"] = f"E({k},16) r{r}" if k else "n/a"
            entry["euclid_match"] = round(100 * m / 16)
        if band == "snare":
            entry["backbeat_index"] = round((v[4] + v[12]) / (tot / 8.0), 2)
            entry["on13_index"] = round((v[0] + v[8]) / (tot / 8.0), 2)
        report["global"][band] = entry

    print(f"\n=== DRUM STEM PROFILE: {args.wav.split('/')[-1]} ===")
    print(f"BPM {bpm} | {dur:.0f}s | {dur/sec_per_bar:.0f} bars | sections: {len(sections)} | grid phase {phi:+.2f} cell, rot {rot}")
    print("\nGLOBAL PATTERNS (16th grid, 4/4 — 0-9 = energy level vs busiest cell):")
    for band in ("kick", "snare", "hat"):
        e = report["global"][band]
        extra = f"   share {e['share_pct']}%"
        if "euclid" in e:
            extra += f"   {e['euclid']} match {e['euclid_match']}%"
        if band == "snare":
            extra += (f"   2&4 x{e['backbeat_index']} / 1&3 x{e.get('on13_index', 0)}"
                      f"  (1.0 = even)")
        print(f"  {band:5s} {bar_of(e['grid'])}{extra}")
        p = e.get("periodicity", {})
        if p:
            print(f"        periodicity:  8th {p['eighth']:+.2f}  beat {p['beat']:+.2f}"
                  f"  2-beat {p['twoBeat']:+.2f}  bar {p['bar']:+.2f}  2-bar {p['twoBar']:+.2f}")

    print("\nPER SECTION:")
    print(f"  {'section':16s} {'dB':>6s} {'kick%':>6s} {'snare%':>6s} {'bb x':>5s} {'fill':>4s}   kick grid          snare grid")
    for s in report["sections"]:
        print(f"  {s['name'][:16]:16s} {s['energyDb']:6.1f} {s['kick_share_pct']:6.1f} {s['snare_share_pct']:6.1f} "
              f"{s.get('backbeat_index', 0):5.2f} {s['fill_ratio']:4.2f}   {bar_of(s['kick_grid'])}  {bar_of(s['snare_grid'])}")

    if args.out:
        with open(args.out, "w") as f:
            json.dump(report, f, indent=1)
        print(f"\n✅ Written: {args.out}")

if __name__ == "__main__":
    main()
