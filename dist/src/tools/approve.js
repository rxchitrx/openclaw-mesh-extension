export function createMeshApproveTool(transport, _ctx) {
    return {
        label: "Mesh Approve",
        name: "mesh_approve",
        description: "Approve or deny a pending peer connection. ONLY use this tool when the user explicitly tells you to approve or deny a peer. Never approve or deny on your own.",
        parameters: {
            type: "object",
            properties: {
                peerName: {
                    type: "string",
                    description: "Name of the peer to approve or deny",
                },
                action: {
                    type: "string",
                    description: "Either 'approve' or 'deny'",
                },
            },
            required: ["peerName", "action"],
        },
        execute: async (_toolCallId, toolParams, _signal, _onUpdate) => {
            const { peerName, action } = toolParams;
            const pending = transport.getPendingConnections();
            const now = new Date().toISOString();
            const isPending = pending.some((p) => p.peerName === peerName);
            if (!isPending) {
                const connected = transport.getConnections();
                if (connected.includes(peerName)) {
                    return {
                        content: [{ type: "text", text: `Peer '${peerName}' is already approved and connected.` }],
                        details: { ok: true, alreadyConnected: true },
                    };
                }
                let message = `No pending connection from '${peerName}'.\n`;
                if (pending.length > 0) {
                    message += `Pending connections:\n`;
                    for (const p of pending) {
                        message += `  ${p.peerName} from ${p.host} (connected ${Math.floor((Date.now() - p.connectedAt) / 1000)}s ago)\n`;
                    }
                }
                else {
                    message += `No pending connections right now.`;
                }
                return {
                    content: [{ type: "text", text: message }],
                    details: { ok: false, error: "not_pending" },
                };
            }
            if (action === "approve") {
                const success = transport.approveConnection(peerName);
                if (success) {
                    return {
                        content: [{ type: "text", text: `Approved peer '${peerName}'. Manifests will be exchanged automatically.` }],
                        details: { ok: true, action: "approve", peerName, timestamp: now },
                    };
                }
                return {
                    content: [{ type: "text", text: `Failed to approve '${peerName}'. Connection may have been lost.` }],
                    details: { ok: false, error: "approve_failed" },
                };
            }
            if (action === "deny") {
                const success = transport.denyConnection(peerName);
                if (success) {
                    return {
                        content: [{ type: "text", text: `Denied peer '${peerName}'. Connection closed.` }],
                        details: { ok: true, action: "deny", peerName, timestamp: now },
                    };
                }
                return {
                    content: [{ type: "text", text: `Failed to deny '${peerName}'. Connection may have been lost.` }],
                    details: { ok: false, error: "deny_failed" },
                };
            }
            return {
                content: [{ type: "text", text: `Unknown action '${action}'. Use 'approve' or 'deny'.` }],
                details: { ok: false, error: "invalid_action" },
            };
        },
    };
}
