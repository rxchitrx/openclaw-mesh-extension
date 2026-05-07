export function createMeshBroadcastTool(services, _ctx) {
    return {
        label: "Mesh Broadcast",
        name: "mesh_broadcast",
        description: "Push local file changes to all connected mesh peers. Say 'broadcast' for all changed files, or 'broadcast index.ts' for a specific file.",
        parameters: {
            type: "object",
            properties: {
                file: {
                    type: "string",
                    description: "Specific file to broadcast (optional, broadcasts all pending changes if not specified)",
                },
            },
            required: [],
        },
        execute: async (_toolCallId, toolParams, _signal, _onUpdate) => {
            const { syncState, transport, getFileContent, nodeName } = services;
            const file = toolParams?.file;
            const connections = transport.getConnections();
            if (connections.length === 0) {
                return {
                    content: [{ type: "text", text: "No approved peers connected. Approve a peer connection first." }],
                    details: { ok: false, error: "no_peers" },
                };
            }
            const pendingChanges = syncState.getPendingChanges();
            if (pendingChanges.length === 0) {
                return {
                    content: [{ type: "text", text: "Nothing to broadcast — no local file changes detected." }],
                    details: { ok: true, filesSent: 0 },
                };
            }
            const toBroadcast = file
                ? pendingChanges.filter((c) => c.relativePath === file)
                : pendingChanges;
            if (toBroadcast.length === 0 && file) {
                return {
                    content: [{ type: "text", text: `No pending changes for file: ${file}` }],
                    details: { ok: true, filesSent: 0 },
                };
            }
            let sentCount = 0;
            const sentFiles = [];
            for (const change of toBroadcast) {
                const fileData = await getFileContent(change.relativePath);
                if (fileData) {
                    transport.broadcast({
                        type: "file_content",
                        path: change.relativePath,
                        content: fileData.content,
                        isBinary: fileData.isBinary,
                        hash: change.hash,
                        from: nodeName,
                    });
                    sentFiles.push(change.relativePath);
                    sentCount++;
                }
            }
            syncState.clearPendingChanges(sentFiles);
            const fileList = [...new Set(sentFiles)];
            const now = new Date().toISOString();
            let message = `MESH BROADCAST\n`;
            message += `Timestamp: ${now}\n`;
            message += `Peers: ${connections.length}\n`;
            message += `Files sent: ${fileList.length}\n\n`;
            for (const f of fileList) {
                const change = toBroadcast.find((c) => c.relativePath === f);
                message += `  ${f} ${change?.isBinary ? "[binary]" : "[text]"}\n`;
            }
            return {
                content: [{ type: "text", text: message }],
                details: {
                    ok: true,
                    filesSent: sentCount,
                    files: fileList,
                    peerCount: connections.length,
                    timestamp: now,
                },
            };
        },
    };
}
