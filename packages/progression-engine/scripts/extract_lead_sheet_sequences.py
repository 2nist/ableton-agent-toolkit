#!/usr/bin/env python3
"""Extract key-relative degree sequences from the lead-sheet corpus.

Lead-sheet MIDIs encode chords as Marker meta events `root_pc_bass_pc_quality_ext_`
(pitch classes, 0 = C). This scans `/Users/Matthew/ableton-midi/lead-sheets`,
transposes each section to its key (MIDI key signature; fallback = most common root),
maps chords to ionian degree strings, drops non-diatonic chords, and writes
`../data/lead_sheet_degree_sequences.json` — an array of degree arrays.

Run:  python3 scripts/extract_lead_sheet_sequences.py
"""
import os
import re
import json
from collections import Counter

MARK = re.compile(rb"\xff\x06[\x01-\x1f](\d+)_(\d+)_([A-Za-z]*)_(\d*)_")
KEYS = re.compile(rb"\xff\x59\x02(.)(.)")
ROOT = "/Users/Matthew/ableton-midi/lead-sheets"
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data")


def base_triad(q, _e):
    if q == "o":
        return "dim"
    if q == "m":
        return "min"
    return "maj"


DEG = {
    (0, "maj"): "I",
    (1, "maj"): "♭II",
    (2, "min"): "ii",
    (3, "maj"): "♭III",
    (4, "min"): "iii",
    (5, "maj"): "IV",
    (5, "min"): "iv",
    (7, "maj"): "V",
    (8, "maj"): "♭VI",
    (9, "min"): "vi",
    (10, "maj"): "♭VII",
    (11, "dim"): "vii°",
}


def to_degree(root, triad, tonic):
    return DEG.get(((root - tonic) % 12, triad))


def tonic_from_key(k):
    if k is None:
        return None
    sf = k[0] if k[0] < 128 else k[0] - 256  # signed #sharps (bytes 251-255 = flats)
    return (7 * sf) % 12


def main():
    sequences = []
    n_files = n_ok = 0
    for dp, _dirs, files in os.walk(ROOT):
        for fn in sorted(files):
            if not fn.endswith(".mid"):
                continue
            with open(os.path.join(dp, fn), "rb") as fh:
                d = fh.read()
            ms = MARK.findall(d)
            if not ms:
                continue
            n_files += 1
            km = KEYS.search(d)
            key = (km.group(1)[0], km.group(2)[0]) if km else None
            tonic = tonic_from_key(key)
            if tonic is None:
                tonic = int(Counter(r[0] for r in ms).most_common(1)[0][0])
            seq = []
            for r, _b, q, e in ms:
                dg = to_degree(int(r), base_triad(q.decode(), e.decode()), tonic)
                if dg is not None:
                    seq.append(dg)
            if len(seq) >= 2:
                sequences.append(seq)
                n_ok += 1
    os.makedirs(OUT, exist_ok=True)
    out = os.path.join(OUT, "lead_sheet_degree_sequences.json")
    with open(out, "w") as f:
        json.dump(sequences, f)
    print(f"{n_ok} sequences (of {n_files} chord files) -> {out}")
    print("(feed this to `npm run build:model` in this package)")


if __name__ == "__main__":
    main()
