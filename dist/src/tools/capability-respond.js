export function createMeshCapabilityRespondTool(transport, _ctx) {
    return {
        label: "Mesh Capability Respond",
        name: "mesh_capability_respond",
        description: "Send a result or error response for an incoming mesh capability execution request.",
        parameters: {
            type: "object",
            properties: {
                requestId: {
                    type: "string",
                    description: "The capability execution request ID to respond to.",
                },
                result: {
                    type: "string",
                    description: "Optional successful result text to send back to the requester.",
                },
                error: {
                    type: "string",
                    description: "Optional error or denial reason to send back to the requester.",
                },
            },
            required: ["requestId"],
        },
        execute: async (_toolCallId, toolParams, _signal, _onUpdate) => {
            const requestId = toolParams?.requestId?.trim();
            const result = typeof toolParams?.result === "string" ? toolParams.result : undefined;
            const error = typeof toolParams?.error === "string" ? toolParams.error : undefined;
            if (!requestId) {
                return {
                    content: [{ type: "text", text: "A capability execution requestId is required." }],
                    details: { ok: false, error: "missing_request_id" },
                };
            }
            const pending = transport.getPendingExecutions().find((execution) => execution.requestId === requestId);
            if (!pending) {
                return {
                    content: [{ type: "text", text: `No pending capability execution request found for '${requestId}'. It may have already completed or timed out.` }],
                    details: { ok: false, error: "not_pending", requestId },
                };
            }
            if (pending.direction !== "incoming") {
                return {
                    content: [{ type: "text", text: `Request '${requestId}' was sent by this node, so it cannot be answered here.` }],
                    details: { ok: false, error: "not_incoming", requestId },
                };
            }
            const sent = transport.respondToExecution(requestId, result, error);
            if (!sent) {
                return {
                    content: [{ type: "text", text: `Could not send capability execution response for '${requestId}'. The peer may be disconnected.` }],
                    details: { ok: false, error: "send_failed", requestId },
                };
            }
            const status = error ? `error: ${error}` : "success";
            return {
                content: [{ type: "text", text: `Sent capability execution response for '${requestId}' (${status}).` }],
                details: {
                    ok: true,
                    requestId,
                    peerName: pending.peerName,
                    capability: pending.capability,
                    result,
                    error,
                },
            };
        },
    };
}
