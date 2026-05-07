import type { TransportService } from "../transport.js";

export function createMeshRejectTool(transport: TransportService, _ctx: any) {
  return {
    label: "Mesh Reject",
    name: "mesh_reject",
    description: "Reject a pending peer connection. Use this only when the user explicitly tells you to deny a peer.",
    parameters: {
      type: "object" as const,
      properties: {
        peerName: {
          type: "string",
          description: "Name of the peer to reject",
        },
      },
      required: ["peerName"] as string[],
    },
    execute: async (
      _toolCallId: string,
      toolParams: { peerName: string },
      _signal: any,
      _onUpdate: any,
    ) => {
      const success = transport.denyConnection(toolParams.peerName);
      if (!success) {
        return {
          content: [
            {
              type: "text" as const,
              text: `No pending connection from '${toolParams.peerName}' was found, or it was already closed.`,
            },
          ],
          details: { ok: false, error: "deny_failed", peerName: toolParams.peerName },
        };
      }

      return {
        content: [
          {
            type: "text" as const,
            text: `Denied peer '${toolParams.peerName}'. Connection closed.`,
          },
        ],
        details: { ok: true, action: "deny", peerName: toolParams.peerName },
      };
    },
  };
}
