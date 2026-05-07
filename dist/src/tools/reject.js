export function createMeshRejectTool(transport, _ctx) {
    return {
        label: "Mesh Reject",
        name: "mesh_reject",
        description: "Reject a pending peer connection. Use this only when the user explicitly tells you to deny a peer.",
        parameters: {
            type: "object",
            properties: {
                peerName: {
                    type: "string",
                    description: "Name of the peer to reject",
                },
            },
            required: ["peerName"],
        },
        execute: async (_toolCallId, toolParams, _signal, _onUpdate) => {
            const success = transport.denyConnection(toolParams.peerName);
            if (!success) {
                return {
                    content: [
                        {
                            type: "text",
                            text: `No pending connection from '${toolParams.peerName}' was found, or it was already closed.`,
                        },
                    ],
                    details: { ok: false, error: "deny_failed", peerName: toolParams.peerName },
                };
            }
            return {
                content: [
                    {
                        type: "text",
                        text: `Denied peer '${toolParams.peerName}'. Connection closed.`,
                    },
                ],
                details: { ok: true, action: "deny", peerName: toolParams.peerName },
            };
        },
    };
}
