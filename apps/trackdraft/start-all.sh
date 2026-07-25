#!/bin/bash
# TrackDraft — start all dev services and open browser
# Usage: bash start-all.sh

set -e
DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR"

echo "═══════════════════════════════════════"
echo "  TrackDraft — Dev Launcher"
echo "═══════════════════════════════════════"

# ── Kill stale processes ──────────────────
echo ""
echo "🧹 Cleaning up old processes…"
kill_port() {
  local port=$1
  local pid
  pid=$(lsof -ti ":$port" 2>/dev/null || true)
  if [ -n "$pid" ]; then
    echo "   Killing PID $pid on port $port"
    kill "$pid" 2>/dev/null || true
    sleep 0.5
  fi
}

kill_port 5183   # TrackDraft Vite
kill_port 5000   # ChordMiniApp Python
kill_port 5001   # ChordMiniApp fallback

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

# ── Start Vite dev server ────────────────
echo ""
echo "🚀 Starting TrackDraft on http://localhost:5183 …"
npx vite --port 5183 &
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
if [ -n "$CHORDMINI_URL" ]; then
  echo "  → ChordMiniApp at $CHORDMINI_URL"
fi
echo "═══════════════════════════════════════"
echo ""
echo "Press Ctrl+C to stop all services."

# Handle Ctrl+C gracefully
trap "echo ''; echo '👋 Shutting down…'; kill $VITE_PID 2>/dev/null; [ -n '$CHORDMINI_DIR' ] && pkill -f 'python3 app.py' 2>/dev/null; exit 0" INT TERM

wait $VITE_PID