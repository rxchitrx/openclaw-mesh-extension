# Configurable ignore patterns for file watcher

## What to build

Currently the file watcher skips a hardcoded set of patterns (`node_modules/`, `.git/`, `dist/`, `.DS_Store`, `Thumbs.db`). Users cannot customize these.

Add an `ignorePatterns` config option that accepts an array of regex strings. Merge user patterns with the hardcoded defaults in `createFileWatcher`.

## Acceptance criteria

- [ ] Plugin config schema (`openclaw.plugin.json`) accepts `ignorePatterns` as an array of strings
- [ ] `MeshConfig` type in `index.ts` includes `ignorePatterns`
- [ ] `createFileWatcher` merges user-provided patterns with hardcoded defaults
- [ ] A file matching a configured ignore pattern is not tracked
- [ ] A test script (`scripts/test-ignore-patterns.mjs`) verifies configured and default patterns are respected

## Blocked by

None — can start immediately.
