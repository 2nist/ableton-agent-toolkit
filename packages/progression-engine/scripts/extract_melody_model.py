#!/usr/bin/env python3
"""Extract a melody-over-progression model from the Tegridy/LA general-MIDI corpus.

The source is `/Users/Matthew/Tegridy-MIDI-Dataset-master/Chords-Progressions/
pitches_chords_progressions.jsonl`: every line is a chord progression where each
chord is a list of simultaneous MIDI pitches (a full voicing). The top voice of
each chord is the melody note. Unlike the pop lead-sheet corpus, this is general
music (no genre restriction), so it fits "a general melody that goes with a
progression".

For every chord we:
  1. classify (root pc, quality) by exhaustive root search against the
     @music-theory chord templates (root-position preference as tiebreak),
  2. record the melody note as an INTERVAL above the root (0..11) — transposable,
  3. record the melody register (semitones above the chord's root pitch),
  4. build a 1st-order Markov on melody intervals across chord changes.

Writes `../data/melody_model.json`.

Run:  python3 scripts/extract_melody_model.py  [max_lines]
"""
import json
import os
import sys
import time
from collections import Counter

SRC = "/Users/Matthew/Tegridy-MIDI-Dataset-master/Chords-Progressions/pitches_chords_progressions.jsonl"
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data")

# Chord templates: quality -> semitone intervals above root (matches CHORD_TYPES
# in @music-theory/core).
TEMPLATES = {
    "maj": [0, 4, 7],
    "min": [0, 3, 7],
    "7": [0, 4, 7, 10],
    "maj7": [0, 4, 7, 11],
    "m7": [0, 3, 7, 10],
    "m7b5": [0, 3, 6, 10],
    "sus2": [0, 2, 7],
    "sus4": [0, 5, 7],
    "dim": [0, 3, 6],
    "aug": [0, 4, 8],
}
MIN_MATCH = 3  # require a real chord (>=3 template tones present)


def classify(pcs, bass_pc):
    """Best (root_pc, quality) for a pitch-class set via exhaustive root search.

    Score favors chords whose template tones are all present, penalizes extra
    (non-chord) tones, and prefers the bass note as the root (root position).
    Returns None when no template matches >= MIN_MATCH tones.
    """
    pcs = set(pcs)
    best = None
    for root in range(12):
        for quality, intervals in TEMPLATES.items():
            matched = sum(1 for iv in intervals if (root + iv) % 12 in pcs)
            if matched < MIN_MATCH:
                continue
            extra = len([pc for pc in pcs if (pc - root) % 12 not in intervals])
            bass_penalty = 0 if bass_pc == root else 1
            score = matched * 10 - extra - bass_penalty
            # Prefer chords with all template tones matched.
            score += (1 if matched == len(intervals) else 0) * 100
            cand = (score, root, quality)
            if best is None or cand[0] > best[0]:
                best = cand
    if best is None:
        return None
    return best[1], best[2]


def main():
    max_lines = int(sys.argv[1]) if len(sys.argv) > 1 else 400_000
    if not os.path.exists(SRC):
        print(f"missing source: {SRC}")
        return

    # melodyIntervals[quality][iv] = count
    melody_intervals = {q: [0] * 12 for q in TEMPLATES}
    # intervalTransitions[prev_iv][next_iv] = count
    transitions = {str(p): [0] * 12 for p in range(12)}
    # register[quality][height] = count (semitones above chord root pitch, capped)
    register = {q: Counter() for q in TEMPLATES}
    total_chords = 0
    total_melody = 0
    classified = 0
    prev_iv = None

    t0 = time.time()
    with open(SRC, "r") as fh:
        for i, line in enumerate(fh):
            if i >= max_lines:
                break
            line = line.strip()
            if not line:
                continue
            try:
                chunks = json.loads(line)
            except Exception:
                continue
            prev_iv = None
            for chunk in chunks:
                if not chunk:
                    continue
                total_chords += 1
                pcs = sorted(set(p % 12 for p in chunk))
                if len(pcs) < 3:
                    continue
                bass_pc = min(p % 12 for p in chunk)
                cls = classify(pcs, bass_pc)
                if cls is None:
                    continue
                root, quality = cls
                classified += 1

                top = max(chunk)
                iv = (top - root) % 12
                melody_intervals[quality][iv] += 1
                total_melody += 1

                # register: melody pitch minus chord root pitch (nearest root pc below)
                root_pitch = min((p for p in chunk if p % 12 == root), default=min(chunk))
                height = top - root_pitch
                register[quality][min(height, 36)] += 1

                if prev_iv is not None:
                    transitions[str(prev_iv)][iv] += 1
                prev_iv = iv

    # median height per quality (semitones above root pitch)
    register_mode = {}
    for q, c in register.items():
        if not c:
            register_mode[q] = 24
            continue
        total = sum(c.values())
        half = total / 2
        acc = 0
        med = 24
        for h in sorted(c):
            acc += c[h]
            if acc >= half:
                med = h
                break
        register_mode[q] = med

    model = {
        "qualities": list(TEMPLATES.keys()),
        "melodyIntervals": melody_intervals,
        "intervalTransitions": transitions,
        "registerMode": register_mode,
        "totalChords": total_chords,
        "totalMelody": total_melody,
        "classified": classified,
        "source": "pitches_chords_progressions.jsonl (Tegridy/LA general MIDI)",
    }

    os.makedirs(OUT, exist_ok=True)
    out = os.path.join(OUT, "melody_model.json")
    with open(out, "w") as fh:
        json.dump(model, fh)

    print(f"lines scanned: {max_lines} ({time.time()-t0:.1f}s)")
    print(f"chords: {total_chords}, classified: {classified} ({100*classified/max(total_chords,1):.1f}%)")
    print(f"melody notes: {total_melody}")
    print("per-quality melody interval distribution (top 3 intervals):")
    for q, ivs in melody_intervals.items():
        top = sorted(range(12), key=lambda x: -ivs[x])[:3]
        tot = sum(ivs)
        if tot:
            print(f"  {q:5s} n={tot:6d} reg={register_mode[q]:2d}  "
                  f"top={[(iv, round(100*ivs[iv]/tot)) for iv in top]}")
    print(f"\nwrote {out}")


if __name__ == "__main__":
    main()
