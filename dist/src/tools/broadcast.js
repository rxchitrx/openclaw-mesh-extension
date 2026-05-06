export function createMeshBroadcastTool(services, _ctx) {
    return {
        label: "Mesh Broadcast",
        name: "mesh_broadcast",
        description: "Push local file changes to all connected mesh peers. Say 'broadcast' for all files, or 'broadcast index.ts' for a specific file.",
        parameters: {
            type: "object",
            properties: {
                file: {
                    type: "string",
                    description: "Specific file to broadcast (optional, broadcasts all pending deltas if not specified)",
                },
            },
            required: [],
        },
        execute: async (_toolCallId, toolParams, _signal, _onUpdate) => {
            const { crdt, transport, getFileContent } = services;
            const pendingDeltas = crdt.getPendingDeltas();
            const file = toolParams?.file;
            const now = new Date().toISOString();
            const connections = transport.getConnections();
            if (connections.length === 0) {
                return {
                    content: [{ type: "text", text: "No approved peers connected. Approve a peer connection first." }],
                    details: { ok: false, error: "no_peers" },
                };
            }
            if (pendingDeltas.length === 0) {
                return {
                    content: [{ type: "text", text: "Nothing to broadcast. All files are in sync with CRDT state." }],
                    details: { ok: true, deltasSent: 0 },
                };
            }
            const toBroadcast = file
                ? pendingDeltas.filter((d) => d.file === file)
                : pendingDeltas;
            if (toBroadcast.length === 0 && file) {
                return {
                    content: [{ type: "text", text: `No pending changes for file: ${file}` }],
                    details: { ok: true, deltasSent: 0 },
                };
            }
            let sentCount = 0;
            let sentFiles = [];
            for (const delta of toBroadcast) {
                if (delta.isBinary) {
                    const fileData = await getFileContent(delta.file);
                    if (fileData) {
                        transport.broadcast({
                            type: "file_content",
                            path: delta.file,
                            content: fileData.content,
                            isBinary: true,
                            from: delta.author,
                        });
                        sentFiles.push(delta.file);
                        sentCount++;
                    }
                }
                else {
                    transport.broadcast({
                        type: "delta",
                        delta,
                        file: delta.file,
                    });
                    sentFiles.push(delta.file);
                    sentCount++;
                }
            }
            const fileList = [...new Set(sentFiles)];
            let message = `MESH BROADCAST\n`;
            message += `Timestamp: ${now}\n`;
            message += `Peers: ${connections.length}\n`;
            message += `Deltas sent: ${sentCount}\n`;
            message += `Files affected: ${fileList.length}\n\n`;
            for (const f of fileList) {
                const deltasForFile = toBroadcast.filter((d) => d.file === f);
                const isBinary = deltasForFile.some((d) => d.isBinary);
                message += `  ${f} ${isBinary ? "[binary]" : ""} (${deltasForFile.length} deltas)\n`;
            }
            return {
                content: [{ type: "text", text: message }],
                details: {
                    ok: true,
                    deltasSent: sentCount,
                    files: fileList,
                    peerCount: connections.length,
                    timestamp: now,
                },
            };
        },
    };
}
