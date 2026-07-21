#!/usr/bin/env python3
"""Whisper upgrade: add synced timestamps to plain-lyric LRCLIB files."""
import json, os, subprocess

VENV_PYTHON = "/Users/Matthew/ableton-agent-toolkit/.whisper-venv/bin/python"
LRCLIB_DIR = "/Users/Matthew/Beatles Data/lyrics_from_lrclib"

JOBS = [
    ("01 Come Together", "/Users/Matthew/Beatles Data/audio/abbey_road/01_come_together.mp3", "01_come_together.json"),
    ("02 - The Night Before", "/Users/Matthew/Beatles Data/audio/help/02_the_night_before.mp3", "02_the_night_before.json"),
    ("04 - Blue jay way", "/Users/Matthew/Beatles Data/audio/Magical Mystery Tour/04_blue_jay_way.mp3", "04_blue_jay_way.json"),
    ("04 - ROCK AND ROLL MUSIC", "/Users/Matthew/Beatles Data/audio/beatles_for_sale/04_rock_and_roll_music.mp3", "04_rock_and_roll_music.json"),
    ("06 - Till There Was You", "/Users/Matthew/Beatles Data/audio/With The Beatles/06_till_there_was_you.mp3", "06_till_there_was_you.json"),
    ("07 - She Said She Said", "/Users/Matthew/Beatles Data/audio/Revolver/07_she_said_she_said.mp3", "07_she_said_she_said.json"),
    ("08 Roll Over Beethoven", "/Users/Matthew/Beatles Data/audio/With The Beatles/08_roll_over_beethoven.mp3", "08_roll_over_beethoven.json"),
    ("08 - What Goes On", "/Users/Matthew/Beatles Data/audio/Rubber Soul/08_what_goes_on.mp3", "08_what_goes_on.json"),
    ("09 - HOLD ME TIGHT", "/Users/Matthew/Beatles Data/audio/With The Beatles/09_hold_me_tight.mp3", "09_hold_me_tight.json"),
    ("10 You Like Me Too Much", "/Users/Matthew/Beatles Data/audio/help/10_you_like_me_too_much.mp3", "10_you_like_me_too_much.json"),
]

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

def transcribe_and_upgrade(song_title: str, audio_path: str, lrclib_file: str) -> bool:
    if not os.path.exists(audio_path):
        print(f"  SKIP: audio not found: {audio_path}")
        return False

    print(f"  Transcribing: {song_title} ...", flush=True)
    result = subprocess.run(
        [VENV_PYTHON, "-c", WHISPER_CODE, audio_path],
        capture_output=True, text=True, timeout=600,
    )
    if result.returncode != 0:
        print(f"  ERROR: {result.stderr[:300]}")
        return False

    try:
        data = json.loads(result.stdout.strip().split("\n")[-1])
    except:
        try:
            data = json.loads(result.stdout)
        except:
            print(f"  ERROR: invalid JSON")
            return False

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

    # Read existing, add syncedLyrics, write back
    lrc_path = os.path.join(LRCLIB_DIR, lrclib_file)
    with open(lrc_path) as f:
        entry = json.load(f)

    entry["syncedLyrics"] = "\n".join(lrc_lines)
    with open(lrc_path, "w") as f:
        json.dump(entry, f, indent=2)

    print(f"    → {lrclib_file}  ({len(lrc_lines)} synced lines)")
    return True

def main():
    results = []
    for title, path, lrc_fn in JOBS:
        ok = transcribe_and_upgrade(title, path, lrc_fn)
        results.append((title, ok))

    print(f"\n=== SUMMARY ===")
    ok = sum(1 for _, good in results if good)
    for title, good in results:
        print(f"  {'✓' if good else '✗'} {title}")
    print(f"\n{ok}/{len(results)} upgraded")

if __name__ == "__main__":
    main()
