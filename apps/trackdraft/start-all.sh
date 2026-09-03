#!/bin/bash
# TrackDraft — start all dev services and open browser
# Usage: bash start-all.sh

set -e
DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR"

# Usage: bash start-all.sh [lan]
#   (no arg) → localhost only (default)
#   lan      → bind Vite to the LAN so an iPad/phone on the same network can
#              open http://<mac-ip>:5183 and control the app from there
LAN_MODE=0
if [ "$1" = "lan" ]; then
  LAN_MODE=1
fi

echo "═══════════════════════════════════════"
echo "  TrackDraft — Dev Launcher${LAN_MODE:+ (LAN mode)}"
echo "═══════════════════════════════════════"

# ── Kill stale processes ──────────────────
echo ""
echo "🧹 Cleaning up old processes…"
# Ports are force-cleared (SIGTERM then SIGKILL) because node/Vite/tsx
# children routinely survive a plain `kill` once their npm/shell parent is
# gone — the exact thing that left a stale app on :5183 before.
kill_port() {
  local port=$1
  local pids
  pids=$(lsof -ti ":$port" 2>/dev/null || true)
  for pid in $pids; do
    echo "   Killing PID $pid on port $port"
    kill "$pid" 2>/dev/null || true
  done
  # Give them up to ~3s to release the port, then force-kill stragglers.
  for _ in $(seq 1 10); do
    if ! lsof -ti ":$port" > /dev/null 2>&1; then return 0; fi
    sleep 0.3
  done
  pids=$(lsof -ti ":$port" 2>/dev/null || true)
  for pid in $pids; do
    echo "   Force-killing PID $pid on port $port"
    kill -9 "$pid" 2>/dev/null || true
  done
}

# TrackDraft Vite dev server range — old runs could have drifted up the
# port ladder when a stale instance squatted on 5183.
for p in 5183 5184 5185 5186 5187 5188 5189 5190; do kill_port "$p"; done
kill_port 5000   # ChordMiniApp Python
kill_port 5001   # ChordMiniApp fallback
kill_port 8081   # osc-bridge WebSocket (Ableton sync)
kill_port 5200   # osc-bridge REST (Send to Ableton / health)
# Bridge node children (tsx) that may not be bound to a killable port yet
pkill -f "tsx src/cli.ts" 2>/dev/null || true
pkill -f "packages/osc-bridge" 2>/dev/null || true

# ── Start ChordMiniApp (optional) ─────────
# Source .env if it exists (Vite .env convention)
if [ -f ".env" ]; then
  export $(grep -v '^#' .env | xargs)
fi
CHORDMINI_URL="${CHORDMINI_URL:-}"
CHORDMINI_DIR="${CHORDMINI_DIR:-}"

# Resolve a Python that has numpy (try pyenv chord-extractor-env first,
# then system python3 which may also work)
resolve_python() {
  # pyenv chord-extractor-env (has numpy + chord-extractor)
  local pyenv_python="$HOME/.pyenv/versions/chord-extractor-env/bin/python"
  if [ -x "$pyenv_python" ]; then
    echo "$pyenv_python"
    return
  fi
  # fallback: system python3
  echo "python3"
}

if [ -n "$CHORDMINI_URL" ] && [ -n "$CHORDMINI_DIR" ]; then
  if [ -f "$CHORDMINI_DIR/app.py" ]; then
    PYTHON_BIN=$(resolve_python)
    echo ""
    echo "🎵 Starting ChordMiniApp from $CHORDMINI_DIR (using $PYTHON_BIN)…"
    (
      cd "$CHORDMINI_DIR"
      "$PYTHON_BIN" app.py &
    )
    echo "   ChordMiniApp starting on ${CHORDMINI_URL}…"
  fi
else
  echo ""
  echo "⚠️  ChordMiniApp not configured."
  echo "   Set CHORDMINI_URL and CHORDMINI_DIR in your .env or export them:"
  echo ""
  echo "   export CHORDMINI_URL=http://localhost:5000/analyze"
  echo "   export CHORDMINI_DIR=/path/to/ChordMiniApp"
  echo ""
  echo "   YouTube import will work, but chord analysis will be skipped."
fi

# Give ChordMiniApp a moment to start
sleep 2

# ── Start osc-bridge (Ableton sync + Send to Ableton) ──
# The TrackDraft app's Ableton status ("● connected / ○ waiting…") and the
# "Send to Ableton" button depend on this bridge (ws:8081 + REST:5200).
# Output is logged so a startup failure is visible in the script instead of
# silently leaving the app on "bridge not running".
echo ""
echo "🔌 Starting osc-bridge (Ableton transport sync + Send to Ableton)…"
REPO_ROOT="$(cd "$DIR/../.." && pwd)"
BRIDGE_LOG="$DIR/.osc-bridge.log"
: > "$BRIDGE_LOG"
(
  cd "$REPO_ROOT"
  exec npm run bridge
) > "$BRIDGE_LOG" 2>&1 &
BRIDGE_PID=$!
echo "   osc-bridge starting (ws://127.0.0.1:8081, REST :5200, log: $BRIDGE_LOG)…"

# Wait for the bridge's REST health endpoint so we report success/failure
# here instead of letting the app guess. ~10s is plenty for npm+tsx to boot.
BRIDGE_OK=0
for _ in $(seq 1 20); do
  if curl -s http://127.0.0.1:5200/health > /dev/null 2>&1; then
    BRIDGE_OK=1
    echo "   ✓ osc-bridge ready."
    break
  fi
  sleep 0.5
done
if [ "$BRIDGE_OK" -ne 1 ]; then
  echo "   ⚠️  osc-bridge did not become ready. Last log lines:"
  tail -20 "$BRIDGE_LOG" 2>/dev/null || true
fi

# ── Start Vite dev server ────────────────
echo ""
echo "🚀 Starting TrackDraft on http://localhost:5183 …"
# --strictPort: fail loudly if 5183 is taken rather than silently drifting
# to 5184+ and leaving the hardcoded browser URL pointing at a stale app.
VITE_HOST_FLAG=""
if [ "$LAN_MODE" -eq 1 ]; then
  VITE_HOST_FLAG="--host"
  echo "   (LAN mode — reachable from other devices on this network)"
fi
npx vite --port 5183 --strictPort $VITE_HOST_FLAG &
VITE_PID=$!

# Wait for Vite to be ready
echo "   Waiting for server…"
for i in $(seq 1 15); do
  if curl -s http://localhost:5183 > /dev/null 2>&1; then
    echo "   Server ready!"
    break
  fi
  sleep 1
done

# ── Open browser ──────────────────────────
echo ""
echo "🌐 Opening browser…"
open http://localhost:5183

echo ""
echo "═══════════════════════════════════════"
echo "  TrackDraft running!"
echo "  → http://localhost:5183"
if [ "$LAN_MODE" -eq 1 ]; then
  LAN_IP="$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || true)"
  if [ -n "$LAN_IP" ]; then
    echo "  → iPad/phone: http://$LAN_IP:5183"
    # Self-check: can this machine reach the app via its own LAN IP? If
    # not, the macOS firewall is almost certainly blocking `node` — the
    # most common reason an iPad on the same Wi-Fi can't connect even
    # though localhost works.
    if curl -s -o /dev/null --max-time 3 "http://$LAN_IP:5183/"; then
      echo "  → LAN self-check: ✓ reachable via $LAN_IP"
    else
      echo "  → LAN self-check: ⚠️  NOT reachable via $LAN_IP — macOS firewall is"
      echo "    probably blocking node. Allow it: System Settings → Network →"
      echo "    Firewall → Options → add/allow 'node' (or click 'Allow' if a"
      echo "    prompt appears when the server starts)."
    fi
  fi
fi
if [ -n "$CHORDMINI_URL" ]; then
  echo "  → ChordMiniApp at $CHORDMINI_URL"
fi
echo "  → osc-bridge at ws://127.0.0.1:8081 (Ableton sync)"
if [ "$LAN_MODE" -eq 0 ]; then
  echo "  (localhost only — to reach from your iPad/phone, run: bash start-all.sh lan)"
fi
echo "═══════════════════════════════════════"
echo ""
echo "Press Ctrl+C to stop all services."

# Handle Ctrl+C gracefully — force-kill by port so node children don't
# survive (plain SIGTERM proved unreliable for Vite/tsx).
trap "echo ''; echo '👋 Shutting down…'; kill $VITE_PID $BRIDGE_PID 2>/dev/null; kill_port 5183 2>/dev/null; kill_port 5200 2>/dev/null; kill_port 8081 2>/dev/null; kill_port 5000 2>/dev/null; pkill -f 'tsx src/cli.ts' 2>/dev/null; pkill -f 'packages/osc-bridge' 2>/dev/null; [ -n '$CHORDMINI_DIR' ] && pkill -f 'app.py' 2>/dev/null; exit 0" INT TERM

wait $VITE_PID