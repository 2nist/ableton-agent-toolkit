# @platform/osc-bridge

Relays Ableton Live's playhead beat position and play state to WebSocket clients as JSON — the one thing the Ableton Extensions SDK cannot do at all (confirmed by grepping the whole SDK API: no playhead, no `isPlaying`, anywhere in `Application` or `Song`).

Built on [AbletonOSC](https://github.com/ideoforms/AbletonOSC), which wraps Live's older Python Remote Script API — the one that has always had transport access. This package is a thin relay, not a replacement for it.

## Prerequisites

1. AbletonOSC must be installed as a Live Remote Script (already present at `~/Music/Ableton/User Library/Remote Scripts/AbletonOSC` on this machine).
2. It must be **enabled**: Live's Preferences → Link, Tempo & MIDI → select "AbletonOSC" in a Control Surface slot. This is a per-session toggle, separate from installation — check `~/Music/Ableton/User Library/Remote Scripts/AbletonOSC/logs/abletonosc.log` for a recent `Started AbletonOSC` line to confirm it's actually active.

## Running

```
npm run start --workspace=@platform/osc-bridge
```

Starts relaying to `ws://127.0.0.1:8081`. Logs every event it relays to the console.

## Protocol

Connect a WebSocket client to `ws://127.0.0.1:8081`. On connect, you immediately receive whatever beat/play-state is already known (no need to wait for the next change). After that, messages arrive as they happen:

```json
{"type": "beat", "beat": 42}
{"type": "playState", "isPlaying": true}
```

`beat` is an integer, pushed once per beat (not on every fractional tick) — see AbletonOSC's own `start_beat_listener`/`current_song_time_changed` in `abletonosc/song.py`.

## Design notes

- AbletonOSC's reply port (`OSC_RESPONSE_PORT`, fixed at 11001) is singular — only one process can hold the OSC-subscriber role at a time. This package is that single subscriber, fanning out to any number of WebSocket clients.
- Subscriptions are re-sent every 5s (configurable via `resubscribeIntervalMs`). AbletonOSC's listener registration doesn't survive an AbletonOSC/Live restart; re-subscribing an already-active listener is a harmless no-op, so this makes the bridge self-healing without a manual restart.
- `startPositionBridge()` is also exported for programmatic use (e.g. embedding in another process) rather than running the standalone CLI.
