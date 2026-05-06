# OpenClaw Mesh Extension

P2P distributed file sync between OpenClaw nodes.

## Installation

```bash
# Clone into your OpenClaw extensions folder
cd /path/to/openclaw/extensions
git clone https://github.com/rxchitrx/openclaw-mesh-extension.git mesh

# Install dependencies
cd mesh
pnpm install

# Rebuild OpenClaw
cd /path/to/openclaw
pnpm build
```

## Tools

- `mesh_discover` - List all nodes on the mesh
- `mesh_status` - Show local mesh state
- `mesh_broadcast` - Push changes to peers
- `mesh_sync` - Pull changes from peers

## Configuration

Add to your `openclaw.json`:

```json
{
  "plugins": {
    "entries": {
      "mesh": {
        "enabled": true
      }
    }
  }
}
```

## How It Works

1. **Discovery** - mDNS (Bonjour) finds other nodes on the same WiFi
2. **Transport** - WebSocket P2P connections
3. **Sync** - Yjs CRDT for conflict-free merging
4. **Files** - Watches workspace directory for changes
