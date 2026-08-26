#!/usr/bin/env python3
"""Extract attributed song sections (artist/song + degree sequence) from the
lead-sheet corpus into a COMPACT index for the Progression Studio.

The corpus at `/Users/Matthew/ableton-midi/lead-sheets` is laid out as
`Artist/Song/Section.mid`. Every section's chords (Marker meta events
`root_pc_bass_pc_quality_ext_`) are transposed to the section's key and mapped
to ionian degree strings. So the studio can answer "which songs use this
progression?"

Compact encoding (kept small enough to inline into the modal's data: URL):
- Each degree is a single char (a..l), so a progression is a short string and
  subsequence matching is a fast `indexOf`.
- Artist + title are deduplicated into a `names` pool; each section references it.
- Only "song-like" sections are kept: 3..12 chords with >= 3 distinct degrees
  (drones like I-I-I-I are dropped).

Writes `../data/song_sections.json`:
```
{ "v": 3,
  "names": ["Artist - Title", ...],
  "sections": [ {"n": <nameIdx>, "d": "aefd"}, ... ] }
```

Run:  python3 scripts/extract_song_sections.py
"""
import os
import re
import json
from collections import Counter

MARK = re.compile(rb"\xff\x06[\x01-\x1f](\d+)_(\d+)_([A-Za-z]*)_(\d*)_")
KEYS = re.compile(rb"\xff\x59\x02(.)(.)")
ROOT = "/Users/Matthew/ableton-midi/lead-sheets"
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data")


def base_triad(q):
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
    sf = k[0] if k[0] < 128 else k[0] - 256
    return (7 * sf) % 12


# 12 degrees -> single ASCII chars (a..l). Order matches DEG above.
DEG_CODE = {"I": "a", "ii": "b", "iii": "c", "IV": "d", "V": "e", "vi": "f",
            "vii°": "g", "♭II": "h", "♭III": "i", "♭VI": "j", "♭VII": "k", "iv": "l"}


def main():
    rows = []  # (artist, song, degree_code_string)
    n_files = 0
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
            for r, _b, q, _e in ms:
                dg = to_degree(int(r), base_triad(q.decode()), tonic)
                if dg is not None:
                    seq.append(dg)
            if len(seq) < 3 or len(seq) > 12:
                continue
            if len(set(seq)) < 3:
                continue  # drones
            rel = os.path.relpath(dp, ROOT).split(os.sep)
            artist = rel[0] if len(rel) > 0 else ""
            song = rel[1] if len(rel) > 1 else ""
            rows.append((artist, song, "".join(DEG_CODE[x] for x in seq)))

    # Dedupe name pool
    names = sorted({(a, t) for a, t, _c in rows})
    name_idx = {(a, t): i for i, (a, t) in enumerate(names)}

    sections = [{"n": name_idx[(a, t)], "d": c} for a, t, c in rows]

    os.makedirs(OUT, exist_ok=True)
    out = os.path.join(OUT, "song_sections.json")
    with open(out, "w") as f:
        json.dump(
            {"v": 3, "names": [f"{a} - {t}" for a, t in names], "sections": sections},
            f,
            ensure_ascii=False,
            separators=(",", ":"),
        )

    print(f"{len(rows)} song-like sections (of {n_files} chord files) -> {out}")
    print(f"file size: {os.path.getsize(out) / 1024:.1f} KB")
    print(f"unique artist-title: {len(names)}")
    if rows:
        print("sample section:", json.dumps(sections[0]))
        print("sample name:", names[sections[0]["n"]])


if __name__ == "__main__":
    main()
