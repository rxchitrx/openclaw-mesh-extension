export function createMeshStatusTool(services, _ctx) {
    return {
        label: "Mesh Status",
        name: "mesh_status",
        description: "Show current mesh state — tracked directory, peers, connections, pending approvals, and file sync status",
        parameters: {
            type: "object",
            properties: {},
            required: [],
        },
        execute: async (_toolCallId, _toolParams, _signal, _onUpdate) => {
            const { discovery, transport, crdt, getTrackState } = services;
            const { fileWatcher, currentTrackDir } = getTrackState();
            const localNode = discovery.getLocalNode();
            const peers = discovery.getPeers();
            const connections = transport.getConnections();
            const pending = transport.getPendingConnections();
            const files = crdt.getFiles();
            const pendingDeltas = crdt.getPendingDeltas();
            const watchedFiles = fileWatcher?.getWatchedFiles() ?? [];
            const now = new Date().toISOString();
            let message = `MESH STATUS\n`;
            message += `Timestamp: ${now}\n\n`;
            message += `TRACKED DIRECTORY\n`;
            if (currentTrackDir) {
                message += `  ${currentTrackDir} (${watchedFiles.length} files)\n\n`;
            }
            else {
                message += `  None — tell me to track a project directory to get started\n\n`;
            }
            message += `LOCAL NODE\n`;
            message += `  Name: ${localNode.name}\n`;
            message += `  Host: ${localNode.host}\n`;
            message += `  Port: ${localNode.port}\n\n`;
            message += `NETWORK\n`;
            message += `  Discovered peers: ${peers.length}\n`;
            if (peers.length > 0) {
                for (const p of peers) {
                    const connected = connections.includes(p.name);
                    message += `    ${p.name} at ${p.host}:${p.port} ${connected ? "[connected]" : ""}\n`;
                }
            }
            message += `  Connected: ${connections.length}\n`;
            if (connections.length > 0) {
                for (const name of connections) {
                    const manifest = transport.getRemoteManifest(name);
                    message += `    ${name} ${manifest ? `(${manifest.length} files in manifest)` : "(no manifest yet)"}\n`;
                }
            }
            if (pending.length > 0) {
                message += `  PENDING APPROVAL: ${pending.length}\n`;
                for (const p of pending) {
                    message += `    ${p.peerName} from ${p.host} (say 'approve ${p.peerName}' or 'deny ${p.peerName}')\n`;
                }
            }
            message += `\n`;
            message += `FILE SYNC\n`;
            message += `  Watched: ${watchedFiles.length}\n`;
            message += `  In CRDT: ${files.length}\n`;
            message += `  Pending deltas: ${pendingDeltas.length}\n`;
            const binaryCount = files.filter((f) => crdt.isFileBinary(f)).length;
            if (binaryCount > 0) {
                message += `  Binary files: ${binaryCount}\n`;
            }
            const health = connections.length > 0 ? "HEALTHY" : (peers.length > 0 ? "PARTIAL" : "STANDALONE");
            message += `\nSUMMARY: ${health} | ${connections.length > 0 ? "MESH" : "STANDALONE"} | ${pendingDeltas.length === 0 ? "IN SYNC" : `${pendingDeltas.length} PENDING`}${pending.length > 0 ? ` | ${pending.length} PENDING APPROVAL` : ""}\n`;
            return {
                content: [{ type: "text", text: message }],
                details: {
                    ok: true,
                    status: {
                        localNode,
                        trackDir: currentTrackDir,
                        peerCount: peers.length,
                        connectionCount: connections.length,
                        pendingApprovalCount: pending.length,
                        syncedFiles: files.length,
                        watchedFiles: watchedFiles.length,
                        pendingDeltas: pendingDeltas.length,
                        binaryFiles: binaryCount,
                        health,
                        timestamp: now,
                    },
                },
            };
        },
    };
}
