# Capability execution: inbound request handling

## What to build

When a remote peer requests execution on this node, the transport layer must receive, validate, store, and surface that request. This is the "receive side" of the capability execution feature, without yet providing the tool to respond.

Two new protocol message types added to `MESH_MESSAGE_TYPES` and validated:

- `capability_execute` — `{capability, instruction, from}` (remote peer sends this)
- `capability_execute_result` — `{requestId, result?, error?, from}` (response — validated but not yet sent back)

A pending execution store in transport mirrors the existing `PendingConnection` pattern: a `Map<string, PendingExecution>` keyed by `requestId`. Each pending execution has a 60-second timeout timer; on expiry, auto-resolve with an error event.

Two new event kinds:
- `capability_execute_requested` — urgent, added to the high-priority event set and the urgent notification set
- `capability_execute_completed` — info-level, for when the result arrives

On receive of `capability_execute`:
1. Validate the message
2. Store as pending execution with a 60-second timeout
3. Create a `capability_execute_requested` event — surfaces via urgent notification to the receiving agent
4. If timeout fires, auto-resolve with "timeout" error and create a `capability_execute_completed` event

Pending executions should be visible in `mesh_status` and `mesh_connections`.

## Acceptance criteria

- [ ] `capability_execute` message type added to `MESH_MESSAGE_TYPES` with validator
- [ ] `capability_execute_result` message type added to `MESH_MESSAGE_TYPES` with validator
- [ ] Incoming `capability_execute` is stored as a pending execution with 60-second timeout
- [ ] `capability_execute_requested` event is created and surfaces via urgent notification
- [ ] On timeout, auto-resolves with an error and creates `capability_execute_completed` event
- [ ] `mesh_status` shows pending executions
- [ ] `mesh_connections` shows pending executions per peer
- [ ] Protocol validation test for both new message types
- [ ] Integration test: send `capability_execute` between two test nodes and verify pending state

## Blocked by

Issue 4 (capability registration and visibility)
