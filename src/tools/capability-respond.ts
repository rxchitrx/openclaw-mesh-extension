import type { TransportService } from "../transport.js";

export function createMeshCapabilityRespondTool(transport: Pick<TransportService, "getPendingExecutions" | "respondToExecution">, _ctx: any) {
  return {
    label: "Mesh Capability Respond",
    name: "mesh_capability_respond",
    description: "Send a result or error response for an incoming mesh capability execution request.",
    parameters: {
      type: "object" as const,
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
      required: [] as string[],
    },
    execute: async (_toolCallId: string, toolParams: { requestId?: string; result?: string; error?: string }, _signal: any, _onUpdate: any) => {
      let requestId = toolParams?.requestId?.trim();
      const result = typeof toolParams?.result === "string" ? toolParams.result : undefined;
      const error = typeof toolParams?.error === "string" ? toolParams.error : undefined;

      if (!requestId) {
        const incoming = transport.getPendingExecutions().filter((execution) => execution.direction === "incoming");
        if (incoming.length === 1) {
          requestId = incoming[0].requestId;
        } else {
          const list = incoming.length > 0
            ? incoming.map((execution) => `  ${execution.requestId} from ${execution.peerName} | ${execution.capability}`).join("\n")
            : "  none";
          return {
            content: [{ type: "text" as const, text: `A capability execution requestId is required when there are ${incoming.length} incoming pending requests.\n${list}` }],
            details: { ok: false, error: "missing_request_id", pendingIncomingRequests: incoming },
          };
        }
      }

      const pending = transport.getPendingExecutions().find((execution) => execution.requestId === requestId);
      if (!pending) {
        return {
          content: [{ type: "text" as const, text: `No pending capability execution request found for '${requestId}'. It may have already completed or timed out.` }],
          details: { ok: false, error: "not_pending", requestId },
        };
      }
      if (pending.direction !== "incoming") {
        return {
          content: [{ type: "text" as const, text: `Request '${requestId}' was sent by this node, so it cannot be answered here.` }],
          details: { ok: false, error: "not_incoming", requestId },
        };
      }

      const sent = transport.respondToExecution(requestId, result, error);
      if (!sent) {
        return {
          content: [{ type: "text" as const, text: `Could not send capability execution response for '${requestId}'. The peer may be disconnected.` }],
          details: { ok: false, error: "send_failed", requestId },
        };
      }

      const status = error ? `error: ${error}` : "success";
      return {
        content: [{ type: "text" as const, text: `Sent capability execution response for '${requestId}' (${status}).` }],
        details: {
          ok: true,
          requestId,
          peerName: pending.peerName,
          capability: pending.capability,
          result,
          error,
          autoSelectedRequestId: !toolParams?.requestId?.trim(),
        },
      };
    },
  };
}
