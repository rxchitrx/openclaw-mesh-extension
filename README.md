# OpenClaw Mesh Extension

A local offline GitHub for OpenClaw nodes on the same network. No cloud server, no internet, no account required.

## What This Does

Turns multiple OpenClaw instances into a peer-to-peer file sharing system. Two people on the same WiFi can share project files directly with peer approval, manifest exchange, immediate event notifications, hash-based conflict detection, and fine-grained sync control.

## Demo

Video walkthrough: [assets/timeline-demo.mov](./assets/timeline-demo.mov)

**Key features:**

- Automatic peer discovery via subnet scanning + mDNS
- Transport-first peer presence tracking when a peer connects inbound
- Peer approval flow (no one joins without your say-so)
- WebSocket P2P connections with session-based notifications
- Hash-based version tracking with conflict detection
- All file types supported (text + binary: images, PDFs, videos, etc.)
- GitHub-style unified text diffs with binary summaries
- Manifest-based diff, push, pull, and remote preview
- Node info and manifest exchange on connect/reconnect
- File-applied confirmations so the sender knows the receiver wrote a file to disk
- File-rejected notifications so failed/conflicted pushes do not look synced
- File deletion detection with peer notification
- Works completely offline on LAN

## Prerequisites

- Node.js >= 22
- OpenClaw installed globally (`npm install -g openclaw`)
- Two machines on the same WiFi network

## Installation

### From Source

```bash
git clone https://github.com/rxchitrx/openclaw-mesh-extension.git
cd openclaw-mesh-extension
npm install
npm run build
openclaw plugins install $(pwd)
openclaw gateway restart
```

**Note:** If `openclaw plugins install` blocks due to `child_process` detection, you can manually install:

```bash
mkdir -p ~/.openclaw/extensions/mesh
cp -r ./* ~/.openclaw/extensions/mesh/
cp -r node_modules ~/.openclaw/extensions/mesh/
openclaw gateway restart
```

### Verify

```bash
openclaw plugins inspect mesh --runtime
```

Expected tools include `mesh_discover`, `mesh_status`, `mesh_broadcast`, `mesh_sync`, `mesh_track`, `mesh_approve`, `mesh_reject`, `mesh_connections`, `mesh_diff`, `mesh_events`, and `mesh_ack`.

## Usage

You interact with the mesh by talking to the OpenClaw AI naturally. No slash commands needed.

### Quick Start

```text
You: "Track my project at ~/projects/my-app"
You: "Who's on the mesh?"
You: "Approve friend-laptop"
You: "Show me differences with friend-laptop"
You: "Broadcast"
You: "Pull all from friend-laptop"
```

### Mesh Tools

| Tool | What It Does | Example |
|------|-------------|---------|
| `mesh_track` | Set, change, or stop tracking a directory | "track ~/my-project" / "stop tracking" |
| `mesh_discover` | List all nodes visible on the mesh | "who's on the network?" |
| `mesh_status` | Full mesh state: peers, connections, pending approvals, events, files, and remote node info | "what's the mesh status?" |
| `mesh_approve` | Approve a pending peer connection | "approve friend-laptop" |
| `mesh_reject` | Reject a pending peer connection | "reject stranger-pc" |
| `mesh_connections` | Inspect active/pending connections, remote tracking info, apply confirmations, and last peer events | "show mesh connections" |
| `mesh_diff` | Compare local vs remote files with GitHub-style unified text patches and binary summaries | "show differences with friend-laptop" |
| `mesh_broadcast` | Push local changes to all approved peers | "broadcast" / "broadcast index.ts" |
| `mesh_sync` | Manifest-based push/pull with a specific peer | "pull README.md from friend-laptop" / "push-all to friend-laptop" |
| `mesh_events` | List unread and recent mesh events | "show mesh events" |
| `mesh_ack` | Acknowledge one event or all unread mesh events | "ack all mesh events" |

### Sync Actions

| Action | What It Does |
|--------|-------------|
| `manifest` | Exchange file lists with a peer |
| `push <file>` | Send one file to a peer |
| `pull <file>` | Request one file from a peer; blocked on conflict unless forced |
| `push-all` | Send all files a peer does not have or has differently |
| `pull-all` | Request all files you do not have or have differently; skips conflicts |

## How It Works

### Architecture

```text
OpenClaw Gateway
  Mesh Extension
    Discovery: subnet scan + mDNS advertise/browse
    Transport: WebSocket approval, manifest exchange, push/pull
    Sync State: hash/version tracking, pending changes, conflict detection
    Event Store: queued notifications, delivery, acknowledgement
    File Watcher: all files, deletions, binary support, feedback-loop suppression
    Mesh Tools: status, discover, approve/reject, sync, diff, events, ack
```

### Peer Discovery

On startup, the extension scans the local subnet for other mesh nodes listening on port `18790`. It also uses mDNS as a secondary discovery method. Discovered peers are auto-connected.

### Peer Connection Flow

```text
Laptop A discovers Laptop B via subnet scan or mDNS
Laptop A connects via WebSocket
Laptop B stores the connection as pending
Laptop B surfaces a pending approval event
User approves Laptop A
Both sides exchange node_info and manifests
Both sides can now diff, push, pull, and broadcast files
```

### File Sync Flow

```text
File changes in tracked directory
File watcher records the change in SyncState
User broadcasts, pushes, or pulls
Transport sends file_content with content hash
Receiver checks for conflict
Receiver writes file if safe
Receiver sends file_applied after disk write succeeds
Sender records remote apply confirmation
Sender clears pending state only after matching apply confirmations arrive
```

### Conflict Handling

When both peers have modified the same file:

1. Incoming push is checked with `syncState.isConflict(path, remoteHash)`.
2. If local changes would be overwritten, the incoming file is not written.
3. A conflict event is queued for the user.
4. `pull` and `pull-all` refuse to overwrite locally modified files unless a force path is used.

### Feedback Loop Prevention

When a received file is written to disk, the file watcher would normally detect it as a local change. The extension calls `ignoreNextChange` before writing, so the watcher suppresses that next filesystem event and updates its cache instead of treating the remote write as a new local edit.

### Notifications

Mesh events are managed by an in-memory event store:

1. **Created**: peer requests, approvals, disconnects, manifests, file writes, apply confirmations, rejections, sync failures, and conflicts create events.
2. **Delivered**: queued events are injected into the current active OpenClaw session.
3. **Repeated**: unacknowledged events can re-surface with throttling.
4. **Acknowledged**: `mesh_ack` marks events acknowledged so they stop repeating.

If there is no active session available, events stay queued and remain visible through `mesh_status` and `mesh_events`.

### Reconnection

- Approved peers are remembered and auto-approved on reconnect.
- Node info and manifests are re-exchanged on reconnection.
- The file watcher re-scans the tracked directory after gateway restart.
- The filesystem plus SyncState are the source of truth for pending changes.

## Configuration

Add to your `~/.openclaw/openclaw.json`:

```json
{
  "plugins": {
    "entries": {
      "mesh": {
        "enabled": true,
        "config": {
          "nodeName": "my-laptop",
          "port": 18790,
          "trackDir": "~/projects/my-app"
        }
      }
    }
  }
}
```

### Config Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `enabled` | boolean | `true` | Enable/disable the mesh |
| `nodeName` | string | `node-<pid>` | Unique name for this node |
| `port` | number | `18790` | Port for P2P WebSocket connections |
| `trackDir` | string | none | Directory to auto-track on startup; can also be set at runtime with `mesh_track` |

## Protocol Messages

Messages sent between peers over WebSocket:

| Message | Direction | Purpose |
|---------|-----------|---------|
| `approval_request` | connector to listener | Request to join the mesh |
| `approval_response` | listener to connector | Approve or deny |
| `node_info` | both | Current tracking directory, file count, and file list |
| `manifest` | both | File list with hashes and metadata |
| `manifest_request` | either | Ask peer for their manifest |
| `file_preview_request` | diff viewer to peer | Request file content for preview only; does not write locally |
| `file_preview_response` | peer to diff viewer | Return file preview content, binary flag, and hash |
| `file_content` | either | Full file content for push/pull, including hash for conflict detection |
| `file_content_request` | either | Request a specific file from a peer |
| `file_applied` | receiver to sender | Confirmation that a received file was written to disk |
| `file_rejected` | receiver to sender | Notification that a pushed file was blocked by conflict or write failure |
| `file_deleted` | deleter to peers | Notification that a file was deleted |

## Demo Setup

### On Both Laptops

1. Install OpenClaw: `npm install -g openclaw`
2. Install the mesh extension
3. Make sure both laptops are on the same WiFi network

### Laptop A

```text
You: "Track my project at ~/projects/my-app"
You: "What's the mesh status?"
    -> Shows tracking path, local node, peers, events, and pending changes
```

### Laptop B

```text
You: "Track my project at ~/projects/shared-app"
You: "Who's on the mesh?"
    -> Discovers laptop-a
    -> Auto-connects to laptop-a
```

### Laptop A Receives Connection

```text
Chat notification: "Peer 'laptop-b' wants to join the mesh. Approve or deny?"
You: "Approve laptop-b"
    -> Node info and manifests auto-exchange
```

### Compare and Sync

```text
You: "Show me differences with laptop-b"
    -> Shows local-only, remote-only, modified, conflicted, and in-sync counts
    -> Includes unified text patches for safe-size text files

You: "Pull all from laptop-b"
    -> Requests files while skipping conflicts

You: "Broadcast"
    -> Pushes pending local changes
    -> Remote sends file_applied confirmations after disk writes
    -> Local pending state clears after matching confirmations
```

## Technical Details

### Dependencies

| Package | Purpose |
|---------|---------|
| `@homebridge/ciao` | mDNS advertise, including Avahi D-Bus support on Linux |
| `bonjour-service` | mDNS browse for peer discovery |
| `ws` | WebSocket server and client for P2P connections |

### File Types

All files are tracked, not just text:

- Text files are sent as UTF-8 content.
- Binary files are sent as base64.
- Extensionless files are tracked.
- Ignored paths include `node_modules/`, `.git/`, `dist/`, `.DS_Store`, and `Thumbs.db`.

### Sync State

Each tracked file stores:

- Hash: SHA-256 content hash
- Version: incremented on every local or remote change
- Last synced hash: hash at the last successful sync point
- Locally modified flag: whether current hash differs from last synced hash

A file is considered in conflict when it is locally modified and an incoming push has a different hash.

### Diff Preview

`mesh_diff` generates previews on demand:

- Text files use unified hunks with configurable context lines.
- Binary files show hash and size summaries.
- Large text files are summarized instead of dumped into chat.
- Remote file content is fetched through `file_preview_request`, which never writes to disk.

### Port Usage

| Port | Service |
|------|---------|
| `18789` | OpenClaw Gateway default |
| `18790` | Mesh P2P WebSocket default |

### Hook Integration

| Hook | What It Does |
|------|-------------|
| `gateway_start` | Start discovery, transport, file watcher, and delayed auto-scan |
| `gateway_stop` | Clean shutdown of all services |
| `heartbeat_prompt_contribution` | Auto-connect to discovered peers, maintain connections, and surface queued notifications |

## Project Structure

```text
openclaw-mesh-extension/
├── openclaw.plugin.json
├── package.json
├── tsconfig.json
├── index.ts
├── dist/
└── src/
    ├── discovery.ts
    ├── diff-engine.ts
    ├── transport.ts
    ├── sync-state.ts
    ├── events.ts
    ├── file-watcher.ts
    └── tools/
        ├── discover.ts
        ├── status.ts
        ├── broadcast.ts
        ├── sync.ts
        ├── track.ts
        ├── approve.ts
        ├── reject.ts
        ├── connections.ts
        ├── diff.ts
        ├── events.ts
        └── ack.ts
```

## Limitations

1. **No encryption**: traffic is unencrypted on the local network.
2. **No internet relay**: LAN only, no NAT traversal or relay server.
3. **No partial sync**: entire files are sent, not binary or text patches.
4. **Single directory tracking**: only one tracked directory at a time.
5. **No automatic background file syncing**: users explicitly push, pull, or broadcast.
6. **Notification delivery is session-based**: immediate visibility needs an active OpenClaw session.

## Why This Exists vs GitHub

| | GitHub | Mesh |
|---|---|---|
| Internet required | Yes | No |
| Central server | Yes | No, peer-to-peer |
| Account needed | Yes | No |
| Setup friction | Create repo, commit, push, PR | Track folder, approve peer, broadcast |
| Real-time | No, push/pull cycle | Yes, WebSocket events |
| Works offline | No | Yes, on LAN |
| Conflict resolution | Manual merge conflicts | Keep local + notify user |
| Privacy | Public by default | Private by default, approved peers only |
| Binary files | Painful without LFS | Native base64 transfer |
| Granular sync | Clone entire repo | Push/pull individual files |

Mesh does not replace GitHub. It complements it during active collaboration, hackathons, pair programming, and offline work, then GitHub can remain the long-term source of truth.

## Presentation

The hackathon deck is included in the repo root:

- [RVCE_MergeMind.pptx](/Users/rachit/.openclaw/extensions/mesh/RVCE_MergeMind.pptx)

## License

MIT

## AI Disclosure

This project was developed with assistance from OpenAI's Codex during implementation, debugging, documentation, and repo hygiene work. Core technical decisions, testing, and approval to publish were made by the repository owner. The final extension code and presentation content were reviewed and committed intentionally for this hackathon submission.

## Credits

- OpenClaw: https://openclaw.ai
- bonjour-service: https://github.com/onlxltd/bonjour-service
