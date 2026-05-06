export function createMeshStatusTool(services, _ctx) {
    return {
        label: "Mesh Status",
        name: "mesh_status",
        description: "Show detailed mesh state for debugging",
        parameters: {
            type: "object",
            properties: {},
            required: [],
        },
        execute: async (_toolCallId, _toolParams, _signal, _onUpdate) => {
            const { discovery, transport, crdt, fileWatcher, currentTrackDir } = services;
            const localNode = discovery.getLocalNode();
            const peers = discovery.getPeers();
            const connections = transport.getConnections();
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
                message += `  None — use /mesh dir <path> to start tracking a project\n\n`;
            }
            message += `LOCAL NODE\n`;
            message += `  Name: ${localNode.name}\n`;
            message += `  Host: ${localNode.host}\n`;
            message += `  Port: ${localNode.port}\n\n`;
            message += `NETWORK\n`;
            message += `  Peers: ${peers.length}\n`;
            message += `  Connections: ${connections.length}\n`;
            if (connections.length > 0) {
                for (const conn of connections) {
                    message += `    ${conn}\n`;
                }
            }
            message += `\n`;
            message += `FILE SYNC\n`;
            message += `  Watched: ${watchedFiles.length}\n`;
            message += `  In CRDT: ${files.length}\n`;
            message += `  Pending: ${pendingDeltas.length}\n`;
            if (watchedFiles.length > 0) {
                message += `\nFILES\n`;
                const maxShow = 15;
                for (const f of watchedFiles.slice(0, maxShow)) {
                    const inCRDT = files.includes(f) ? "synced" : "pending";
                    message += `  [${inCRDT}] ${f}\n`;
                }
                if (watchedFiles.length > maxShow) {
                    message += `  ... and ${watchedFiles.length - maxShow} more\n`;
                }
            }
            const health = connections.length > 0 ? "HEALTHY" : (peers.length > 0 ? "PARTIAL" : "STANDALONE");
            message += `\nSUMMARY: ${health} | ${connections.length > 0 ? "MESH" : "STANDALONE"} | ${pendingDeltas.length === 0 ? "IN SYNC" : `${pendingDeltas.length} PENDING`}\n`;
            return {
                content: [{ type: "text", text: message }],
                details: {
                    ok: true,
                    status: {
                        localNode,
                        trackDir: currentTrackDir,
                        peerCount: peers.length,
                        connectionCount: connections.length,
                        syncedFiles: files.length,
                        watchedFiles: watchedFiles.length,
                        pendingDeltas: pendingDeltas.length,
                        health,
                        timestamp: now,
                    },
                },
            };
        },
    };
}
