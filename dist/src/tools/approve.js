export function createMeshApproveTool(transport, _ctx) {
    return {
        label: "Mesh Approve",
        name: "mesh_approve",
        description: "Approve or deny an inbound pending peer connection. ONLY use this tool when the user explicitly tells you to approve or deny a peer that is asking to connect to this node. Never approve or deny outbound connection requests from this node.",
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
            const inboundPending = pending.filter((p) => p.direction === "incoming");
            const now = new Date().toISOString();
            const matchingPending = pending.find((p) => p.peerName === peerName);
            const isPending = matchingPending?.direction === "incoming";
            if (!isPending) {
                if (matchingPending?.direction === "outgoing") {
                    return {
                        content: [{ type: "text", text: `Cannot ${action} '${peerName}' from this node. This is an outgoing connection request, so '${peerName}' must approve or deny it on their side.` }],
                        details: { ok: false, error: "not_authorized_to_approve_outgoing", peerName, direction: matchingPending.direction },
                    };
                }
                const connected = transport.getConnections();
                if (connected.includes(peerName)) {
                    return {
                        content: [{ type: "text", text: `Peer '${peerName}' is already approved and connected.` }],
                        details: { ok: true, alreadyConnected: true },
                    };
                }
                let message = `No pending connection from '${peerName}'.\n`;
                if (inboundPending.length > 0) {
                    message += `Inbound pending approvals:\n`;
                    for (const p of inboundPending) {
                        const fingerprint = p.fingerprint ? ` fingerprint ${p.fingerprint}` : " fingerprint unverified";
                        const warning = p.fingerprintMismatch ? " [POSSIBLE IMPERSONATION: fingerprint changed]" : "";
                        message += `  ${p.peerName} from ${p.host}${fingerprint}${warning} (connected ${Math.floor((Date.now() - p.connectedAt) / 1000)}s ago)\n`;
                    }
                }
                else {
                    message += `No inbound approvals are waiting on this node right now.`;
                }
                return {
                    content: [{ type: "text", text: message }],
                    details: { ok: false, error: "not_pending" },
                };
            }
            if (action === "approve") {
                const success = transport.approveConnection(peerName);
                if (success) {
                    const fingerprint = transport.getPeerFingerprint(peerName);
                    return {
                        content: [{ type: "text", text: `Approved peer '${peerName}'${fingerprint ? ` (${fingerprint})` : ""}. Manifests will be exchanged automatically.` }],
                        details: { ok: true, action: "approve", peerName, fingerprint, timestamp: now },
                    };
                }
                return {
                    content: [{ type: "text", text: `Failed to approve '${peerName}'. The connection may be lost, unverified, or flagged for fingerprint mismatch.` }],
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
