# OpenClaw Mesh Extension

P2P distributed file sync between OpenClaw nodes. No cloud server required.

## What This Does

Turns multiple OpenClaw instances into a distributed system that syncs files automatically over local WiFi.

**Features:**
- mDNS peer discovery (zero-config, like AirPrint/Bonjour)
- WebSocket P2P connections
- Yjs CRDT for conflict-free merging
- Automatic file watching and sync
- Works offline, merges when reconnected

## Prerequisites

- Node.js >= 22
- OpenClaw installed globally (`npm install -g openclaw`)
- Two machines on the same WiFi network

## Installation

### Step 1: Locate OpenClaw Installation

```bash
# Find where OpenClaw is installed
which openclaw

# Usually one of these locations:
# macOS (Homebrew): /opt/homebrew/lib/node_modules/openclaw
# macOS (default): /usr/local/lib/node_modules/openclaw
# Linux: /usr/lib/node_modules/openclaw
# Windows: C:\Users\<user>\AppData\Roaming\npm\node_modules\openclaw
```

### Step 2: Clone the Extension

```bash
# Navigate to OpenClaw extensions folder
cd /opt/homebrew/lib/node_modules/openclaw/extensions

# Clone this repo as "mesh"
git clone https://github.com/rxchitrx/openclaw-mesh-extension.git mesh

# Navigate into the extension folder
cd mesh
```

### Step 3: Install Dependencies

```bash
# From the mesh folder
pnpm install

# If pnpm is not installed:
# npm install -g pnpm
```

### Step 4: Rebuild OpenClaw

```bash
# Go back to OpenClaw root
cd /opt/homebrew/lib/node_modules/openclaw

# Rebuild to include the new extension
pnpm build
```

### Step 5: Restart OpenClaw Gateway

```bash
# Stop the running gateway
openclaw gateway stop

# Start it again
openclaw gateway start
```

## Verification

After installation, verify the extension is loaded:

```bash
# Check if mesh tools are available
openclaw agent --message "mesh_status"
```

Expected response:
```
📍 Local Node: node-<pid>
🌐 Address: <local-ip>:18790
🔗 Connections: 0/0
📁 Synced Files: 0
...
```

## Usage

### Tools Available

| Tool | Description |
|------|-------------|
| `mesh_discover` | List all nodes visible on the mesh |
| `mesh_status` | Show local mesh state (connections, files, pending deltas) |
| `mesh_broadcast` | Force push local changes to all peers |
| `mesh_sync` | Pull and merge remote changes from peers |

### Example Commands

```bash
# Discover other nodes
openclaw agent --message "Who is on the mesh?"

# Check sync status
openclaw agent --message "What is the mesh status?"

# Force sync
openclaw agent --message "Sync all files with the mesh"
```

## How It Works

### Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      OpenClaw Gateway                        │
│  ┌─────────────────────────────────────────────────────┐   │
│  │                  Mesh Extension                       │   │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  │   │
│  │  │  Discovery  │  │  Transport  │  │    CRDT     │  │   │
│  │  │   (mDNS)    │  │ (WebSocket) │  │    (Yjs)    │  │   │
│  │  └─────────────┘  └─────────────┘  └─────────────┘  │   │
│  │                     ▲                ▲               │   │
│  │                     │                │               │   │
│  │              ┌──────┴──────┐   ┌─────┴─────┐        │   │
│  │              │  File       │   │   Mesh    │        │   │
│  │              │  Watcher    │   │   Tools   │        │   │
│  │              └─────────────┘   └───────────┘        │   │
│  └─────────────────────────────────────────────────────┘   │
│                         ▲                                   │
│                    Workspace Dir                            │
│                  (~/.openclaw/workspace)                    │
└─────────────────────────────────────────────────────────────┘
```

### Lifecycle

1. **Gateway Start** (`gateway_start` hook)
   - Discovery service starts advertising via mDNS
   - Transport server starts listening on port 18790
   - File watcher begins scanning workspace

2. **Heartbeat** (`heartbeat_prompt_contribution` hook)
   - Discovery scans for new peers
   - Transport maintains connections
   - CRDT syncs pending deltas

3. **Gateway Stop** (`gateway_stop` hook)
   - All services shut down cleanly

### File Sync Flow

```
File changed in workspace
        │
        ▼
File Watcher detects change
        │
        ▼
CRDT applies local change → creates delta
        │
        ▼
Transport broadcasts delta to all connected peers
        │
        ▼
Peer receives delta → CRDT merges → file updated
```

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
          "workspaceDir": "~/.openclaw/workspace"
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
| `port` | number | `18790` | Port for P2P connections |
| `workspaceDir` | string | OpenClaw workspace | Directory to sync |

## Demo Setup (2 Laptops)

### On Both Laptops

1. Install OpenClaw: `npm install -g openclaw`
2. Install mesh extension (see Installation above)
3. Note your local IP: `ifconfig | grep "inet " | grep -v 127.0.0.1`

### Laptop A

```bash
# Start OpenClaw
openclaw gateway start

# Create a test file
echo "Hello from Laptop A" > ~/.openclaw/workspace/mesh-test.md

# Check status
openclaw agent --message "mesh_status"
```

### Laptop B

```bash
# Start OpenClaw
openclaw gateway start

# Check for Laptop A
openclaw agent --message "mesh_discover"

# Should show Laptop A in the peer list
```

### Verify Sync

```bash
# On Laptop B, check if the file synced
openclaw agent --message "mesh_status"

# Should show synced files
```

## Troubleshooting

### Extension Not Loading

```bash
# Check if extension is in the right place
ls /opt/homebrew/lib/node_modules/openclaw/extensions/mesh

# Should see: index.ts, package.json, openclaw.plugin.json, src/

# Check if it was bundled
ls /opt/homebrew/lib/node_modules/openclaw/dist/extensions/mesh

# Should see: index.js, package.json, openclaw.plugin.json
```

### No Peers Discovered

1. **Same WiFi?** Both laptops must be on the same network
2. **Firewall?** macOS may block incoming connections
   - System Settings → Privacy & Security → Local Network
   - Allow OpenClaw/Node
3. **mDNS working?** Test with:
   ```bash
   # Should show other machines
   dns-sd -B _openclaw-mesh._tcp
   ```

### Tools Not Available

```bash
# Check if mesh extension loaded
openclaw agent --message "What tools do you have?"

# Look for mesh_discover, mesh_status, mesh_broadcast, mesh_sync
```

### Build Errors

```bash
# Clean and rebuild
cd /opt/homebrew/lib/node_modules/openclaw
rm -rf node_modules/.cache dist
pnpm install
pnpm build
```

## Technical Details

### Dependencies

| Package | Purpose |
|---------|---------|
| `yjs` | CRDT implementation for conflict-free merging |
| `@homebridge/ciao` | mDNS/Bonjour for peer discovery |
| `ws` | WebSocket for P2P connections |

### File Types Synced

Text files only (for now):
- `.md`, `.txt`, `.json`
- `.ts`, `.js`, `.tsx`, `.jsx`
- `.yml`, `.yaml`, `.toml`
- `.html`, `.css`, `.xml`
- `.sh`, `.bash`, `.zsh`

Ignored:
- `node_modules/`
- `.git/`
- `dist/`
- Binary files (images, PDFs, etc.)

### Port Usage

| Port | Service |
|------|---------|
| 18789 | OpenClaw Gateway (default) |
| 18790 | Mesh P2P WebSocket (configurable) |

### Hook Integration

The extension registers these OpenClaw hooks:

| Hook | Purpose |
|------|---------|
| `gateway_start` | Start discovery, transport, file watcher |
| `gateway_stop` | Clean shutdown of all services |
| `heartbeat_prompt_contribution` | Periodic peer scan and sync |

## Limitations (Current)

1. **No binary file sync** - Only text files
2. **No encryption** - Traffic is unencrypted on local network
3. **No authentication** - Any node on the WiFi can join
4. **No partial sync** - Entire files are synced, not diffs
5. **No conflict resolution UI** - CRDT merges automatically, no user choice

## Development

### Project Structure

```
extensions/mesh/
├── openclaw.plugin.json    # Plugin manifest
├── package.json            # Dependencies
├── tsconfig.json           # TypeScript config
├── index.ts                # Entry point
└── src/
    ├── discovery.ts        # mDNS peer discovery
    ├── transport.ts        # WebSocket P2P
    ├── crdt.ts             # Yjs file sync
    ├── file-watcher.ts     # Workspace monitoring
    └── tools/
        ├── discover.ts     # mesh_discover tool
        ├── status.ts       # mesh_status tool
        ├── broadcast.ts    # mesh_broadcast tool
        └── sync.ts         # mesh_sync tool
```

### Key Files

**`index.ts`** - Main plugin registration
- Creates all services
- Registers tools with OpenClaw
- Hooks into gateway lifecycle

**`discovery.ts`** - Peer discovery
- Advertises self via mDNS
- Listens for other nodes
- Maintains peer list

**`transport.ts`** - P2P connections
- WebSocket server for incoming connections
- WebSocket client for outgoing connections
- Message routing (deltas, sync requests)

**`crdt.ts`** - Conflict-free sync
- Yjs document per file
- Applies local changes
- Merges remote deltas

**`file-watcher.ts`** - File monitoring
- Watches workspace directory
- Detects changes
- Triggers CRDT updates

## Known Issues

1. **mDNS may not work on all networks**
   - Corporate networks often block multicast
   - Guest WiFi may isolate devices

2. **Large files cause performance issues**
   - Current implementation syncs entire file content
   - Better diffing planned

3. **No reconnection handling**
   - If a peer disconnects, must wait for next discovery

## License

MIT

## Credits

- OpenClaw - https://openclaw.ai
- Yjs - https://yjs.dev
- @homebridge/ciao - https://github.com/homebridge/ciao
