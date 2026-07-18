#!/bin/bash
# Copies TrackDraft's exported blueprint JSON into this extension's
# sanctioned storage directory. Extensions can only read/write
# context.environment.storageDirectory/tempDirectory (see
# docs/essentials/concepts/6-resources-and-filesystem.html) — the
# extension itself cannot reach apps/trackdraft/scripts/output directly.
#
# Re-run this after re-exporting a song from TrackDraft so the picker
# and viewer see the latest version.
set -euo pipefail

SOURCE_DIR="/Users/Matthew/ableton-agent-toolkit/apps/trackdraft/scripts/output"
DEST_DIR="/Users/Matthew/Library/Application Support/Ableton/Extensions Data/matthew.trackdraft-bridge/blueprints"

mkdir -p "$DEST_DIR"
cp "$SOURCE_DIR"/*.trackdraft.json "$DEST_DIR"/
echo "Synced $(ls "$SOURCE_DIR"/*.trackdraft.json | wc -l | tr -d ' ') blueprint(s) to $DEST_DIR"
