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
- OpenClaw installed globally (`npm install -g openclaw` or `pnpm add -g openclaw`)
- Two machines on the same WiFi network

## Installation

### Step 1: Find Your OpenClaw Installation

Run this command to discover where OpenClaw is installed:

```bash
# Find the openclaw binary
which openclaw
# or
where openclaw    # Windows PowerShell
```

Then find the installation directory:

```bash
# macOS/Linux
ls -la $(dirname $(dirname $(which openclaw)))/lib/node_modules/openclaw

# Windows (PowerShell)
Get-ChildItem (Split-Path (Split-Path (Get-Command openclaw).Source) -Parent) -ChildPath "node_modules\openclaw"
```

**Common locations:**

| Platform | Typical Path |
|----------|--------------|
| macOS (Homebrew) | `/opt/homebrew/lib/node_modules/openclaw` |
| macOS (default npm) | `/usr/local/lib/node_modules/openclaw` |
| Linux (npm) | `/usr/lib/node_modules/openclaw` |
| Linux (nvm) | `~/.nvm/versions/node/<version>/lib/node_modules/openclaw` |
| Windows (npm) | `C:\Users\<user>\AppData\Roaming\npm\node_modules\openclaw` |
| Windows (pnpm) | `C:\Users\<user>\AppData\Local\pnpm\global\<version>\node_modules\openclaw` |

**The key is to find the `extensions` folder inside the OpenClaw installation.**

You can verify you found the right place:

```bash
# Should list other extensions like discord, telegram, whatsapp
ls <openclaw-install-path>/extensions/
```

### Step 2: Clone the Extension

```bash
# Navigate to the extensions folder you found in Step 1
cd <openclaw-install-path>/extensions

# Clone this repo as "mesh"
git clone https://github.com/rxchitrx/openclaw-mesh-extension.git mesh

# Navigate into the extension folder
cd mesh
```

### Step 3: Install Dependencies

```bash
# From the mesh folder (where you are now)
pnpm install

# If pnpm is not installed:
npm install -g pnpm
# then run pnpm install
```

### Step 4: Rebuild OpenClaw

```bash
# Go back to OpenClaw root (the folder you found in Step 1)
cd <openclaw-install-path>

# Rebuild to include the new extension
pnpm build
```

### Step 5: Restart OpenClaw Gateway

```bash
# Stop the running gateway (if any)
openclaw gateway stop

# Start it again
openclaw gateway start
```

## Quick Install Script

If you're comfortable with shell scripts, here's a quick installer:

```bash
#!/bin/bash
# Run this after installing OpenClaw globally

# Find OpenClaw installation
OPENCLAW_PATH=$(dirname $(dirname $(which openclaw)))/lib/node_modules/openclaw

if [ ! -d "$OPENCLAW_PATH" ]; then
  echo "Could not find OpenClaw installation"
  echo "Please install with: npm install -g openclaw"
  exit 1
fi

echo "Found OpenClaw at: $OPENCLAW_PATH"

# Clone extension
cd "$OPENCLAW_PATH/extensions"
git clone https://github.com/rxchitrx/openclaw-mesh-extension.git mesh

# Install dependencies
cd mesh
pnpm install

# Rebuild OpenClaw
cd "$OPENCLAW_PATH"
pnpm build

echo "Mesh extension installed!"
echo "Restart your gateway: openclaw gateway stop && openclaw gateway start"
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

If you see an error or "unknown tool", the extension didn't load. Check:
1. Is the `mesh` folder in the right `extensions/` directory?
2. Did you run `pnpm build` from the OpenClaw root?
3. Did you restart the gateway?

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

## Demo Setup (2 Machines)

### On Both Machines

1. Install OpenClaw globally: `npm install -g openclaw`
2. Install mesh extension (see Installation above)
3. Note your local IP:
   ```bash
   # macOS/Linux
   ifconfig | grep "inet " | grep -v 127.0.0.1
   
   # Windows
   ipconfig | findstr IPv4
   ```

### Machine A

```bash
# Start OpenClaw
openclaw gateway start

# Create a test file
echo "Hello from Machine A" > ~/.openclaw/workspace/mesh-test.md

# Check status
openclaw agent --message "mesh_status"
```

### Machine B

```bash
# Start OpenClaw
openclaw gateway start

# Check for Machine A
openclaw agent --message "mesh_discover"

# Should show Machine A in the peer list
```

### Verify Sync

```bash
# On Machine B, check if the file synced
openclaw agent --message "mesh_status"

# Check the file content
cat ~/.openclaw/workspace/mesh-test.md
```

## Troubleshooting

### "Cannot find OpenClaw installation"

OpenClaw must be installed globally first:

```bash
# Using npm
npm install -g openclaw

# Using pnpm
pnpm add -g openclaw
```

Verify installation:

```bash
openclaw --version
```

### "pnpm: command not found"

Install pnpm first:

```bash
npm install -g pnpm
```

### Extension Not Loading

1. **Check extension location:**
   ```bash
   ls <openclaw-path>/extensions/mesh
   # Should show: index.ts, package.json, openclaw.plugin.json, src/, README.md
   ```

2. **Check if it was bundled:**
   ```bash
   ls <openclaw-path>/dist/extensions/mesh
   # Should show: index.js, package.json, openclaw.plugin.json
   ```

3. **Did you rebuild?**
   ```bash
   cd <openclaw-path>
   pnpm build
   ```

4. **Did you restart the gateway?**
   ```bash
   openclaw gateway stop
   openclaw gateway start
   ```

### No Peers Discovered

1. **Same WiFi?** Both machines must be on the same network
2. **Firewall?** Check if incoming connections are blocked
   - **macOS:** System Settings → Privacy & Security → Local Network → Allow Node/OpenClaw
   - **Linux:** Check `ufw` or `firewalld`
   - **Windows:** Windows Defender Firewall → Allow Node.js
3. **mDNS working?** Test with:
   ```bash
   # macOS/Linux
   dns-sd -B _openclaw-mesh._tcp
   
   # Linux (avahi)
   avahi-browse -at | grep openclaw
   ```

### Tools Not Available

```bash
# Check if mesh extension loaded
openclaw agent --message "What tools do you have?"

# Look for mesh_discover, mesh_status, mesh_broadcast, mesh_sync in the response
```

### Build Errors

```bash
# Clean and rebuild
cd <openclaw-path>
rm -rf node_modules/.cache dist
pnpm install
pnpm build
```

### Permission Errors

On macOS/Linux, you might need `sudo` if OpenClaw was installed with sudo:

```bash
sudo git clone https://github.com/rxchitrx/openclaw-mesh-extension.git <openclaw-path>/extensions/mesh
cd <openclaw-path>/extensions/mesh
sudo pnpm install
cd <openclaw-path>
sudo pnpm build
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
