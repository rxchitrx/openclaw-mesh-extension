# File watcher: prevent symlink escape outside tracked directory

## What to build

The file watcher (`src/file-watcher.ts`) currently tracks files by joining the workspace directory with the event filename. If a symlink points outside the workspace directory, the watcher would follow it and expose files outside the intended scope.

Add a safety check: before processing any file change or deletion event, resolve the full path with `fs.realpathSync` and verify the real path is still under `workspaceDir`. If not, log a warning and skip the event.

## Acceptance criteria

- [ ] Every file change event resolves the real path with `fs.realpathSync` before processing
- [ ] Files outside the workspace directory are skipped with a warning log
- [ ] Files inside the workspace directory (including real symlinks to inside paths) still work normally
- [ ] A test script (`scripts/test-symlink-safety.mjs`) creates a symlink to a file outside the workspace dir and verifies it is not tracked

## Blocked by

None — can start immediately.
