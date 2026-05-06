# OpenClaw Mesh Extension

A local offline GitHub — P2P project file sharing between OpenClaw nodes on the same network. No cloud server, no internet, no account required.

## What This Does

Turns multiple OpenClaw instances into a peer-to-peer file sharing system. Two people on the same WiFi can share project files directly — laptop to laptop — with conflict-free merging, peer approval, and fine-grained sync control.

**Key features:**

- mDNS peer discovery (zero-config, like AirPrint/Bonjour)
- Peer approval flow (no one joins without your say-so)
- WebSocket P2P connections with real-time notifications
- Yjs CRDT for conflict-free text file merging
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

### Verify

```bash
openclaw plugins inspect mesh --runtime
# Should show: mesh_discover, mesh_status, mesh_broadcast, mesh_sync, mesh_track, mesh_approve, mesh_diff
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

### 7 Tools

| Tool | What It Does | Example |
|------|-------------|---------|
| `mesh_track` | Set, change, or stop tracking a directory | "track ~/my-project" / "stop tracking" |
| `mesh_discover` | List all nodes visible on the mesh | "who's on the network?" |
| `mesh_status` | Full mesh state: peers, connections, pending approvals, files | "what's the mesh status?" |
| `mesh_approve` | Approve or deny a pending peer connection | "approve friend-laptop" / "deny stranger-pc" |
| `mesh_diff` | Compare local vs remote manifest | "show differences with friend-laptop" |
| `mesh_broadcast` | Push local changes to all approved peers | "broadcast" / "broadcast index.ts" |
| `mesh_sync` | Manifest-based push/pull with a specific peer | "pull README.md from friend-laptop" / "push-all to friend-laptop" |

### Sync Actions

| Action | What It Does |
|--------|-------------|
| `manifest` | Exchange file lists with a peer |
| `push <file>` | Send one file to a peer |
| `pull <file>` | Request one file from a peer |
| `push-all` | Send all files a peer doesn't have or has differently |
| `pull-all` | Request all files you don't have or have differently |

## How It Works

### Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                       OpenClaw Gateway                          │
│  ┌───────────────────────────────────────────────────────────┐ │
│  │                     Mesh Extension                         │ │
│  │                                                           │ │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐    │ │
│  │  │  Discovery   │  │  Transport   │  │    CRDT      │    │ │
│  │  │   (mDNS)     │  │ (WebSocket)  │  │    (Yjs)     │    │ │
│  │  │  advertise + │  │  approval +  │  │  text merge + │    │ │
│  │  │   browse     │  │  manifest +  │  │  binary LWW  │    │ │
│  │  │              │  │  push/pull   │  │              │    │ │
│  │  └──────────────┘  └──────────────┘  └──────────────┘    │ │
│  │         ▲                 ▲                 ▲             │ │
│  │         │                 │                 │             │ │
│  │  ┌──────┴──────┐   ┌─────┴─────┐    ┌──────┴──────┐     │ │
│  │  │   File      │   │   Mesh    │    │  Next-Turn  │     │ │
│  │  │  Watcher    │   │   Tools   │    │  Injection  │     │ │
│  │  │ all files + │   │  (7 tools)│    │ (notifications)│   │ │
│  │  │ deletions + │   │           │    │             │     │ │
│  │  │  binary     │   │           │    │             │     │ │
│  │  └─────────────┘   └───────────┘    └─────────────┘     │ │
│  └───────────────────────────────────────────────────────────┘ │
│                           ▲                                     │
│                     Tracked Directory                           │
│                   (user-chosen at runtime)                      │
└─────────────────────────────────────────────────────────────────┘
```

### Peer Connection Flow

```
Laptop A discovers Laptop B via mDNS
        │
        ▼
Laptop A connects via WebSocket
        │
        ▼
Laptop B puts connection in PENDING state
        │
        ▼
Laptop B's chat: "Peer 'laptop-a' wants to join. Approve or deny?"
        │
        ▼
User says "approve laptop-a"
        │
        ▼
Connection promoted to APPROVED
        │
        ▼
Both sides auto-exchange manifests
(file lists with SHA-256 hashes)
        │
        ▼
User: "diff with laptop-a" → shows local-only, remote-only, modified
User: "broadcast" → pushes all pending changes
User: "pull all from laptop-a" → requests all remote files
```

### File Sync Flow

```
File changed in tracked directory
        │
        ▼
File Watcher detects change (text or binary)
        │
        ▼
CRDT applies local change → creates delta
  - Text files: Yjs CRDT merge (character-level)
  - Binary files: last-writer-wins
        │
        ▼
User says "broadcast"
        │
        ▼
Transport sends delta to all approved peers
  - Text: CRDT delta
  - Binary: base64-encoded full content
        │
        ▼
Peer receives → CRDT merges (text) or overwrites (binary)
        │
        ▼
If conflict (both edited same text file):
  CRDT merges both edits + notification:
  "Both you and 'laptop-a' edited index.ts — you may want to review."
```

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

### Reconnection

- Approved peers are remembered — auto-approved on reconnect
- Manifests are re-exchanged on reconnection
- On gateway restart, the file watcher re-scans the entire tracked directory from scratch
- The filesystem is the source of truth — no need to persist pending deltas

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
| `manifest` | both | File list with hashes and metadata |
| `manifest_request` | either | Ask peer for their manifest |
| `delta` | broadcaster → peers | CRDT delta for a text file |
| `file_content` | either | Full file content for push/pull (has `isBinary` and `base64` fields) |
| `file_content_request` | either | Request a specific file from a peer |
| `file_deleted` | deleter → peers | Notification that a file was deleted |
| `conflict_notification` | either | "We both edited the same file" |

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
    → Manifests auto-exchanged
```

### Compare and Sync

```
You: "Show me differences with laptop-b"
    → Shows: 3 local-only, 1 remote-only, 2 modified, 5 in sync

You: "Pull all from laptop-b"
    → Requests 3 files

You: "Broadcast"
    → Pushes all pending changes to laptop-b
```

## Technical Details

### Dependencies

| Package | Purpose |
|---------|---------|
| `yjs` | CRDT implementation for conflict-free text merging |
| `bonjour-service` | mDNS advertise + browse for peer discovery |
| `ws` | WebSocket server and client for P2P connections |

### File Types

**All files are tracked**, not just text. The watcher handles:

- **Text files**: `.ts`, `.js`, `.py`, `.md`, `.json`, `.yaml`, `.html`, `.css`, `.sh`, and 30+ more extensions — merged via Yjs CRDT at character level
- **Binary files**: `.png`, `.jpg`, `.mp4`, `.zip`, `.pdf`, `.exe`, `.wasm`, and more — sent as base64, last-writer-wins on conflict
- **Extensionless files**: Tracked and treated as text
- **Ignored**: `node_modules/`, `.git/`, `dist/`, `.DS_Store`, `Thumbs.db`

### Conflict Resolution

| File Type | Strategy | Behavior |
|-----------|----------|----------|
| Text | Yjs CRDT | Character-level merge — both edits coexist, no data loss. User notified to review. |
| Binary | Last-writer-wins | Whoever broadcasted most recently, their version wins. |

### Notifications

Real-time events (peer requests, deletions, conflicts) are delivered via `enqueueNextTurnInjection` — injected into the AI's next conversation turn so you see them immediately in chat.

Periodic events (stale peer cleanup, auto-connect to discovered peers, pending delta summary) run on the heartbeat hook.

### Port Usage

| Port | Service |
|------|---------|
| 18789 | OpenClaw Gateway (default) |
| 18790 | Mesh P2P WebSocket (configurable) |

### Hook Integration

| Hook | What It Does |
|------|-------------|
| `gateway_start` | Start discovery, transport, file watcher (if trackDir configured) |
| `gateway_stop` | Clean shutdown of all services |
| `heartbeat_prompt_contribution` | Auto-connect to discovered peers, maintain connections, cleanup stale peers, report pending approvals/deltas |

## Project Structure

```
openclaw-mesh-extension/
├── openclaw.plugin.json      # Plugin manifest
├── package.json              # Dependencies
├── tsconfig.json             # TypeScript config
├── index.ts                  # Entry point — wires everything together
├── dist/                     # Compiled JavaScript (committed for install)
└── src/
    ├── discovery.ts          # mDNS peer discovery (advertise + browse)
    ├── transport.ts          # WebSocket P2P (approval, manifest, push/pull, notifications)
    ├── crdt.ts               # Yjs CRDT for text + binary file state
    ├── file-watcher.ts       # Directory monitoring (all files, deletions, binary)
    └── tools/
        ├── discover.ts       # mesh_discover
        ├── status.ts         # mesh_status
        ├── broadcast.ts      # mesh_broadcast
        ├── sync.ts           # mesh_sync
        ├── track.ts          # mesh_track
        ├── approve.ts        # mesh_approve
        └── diff.ts           # mesh_diff
```

## Limitations

1. **No encryption** — Traffic is unencrypted on local network (LAN-only by design)
2. **No internet relay** — LAN only, no NAT traversal or relay server
3. **No partial sync for binary** — Entire binary files are sent (no delta compression)
4. **Manifest conflicts** — If both peers edit the same binary file, last-writer-wins with no notification to the losing side
5. **Single directory tracking** — Only one tracked directory at a time

## Why This Exists (vs GitHub)

| | GitHub | Mesh |
|---|---|---|
| Internet required | Yes | No |
| Central server | Yes | No (peer-to-peer) |
| Account needed | Yes | No |
| Setup friction | Create repo, commit, push, PR | Track folder, approve peer, broadcast |
| Real-time | No (push/pull cycle) | Yes (WebSocket, instant) |
| Works offline | No | Yes (on LAN) |
| Conflict resolution | Manual (merge conflicts) | Automatic (CRDT for text, LWW for binary) |
| Privacy | Public by default | Private by default (only approved peers) |
| Binary files | Painful (LFS, size limits) | Native (base64, no size limits) |
| Granular sync | Clone entire repo | Push/pull individual files |

Mesh doesn't replace GitHub — it complements it. Use Mesh during active collaboration (hackathons, pair programming, offline work), then push to GitHub for persistence and the broader team.

## License

MIT

## Credits

- OpenClaw - https://openclaw.ai
- Yjs - https://yjs.dev
- bonjour-service - https://github.com/onlxltd/bonjour-service
