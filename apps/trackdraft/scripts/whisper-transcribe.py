#!/usr/bin/env python3
"""Whisper fallback via faster-whisper for songs with no LRCLIB coverage."""
import json, os, subprocess, sys

VENV_PYTHON = "/Users/Matthew/ableton-agent-toolkit/.whisper-venv/bin/python"
LRCLIB_DIR = "/Users/Matthew/Beatles Data/lyrics_from_lrclib"

JOBS = [
    ("Don't Bother Me", "/Users/Matthew/Beatles Data/audio/with_the_beatles/04_don_t_bother_me.mp3"),
    ("Everybody's Trying to Be My Baby", "/Users/Matthew/Beatles Data/audio/Beatles For Sale/14_everybody_s_trying_to_be_my_baby.mp3"),
    ("I'm a Loser", "/Users/Matthew/Beatles Data/audio/Beatles For Sale/02_i_m_a_loser.mp3"),
    ("It Won't Be Long", "/Users/Matthew/Beatles Data/audio/with_the_beatles/01_it_won_t_be_long.mp3"),
    ("Sgt. Pepper's Lonely Hearts Club Band", "/Users/Matthew/Beatles Data/audio/Sgt. Pepper's Lonely Hearts Club Band/01_sgt_peppers_lonely_hearts_club_band.mp3"),
    ("Sgt. Pepper's Lonely Hearts Club Band (Reprise)", "/Users/Matthew/Beatles Data/audio/Sgt. Pepper's Lonely Hearts Club Band/12_sgt_peppers_reprise.mp3"),
    ("She's Leaving Home", "/Users/Matthew/Beatles Data/audio/Sgt. Pepper's Lonely Hearts Club Band/06_she_s_leaving_home.mp3"),
    ("There's A Place", "/Users/Matthew/Beatles Data/audio/please_please_me/13_there_s_a_place.mp3"),
    ("What You're Doing", "/Users/Matthew/Beatles Data/audio/Beatles For Sale/13_what_you_re_doing.mp3"),
]

def slug(title: str) -> str:
    return title.lower().replace("'", "").replace(" ", "_").replace("(", "").replace(")", "").replace(".", "")

WHISPER_CODE = '''
import json as _json, sys as _sys
from faster_whisper import WhisperModel
model = WhisperModel("base", device="cpu", compute_type="int8")
segments, info = model.transcribe(_sys.argv[1], beam_size=5)
result = []
plain_lines = []
for seg in segments:
    result.append({"start": seg.start, "end": seg.end, "text": seg.text.strip()})
    plain_lines.append(seg.text.strip())
print(_json.dumps({"segments": result, "text": " ".join(plain_lines)}))
'''

def transcribe(song_title: str, audio_path: str) -> dict | None:
    if not os.path.exists(audio_path):
        print(f"  SKIP: audio not found: {audio_path}")
        return None

    print(f"  Transcribing: {song_title} ...", flush=True)
    result = subprocess.run(
        [VENV_PYTHON, "-c", WHISPER_CODE, audio_path],
        capture_output=True, text=True, timeout=600,
    )
    if result.returncode != 0:
        print(f"  ERROR: {result.stderr[:500]}")
        return None

    try:
        data = json.loads(result.stdout.strip().split("\n")[-1])  # last JSON line
    except (json.JSONDecodeError, IndexError):
        # Try whole stdout
        try:
            data = json.loads(result.stdout)
        except json.JSONDecodeError:
            print(f"  ERROR: invalid JSON")
            print(f"  stdout[:500]: {result.stdout[:500]}")
            return None

    # Format as LRC
    lrc_lines = []
    for seg in data["segments"]:
        secs = seg["start"]
        mins = int(secs // 60)
        secs_rem = secs % 60
        text = seg["text"].strip()
        if not text:
            continue
        lrc_lines.append(f"[{mins:02d}:{secs_rem:05.2f}]{text}")

    entry = {
        "trackName": song_title,
        "plainLyrics": data["text"].strip(),
        "syncedLyrics": "\n".join(lrc_lines),
    }

    out_path = os.path.join(LRCLIB_DIR, f"{slug(song_title)}.json")
    with open(out_path, "w") as f:
        json.dump(entry, f, indent=2)

    print(f"    → {out_path}  ({len(lrc_lines)} lines)")
    return entry

def main():
    os.makedirs(LRCLIB_DIR, exist_ok=True)
    results = []
    for title, path in JOBS:
        r = transcribe(title, path)
        results.append((title, r is not None))

    print(f"\n=== SUMMARY ===")
    ok = sum(1 for _, good in results if good)
    for title, good in results:
        print(f"  {'✓' if good else '✗'} {title}")
    print(f"\n{ok}/{len(results)} transcribed")

if __name__ == "__main__":
    main()
