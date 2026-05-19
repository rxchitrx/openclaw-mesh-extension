# PRD: Mesh Base Solidification + Capability Discovery & Execution

## Problem Statement

The mesh extension successfully connects two OpenClaw nodes and syncs files, but:

1. All state is in-memory and lost on gateway restart
2. Symlinks can leak the file watcher outside the tracked directory
3. Ignore patterns are hardcoded and not user-configurable
4. The mesh only supports file sync — no mechanism for peers to advertise what their machine can do or request execution of tasks on remote nodes

## Solution

Add disk persistence so state survives restarts, harden the file watcher against symlink escapes, make ignore patterns configurable, and add a capability discovery + execution system that transforms the mesh from a file-sync tool into a general P2P substrate where any node can ask any other node to perform tasks.

## User Stories

1. As a mesh user, I want my pending changes and event history to survive gateway restarts, so that I don't lose sync state when I reboot
2. As a mesh user, I want the file watcher to ignore symlinks that point outside the tracked directory, so that my local filesystem isn't accidentally exposed
3. As a mesh user, I want to configure custom ignore patterns in my plugin config, so that I can exclude build artifacts or cache directories beyond the defaults
4. As a mesh user, I want to declare what my machine can do (e.g. "has:xcode", "os:macos"), so that other peers know my node's capabilities
5. As a mesh user, I want capabilities to be automatically exchanged when I connect to a peer, so that I don't have to manually ask or configure on a per-peer basis
6. As a mesh user, I want to dynamically add or remove capabilities at runtime, so that I can advertise temporary tools I installed
7. As a mesh user, I want to ask the mesh which peer can perform a specific task (e.g. "who has xcode?"), so that I can find the right node to work with
8. As a mesh user, I want to request a remote peer to execute a task on their machine, so that I can use their device's capabilities (e.g. running iOS tests on a Mac from my Linux machine)
9. As a mesh user receiving an execution request, I want to be asked for approval before the task runs, so that I control what executes on my machine
10. As a mesh user receiving an execution request, I want to approve or deny it and send the result back, so that the requester knows the outcome
11. As a mesh user who requested execution, I want to be notified when the task completes (or fails), so that I know the result
12. As a mesh user who was denied, I want to know that the request was denied rather than waiting indefinitely
13. As a mesh user, I want to see capabilities listed in mesh_status, so that I can quickly see what each peer can do

## Implementation Decisions

### Module 1: Persistence Layer (sync-state.ts, events.ts)

Save SyncState (file versions map, last synced hashes map) and event store (event records) as JSON to `~/.openclaw/mesh/` on every mutation. Load on gateway_start, capped at 200 events. Same pattern as existing peer-identity.ts / mesh-session-target.ts (file-based persistence in `~/.openclaw/mesh/`).

Deep module with simple `saveState(state)` / `loadState()` interface, testable with temp directories.

### Module 2: Symlink Safety (file-watcher.ts)

Before processing any file change or deletion event, call `fs.realpathSync` on the resolved path. Verify the real path starts with `workspaceDir` — if not, skip the event with a warning log.

### Module 3: Configurable Ignore Patterns (openclaw.plugin.json, index.ts, file-watcher.ts)

Accept `"ignorePatterns": ["re1", "re2"]` in plugin config schema as an array of regex strings. Merge with the hardcoded defaults in `createFileWatcher`.

### Module 4: Capability Registry (new file: src/capability-registry.ts)

In-memory set, initialized from plugin config `capabilities` array. Runtime modification via `mesh_advertise` tool.

```
interface CapabilityRegistry {
  add(tag: string): void
  remove(tag: string): void
  list(): string[]
  has(tag: string): boolean
}
```

Deep module testable in isolation with zero setup.

### Module 5: Protocol Validation (protocol-validation.ts)

Two new message types added to `MESH_MESSAGE_TYPES`:

```
CapabilityExecuteMessage = {
  type: "capability_execute"
  capability: string
  instruction: string
  from: string
}

CapabilityExecuteResultMessage = {
  type: "capability_execute_result"
  requestId: string
  result?: string
  error?: string
  from: string
}
```

Validators added matching the existing pattern in protocol-validation.ts.

### Module 6: node_info Extension (transport.ts, discovery.ts, index.ts)

- `NodeInfo` type gains `capabilities: string[]`
- Provider callback chain updated: `capability-registry.list()` is called when constructing node_info
- Validator in protocol-validation.ts accepts optional `capabilities` array

### Module 7: Pending Execution Store (transport.ts)

Mirrors the existing `PendingConnection` pattern: a `Map<string, PendingExecution>` keyed by `requestId`. Each pending execution has a 60-second timeout timer; on expiry, auto-resolve with error.

Transport exposes:
```
getPendingExecutions(): PendingExecution[]
respondToExecution(requestId: string, result?: string, error?: string): boolean
```

### Module 8: Event Store Integration (events.ts, urgent-notifications.ts)

- Add `capability_execute_requested` to `MeshEventKind` (urgent, in high-priority set)
- Add `capability_execute_completed` to `MeshEventKind`

### Module 9: Agent Integration (index.ts)

- Incoming `capability_execute` → store as pending execution → push to event store → urgent notification surfaces to A's agent
- A's agent sees event "Node B wants you to run [instruction] using [capability]" → asks user → runs task → calls `mesh_capability_respond`
- Result sent back via `capability_execute_result` → surfaces event to B's agent
- Both parties notified on completion or denial

### Module 10: Tools (src/tools/)

- **`mesh_advertise`** — add/remove/list capabilities. Modifies registry, broadcasts if connected
- **`mesh_capability_respond`** — requestId, result, error. Agent calls this after running delegated task
- **`mesh_status`** modified to show local + per-peer capabilities
- **`mesh_connections`** modified to show remote capabilities

## Testing Decisions

- A good test validates external behavior through the service interface, not internal state of maps or timers
- Persistence layer: write state, reload from disk, verify contents match. Prior art: `test-urgent-notifications.mjs` uses temp dirs and reloads
- Capability registry: add, remove, list, has operations. Testable with zero setup — pure logic
- Protocol validation: valid and invalid messages for the two new types. Prior art: `test-protocol-validation.mjs`
- Symlink safety: create symlink to outside file, verify it's not tracked. Prior art: `test-path-safety.mjs`

Tests will be written for:
- Persistence layer (SyncState + events)
- Capability registry
- Protocol validation (new message types)
- Symlink safety

## Out of Scope

- Encryption (accepted — fingerprints + approval flow sufficient for trusted LAN)
- Rate limiting (not needed for verified, approved peers)
- Streaming execution results (one-shot only)
- NAT traversal or internet relay (LAN only)
- Multi-directory tracking
- Automatic background sync
- Conflict resolution UI / 3-way merge
- Peer-to-peer chat
- Mesh network visualization

## Further Notes

- All execution is agent-delegated: the mesh only routes the request and result, while the receiving agent figures out how to run the task based on the natural language instruction
- Capabilities are flat tags (`has:xcode`, `os:macos`, `can:ios-build`) for simplicity
- The execution approval flow mirrors the existing peer approval flow for consistency
- Timeout is 60 seconds by default; denials are communicated immediately rather than letting the requester wait
