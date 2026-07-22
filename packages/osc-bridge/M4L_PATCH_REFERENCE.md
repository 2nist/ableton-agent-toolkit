# Max for Live Telemetry Bridge Patch Blueprint

Drop this utility tracking patch onto your master output track or project template. It hooks directly into the Live Object Model API layer using background thread observers and streams JSON objects downstream via low-latency UDP.

## 1. Object Interconnection Blueprint

```
  [live.thisdevice]
         │
  [bang] ───► [deferlow]
                 │
  ┌──────────────┴────────────────────────┐
  │ path live_set master_track            │  ◄── Ableton 12 Song Context Route
  └──────────────┬────────────────────────┘
                 ▼
           [live.path]
                 │ (ID output pointer)
                 ▼
         [live.observer]
                 │
                 ▼
          [route text]
                 │
                 ▼
         [dict.pack scale: v]
                 │
                 ▼
   [dict.serialize telemetryState]
                 │
                 ▼
       [prepend /live/state]
                 │
                 ▼
      [udpsend 127.0.0.1 6000]
```

## 2. Live Object Model Setup & Parameter Keys

To read the global song project speed and scale variables concurrently, initialize these configuration definitions inside your device sub-patchers:

### Tempo Track Observer:
- **Target Path:** `live_set`
- **Property Checked:** `tempo`
- **Max Object Configuration:** `live.observer tempo`

### Scale Configuration Observers (Ableton Live 12+ Features):
- **Target Path:** `live_set master_track`
- **Property Checked:** `scale_name` & `root_note`
- **Max Object Configuration:** `live.observer scale_name` and `live.observer root_note`

## 3. Serialized Output Wire Format Spec

The `udpsend` object pipes out a single standard stringified JSON message format string under the `/live/state` header argument.

```json
{
  "bpm": 124.5,
  "scale": "Minor",
  "rootNote": "G"
}
```

## 4. Triggering Updates

Add a `metro` object set to ~500ms to the `dict.append` chain to periodically push state updates without flooding the UDP socket:

```
[metro 500] → [trigger bang] → [dict.serialize telemetryState]
```

## 5. OSC Message Format (Bridge Expectation)

The Node.js bridge (`packages/osc-bridge/src/telemetry.ts`) listens on UDP port 6000 and expects:

```
Address: /live/state
Payload: JSON string containing { bpm, scale, rootNote }
```

The REST endpoint `GET http://localhost:5200/api/ableton/state` returns the cached state as:
```json
{
  "bpm": 124.5,
  "scale": "Minor",
  "rootNote": "G",
  "timestamp": 1784548800123
}