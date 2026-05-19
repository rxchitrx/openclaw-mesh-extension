# Runtime capability management with mesh_advertise

## What to build

A new `mesh_advertise` tool that lets users add, remove, and list capabilities at runtime without editing config. This is useful for advertising temporary tools ("I just installed Docker on this node").

The tool accepts two actions: `add <tag>` and `remove <tag>`. When capabilities change, the updated list should be broadcast to all connected peers (by re-sending `node_info` with the new capabilities).

Peer capabilities shown in `mesh_status` (from issue 4) should reflect live updates as peers add/remove capabilities.

## Acceptance criteria

- [ ] `mesh_advertise add has:xcode` adds the capability to the registry
- [ ] `mesh_advertise remove has:xcode` removes it
- [ ] `mesh_advertise list` returns all capabilities
- [ ] After add/remove, the updated capabilities are broadcast to all connected peers via `node_info`
- [ ] Receiving peers see updated capabilities in `mesh_status`
- [ ] A test script (`scripts/test-capability-registry.mjs` or a new one) verifies add/remove/list through the tool path

## Blocked by

Issue 4 (capability registration and visibility)
