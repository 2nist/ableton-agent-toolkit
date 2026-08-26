# TrackDraft Song MCP

MCP server for the TrackDraft song library — analyze, edit, and create genre templates via plain language.

## Setup

```bash
# Install deps (from repo root)
npm install --workspace=packages/song-mcp

# Build
npm run build -w packages/song-mcp
```

### Env var

`TRACKDRAFT_LIBRARY_DIR` — directory containing one `<songId>.blueprint.json` file per song. Defaults to `~/TrackDraft/library`.

```bash
export TRACKDRAFT_LIBRARY_DIR=~/TrackDraft/library
```

### Populate the library folder

Use the **"Sync library to folder"** button in the TrackDraft Dashboard's action bar. It writes every song in the browser store to a directory you choose via the File System Access API — overwriting by `songId`, never deleting. The MCP server reads from that same directory.

### Register with Claude Code

Add this to the workspace `.mcp.json` (repo root):

```json
{
  "mcpServers": {
    "trackdraft": {
      "command": "node",
      "args": ["packages/song-mcp/dist/index.js"],
      "env": {
        "TRACKDRAFT_LIBRARY_DIR": "~/TrackDraft/library"
      }
    }
  }
}
```

### Test with the MCP inspector

```bash
npx @modelcontextprotocol/inspector node packages/song-mcp/dist/index.js
```

## Tools

| Tool | Read | Description |
|---|---|---|
| `song_query_library` | ✅ | Token-lean digest of all songs (id, title, key, BPM, sections, chords). Supports filters: key, label, artistContains, missingChords. Default 50 results. |
| `song_get` | ✅ | Full structural detail for one song — every section's chords, lyric count, first line. |
| `song_apply_ops` | ❌ | Batch-apply validated operations: renameSection, setSectionKey, duplicateSection, reorderSections, setChordProgression. All-or-nothing validation. `dryRun` preview. Auto-backups. |
| `song_revert` | ❌ | Restore a song from a backup (latest or specific timestamp). |
| `song_create_template` | ❌ | Write a new genre template file matching the catalog JSON shape. |
| `song_library_stats` | ✅ | Aggregate stats: total songs, key distribution, BPM min/median/max, top 10 progressions. |

## Architecture

```
src/
  index.ts     — MCP server entry point (stdio transport, 6 tools)
  digest.ts    — songDigest() / songDetail() serializers
  ops.ts       — SongOp zod schemas + applyOps() pure function
```

- No database, no HTTP server, no auth. Filesystem only.
- The model emits validated operations as typed JSON; this server applies them.
- Backups written to `<libraryDir>/../.backups/<songId>/<timestamp>.json` before any write.