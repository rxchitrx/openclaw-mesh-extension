# OpenClaw Mesh Extension

A local offline GitHub — P2P project file sharing between OpenClaw nodes on the same network. No cloud server, no internet, no account required.

## What This Does

Turns multiple OpenClaw instances into a peer-to-peer file sharing system. Two people on the same WiFi can share project files directly — laptop to laptop — with conflict detection, peer approval, and fine-grained sync control.

**Key features:**

- Automatic peer discovery via subnet scanning + mDNS
- Peer approval flow (no one joins without your say-so)
- WebSocket P2P connections with real-time notifications
- Hash-based version tracking with conflict detection
- All file types supported (text + binary — images, PDFs, videos, etc.)
- Manifest-based diff, push, and pull
- File deletion detection with peer notification
- Works completely offline on LAN

## Prerequisites

- Node.js >= 22
- OpenClaw installed globally (`npm install -g openclaw`)
- Two machines on the same WiFi network

## Installation

### From Source

```bash
# Clone the repo
git clone https://github.com/rxchitrx/openclaw-mesh-extension.git
cd openclaw-mesh-extension

# Install dependencies
npm install

# Build TypeScript
npx tsc

# Install as an OpenClaw plugin
openclaw plugins install $(pwd)

# Restart the gateway
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
# Should show: mesh_discover, mesh_status, mesh_broadcast, mesh_sync, mesh_track, mesh_approve, mesh_diff, mesh_reject, mesh_connections, mesh_diff, mesh_events, mesh_ack
```

## Usage

You interact with the mesh by talking to the OpenClaw AI naturally. No slash commands needed.

### Quick Start

```
You: "Track my project at ~/projects/my-app"
You: "Who's on the mesh?"
You: "Approve friend-laptop"
You: "Show me differences with friend-laptop"
You: "Broadcast"
You: "Pull all from friend-laptop"
```

### 11 Tools

| Tool | What It Does | Example |
|------|-------------|---------|
| `mesh_track` | Set, change, or stop tracking a directory | "track ~/my-project" / "stop tracking" |
| `mesh_discover` | List all nodes visible on the mesh | "who's on the network?" |
| `mesh_status` | Full mesh state: peers, connections, pending approvals, files | "what's the mesh status?" |
| `mesh_approve` | Approve a pending peer connection | "approve friend-laptop" |
| `mesh_reject` | Deny a pending peer connection | "reject stranger-pc" |
| `mesh_connections` | Inspect peer connections and recent events | "show connections" |
| `mesh_diff` | Compare local vs remote manifest (local-only, remote-only, modified, conflicted) | "show differences with friend-laptop" |
| `mesh_broadcast` | Push local changes to all approved peers | "broadcast" / "broadcast index.ts" |
| `mesh_sync` | Manifest-based push/pull with a specific peer | "pull README.md from friend-laptop" / "push-all to friend-laptop" |
| `mesh_events` | List recent mesh events (unread, acknowledged) | "show mesh events" |
| `mesh_ack` | Acknowledge mesh notifications | "ack all mesh events" |

### Sync Actions

| Action | What It Does |
|--------|-------------|
| `manifest` | Exchange file lists with a peer |
| `push <file>` | Send one file to a peer |
| `pull <file>` | Request one file from a peer (blocked on conflict unless forced) |
| `push-all` | Send all files a peer doesn't have or has differently |
| `pull-all` | Request all files you don't have or have differently (skips conflicts) |

## How It Works

### Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                       OpenClaw Gateway                          │
│  ┌───────────────────────────────────────────────────────────┐ │
│  │                     Mesh Extension                         │ │
│  │                                                           │ │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐    │ │
│  │  │  Discovery   │  │  Transport   │  │  Sync State  │    │ │
│  │  │ (subnet scan │  │ (WebSocket)  │  │ (hash+ver)   │    │ │
│  │  │  + mDNS)     │  │  approval +  │  │ change track │    │ │
│  │  │              │  │  manifest +  │  │ + conflict   │    │ │
│  │  │              │  │  push/pull   │  │  detection   │    │ │
│  │  └──────────────┘  └──────────────┘  └──────────────┘    │ │
│  │         ▲                 ▲                 ▲             │ │
│  │         │                 │                 │             │ │
│  │  ┌──────┴──────┐   ┌─────┴─────┐    ┌──────┴──────┐     │ │
│  │  │   File      │   │   Mesh    │    │  Event      │     │ │
│  │  │  Watcher    │   │   Tools   │    │  Store      │     │ │
│  │  │ all files + │   │ (11 tools)│    │ (notif +    │     │ │
│  │  │ deletions + │   │           │    │  delivery)  │     │ │
│  │  │  binary     │   │           │    │             │     │ │
│  │  └─────────────┘   └───────────┘    └─────────────┘     │ │
│  └───────────────────────────────────────────────────────────┘ │
│                           ▲                                     │
│                     Tracked Directory                           │
│                   (user-chosen at runtime)                      │
└─────────────────────────────────────────────────────────────────┘
```

### Peer Discovery

On startup, the extension automatically scans the local subnet (all 254 IPs on /24) for other mesh nodes listening on port 18790. It also uses mDNS as a secondary discovery method. Discovered peers are auto-connected.

### Peer Connection Flow

```
Laptop A discovers Laptop B via subnet scan
        │
        ▼
Laptop A connects via WebSocket
        │
        ▼
Laptop B puts connection in PENDING state
        │
        ▼
Laptop B's chat: "Peer 'laptop-b' wants to join. Approve or deny?"
        │
        ▼
User says "approve laptop-b"
        │
        ▼
Connection promoted to APPROVED
        │
        ▼
Both sides auto-exchange:
  - node_info (tracking dir, file count)
  - manifest (file list with SHA-256 hashes)
```

### File Sync Flow

```
File changed in tracked directory
        │
        ▼
File Watcher detects change (text or binary)
        │
        ▼
SyncState records local change (hash + version)
        │
        ▼
User says "broadcast"
        │
        ▼
Transport sends file_content to all approved peers
  - Full file content (text as UTF-8, binary as base64)
  - Includes hash for conflict detection
        │
        ▼
Peer receives file_content:
  - If no conflict: write to disk, update sync state
  - If conflict (local was also modified): reject, notify user
```

### Conflict Handling

When both peers have modified the same file:

1. **Incoming push detected as conflict** — the transport checks `isConflict(path, remoteHash)`. If the local file was modified since the last sync AND the remote hash differs, it's a conflict.
2. **Local version is kept** — the incoming file is NOT written. A `file_conflict` notification tells the user.
3. **User decides** — they can force-pull to override, or keep their version.
4. **Pull blocks by default** — `pull` and `pull-all` refuse to overwrite locally-modified files. Use `force=true` to override.

### File Deletion Flow

```
User deletes file from tracked directory
        │
        ▼
File Watcher detects deletion
        │
        ▼
Transport sends "file_deleted" to all peers
        │
        ▼
Peers receive notification:
"Peer 'laptop-a' deleted old-module.ts. Keep your copy or delete locally?"
        │
        ▼
Peer decides — no automatic deletion
```

### Feedback Loop Prevention

When a received file is written to disk, the file watcher would normally detect it as a local change. To prevent this, `ignoreNextChange` is called before writing — the watcher uses a 2-second time window to suppress and properly update its cache for received files instead of recording them as local changes.

### Notifications

Mesh events are managed by an Event Store with priority-based delivery:

1. **Created** — events are added when something happens (peer request, file received, conflict, etc.)
2. **Delivered** — injected into the agent's conversation context with explicit instructions to notify the user
3. **Re-surfaced** — unacknowledged high-priority events (peer pending, conflict) are re-injected every 60 seconds
4. **Acknowledged** — via `mesh_ack` tool, stops surfacing

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
| `trackDir` | string | — | Directory to auto-track on startup (optional — can also set at runtime via mesh_track) |

## Protocol Messages

Messages sent between peers over WebSocket:

| Message | Direction | Purpose |
|---------|-----------|---------|
| `approval_request` | connector → listener | "I want to join the mesh" |
| `approval_response` | listener → connector | approve or deny |
| `node_info` | both | Node metadata (tracking dir, file count, file list) |
| `manifest` | both | File list with hashes and metadata |
| `manifest_request` | either | Ask peer for their manifest |
| `file_content` | either | Full file content for push/pull (includes hash for conflict detection) |
| `file_content_request` | either | Request a specific file from a peer |
| `file_deleted` | deleter → peers | Notification that a file was deleted |

## Demo Setup (2 Laptops)

### On Both Laptops

1. Install OpenClaw: `npm install -g openclaw`
2. Install mesh extension (see Installation above)
3. Make sure both are on the same WiFi network

### Laptop A

```
You: "Track my project at ~/projects/my-app"
You: "What's the mesh status?"
    → Shows: tracking ~/projects/my-app, 0 peers, STANDALONE
```

### Laptop B

```
You: "Track my project at ~/projects/shared-app"
You: "Who's on the mesh?"
    → Discovers: laptop-a
    → Auto-connects to laptop-a
```

### Laptop A (receives connection)

```
Chat notification: "Peer 'laptop-b' wants to join the mesh. Approve or deny?"
You: "Approve laptop-b"
    → Manifests and node info auto-exchanged
```

### Compare and Sync

```
You: "Show me differences with laptop-b"
    → Shows: 3 local-only, 1 remote-only, 2 modified, 0 conflicted, 5 in sync

You: "Pull all from laptop-b"
    → Requests 3 files (skips any conflicts)

You: "Broadcast"
    → Pushes all pending changes to laptop-b
    → Clears pending change list
```

## Technical Details

### Dependencies

| Package | Purpose |
|---------|---------|
| `@homebridge/ciao` | mDNS advertise (uses avahi D-Bus on Linux) |
| `bonjour-service` | mDNS browse for peer discovery |
| `ws` | WebSocket server and client for P2P connections |

### File Types

**All files are tracked**, not just text. The watcher handles:

- **Text files**: `.ts`, `.js`, `.py`, `.md`, `.json`, `.yaml`, `.html`, `.css`, `.sh`, and 30+ more extensions
- **Binary files**: `.png`, `.jpg`, `.mp4`, `.zip`, `.pdf`, `.exe`, `.wasm`, and more — sent as base64
- **Extensionless files**: Tracked and treated as text
- **Ignored**: `node_modules/`, `.git/`, `dist/`, `.DS_Store`, `Thumbs.db`

### Conflict Resolution

| File Type | Strategy | Behavior |
|-----------|----------|----------|
| Text | Keep local, notify | Incoming file is rejected if local was modified. User can force-pull to override. |
| Binary | Keep local, notify | Same as text — incoming binary is rejected on conflict. User can force-pull. |

### Sync State

Each file is tracked with:
- **Hash** — SHA-256 (16 hex chars) of file content
- **Version** — incremented on every change (local or remote)
- **Last synced hash** — the hash at the last successful sync point
- **Locally modified flag** — `currentHash !== lastSyncedHash`

A file is considered "in conflict" when it's locally modified AND an incoming push has a different hash.

### Port Usage

| Port | Service |
|------|---------|
| 18789 | OpenClaw Gateway (default) |
| 18790 | Mesh P2P WebSocket (configurable) |

### Hook Integration

| Hook | What It Does |
|------|-------------|
| `gateway_start` | Start discovery, transport, file watcher (if trackDir configured), auto-scan for peers after 5s |
| `gateway_stop` | Clean shutdown of all services |
| `heartbeat_prompt_contribution` | Auto-connect to discovered peers, maintain connections, report pending approvals/changes |

## Project Structure

```
openclaw-mesh-extension/
├── openclaw.plugin.json      # Plugin manifest
├── package.json              # Dependencies
├── tsconfig.json             # TypeScript config
├── index.ts                  # Entry point — wires everything together
├── dist/                     # Compiled JavaScript (committed for install)
└── src/
    ├── discovery.ts          # Subnet scanning + mDNS peer discovery
    ├── transport.ts          # WebSocket P2P (approval, manifest, push/pull, conflict detection)
    ├── sync-state.ts         # Hash+version tracking, conflict detection, pending changes
    ├── events.ts             # Event store with priority-based delivery and deduplication
    ├── file-watcher.ts       # Directory monitoring (all files, deletions, binary, ignore-next-change)
    └── tools/
        ├── discover.ts       # mesh_discover
        ├── status.ts         # mesh_status
        ├── broadcast.ts      # mesh_broadcast
        ├── sync.ts           # mesh_sync (push/pull with conflict safety)
        ├── track.ts          # mesh_track
        ├── approve.ts        # mesh_approve
        ├── reject.ts         # mesh_reject
        ├── connections.ts    # mesh_connections
        ├── diff.ts           # mesh_diff (local-only, remote-only, modified, conflicted)
        ├── events.ts         # mesh_events
        └── ack.ts            # mesh_ack
```

## Limitations

1. **No encryption** — Traffic is unencrypted on local network (LAN-only by design)
2. **No internet relay** — LAN only, no NAT traversal or relay server
3. **No partial sync** — Entire files are sent (no delta/diff compression)
4. **Single directory tracking** — Only one tracked directory at a time
5. **No auto-sync** — User must explicitly push, pull, or broadcast
6. **No push rejection feedback** — When a push is rejected due to conflict on the remote side, the sender isn't notified

## Why This Exists (vs GitHub)

| | GitHub | Mesh |
|---|---|---|
| Internet required | Yes | No |
| Central server | Yes | No (peer-to-peer) |
| Account needed | Yes | No |
| Setup friction | Create repo, commit, push, PR | Track folder, approve peer, broadcast |
| Real-time | No (push/pull cycle) | Yes (WebSocket, instant) |
| Works offline | No | Yes (on LAN) |
| Conflict resolution | Manual (merge conflicts) | Keep local + notify user |
| Privacy | Public by default | Private by default (only approved peers) |
| Binary files | Painful (LFS, size limits) | Native (base64, no size limits) |
| Granular sync | Clone entire repo | Push/pull individual files |

Mesh doesn't replace GitHub — it complements it. Use Mesh during active collaboration (hackathons, pair programming, offline work), then push to GitHub for persistence and the broader team.

## License

MIT

## Credits

- OpenClaw - https://openclaw.ai
- bonjour-service - https://github.com/onlxltd/bonjour-service
