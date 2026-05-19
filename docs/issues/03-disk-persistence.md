# Disk persistence for SyncState and events

## What to build

All state (file versions, pending changes, event history, acknowledgment status) is in-memory and lost on gateway restart. This means pending changes that haven't been broadcast disappear, and users lose visibility into what happened before the restart.

Add save/load to disk for two data stores:

1. **SyncState** — file versions map (`Map<relativePath, FileVersion>`) and last synced hashes map (`Map<relativePath, string>`). Saved as JSON on every write mutation.
2. **Event store** — event records array. Saved as JSON on every event mutation.

Both persist to `~/.openclaw/mesh/` as JSON files, matching the pattern already used by `peer-identity.ts` and `mesh-session-target.ts`. Load on `gateway_start`, save on mutation, cap events at 200 on reload.

## Acceptance criteria

- [ ] SyncState saves file versions and last synced hashes to a JSON file on every local/remote change
- [ ] Event store saves event records to a JSON file on every event mutation
- [ ] On gateway_start, both stores are loaded from disk if the files exist
- [ ] When no files exist on disk, start with empty state (first-run friendly)
- [ ] A test script (`scripts/test-persistence.mjs`) writes state, reloads from disk, and verifies contents match

## Blocked by

None — can start immediately.
