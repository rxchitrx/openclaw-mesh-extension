# Capability execution: respond and result delivery

## What to build

The "response side" of the capability execution feature. Provides the tool for the receiving agent to send the result back, wires the full execution loop through the agent integration layer, and notifies both parties of the outcome.

A new `mesh_capability_respond` tool:
- Parameters: `requestId` (string), `result` (optional string), `error` (optional string)
- Agent calls this after running the delegated task (or if user denies)
- Sends a `capability_execute_result` message back to the requesting peer
- On send success, creates a `capability_execute_completed` event for the local user

Agent integration in `index.ts`:
- Incoming `capability_execute` → stores as pending → enqueues `capability_execute_requested` event → agent gets urgent notification
- Agent surfaces to user: "Peer 'B' wants you to run [instruction] using [capability]. Approve?"
- If approved, agent runs the task
- Agent calls `mesh_capability_respond` with the result
- On receive of `capability_execute_result` → resolves pending → creates `capability_execute_completed` event → surfaces to requesting agent

Notification behavior:
- When execution completes: both the requesting user and the executing user get notified
- When denied: a `capability_execute_result` with an `error` field is sent, so the requester knows immediately instead of waiting 60 seconds
- When timeout fires (from issue 6): the requester gets notified of the timeout

## Acceptance criteria

- [ ] `mesh_capability_respond` tool exists with `requestId`, `result`, and `error` parameters
- [ ] Tool sends `capability_execute_result` message back to the requesting peer
- [ ] Incoming `capability_execute_result` resolves the pending execution and creates a `capability_execute_completed` event
- [ ] Agent receives urgent notification for incoming execution requests
- [ ] Both requesting and executing users are notified when execution completes
- [ ] Denial sends an immediate error response back to the requester
- [ ] End-to-end integration test: node A sends `capability_execute` → node B agent approves → responds with result → node A receives result notification
- [ ] Negative test: node A sends `capability_execute` → node B denies → node A receives denial notification

## Blocked by

Issue 6 (capability execution: inbound request handling)
