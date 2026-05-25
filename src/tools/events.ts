import type { MeshEventStore } from "../events.js";

export function createMeshEventsTool(eventStore: MeshEventStore, _ctx: any) {
  return {
    label: "Mesh Events",
    name: "mesh_events",
    description: "List unread and recent mesh events, including approvals, file writes, and disconnects.",
    parameters: {
      type: "object" as const,
      properties: {
        limit: {
          type: "number",
          description: "Maximum number of recent events to show.",
        },
        unreadOnly: {
          type: "boolean",
          description: "Show only unread/unacknowledged events.",
        },
      },
      required: [] as string[],
    },
    execute: async (_toolCallId: string, toolParams: { limit?: number; unreadOnly?: boolean }) => {
      const limit = Math.max(1, Math.min(toolParams?.limit || 20, 100));
      const events = toolParams?.unreadOnly ? eventStore.listUnread().slice(0, limit) : eventStore.listRecent(limit);

      if (events.length === 0) {
        return {
          content: [{ type: "text" as const, text: "No mesh events are currently queued." }],
          details: { ok: true, events: [] },
        };
      }

      let message = `MESH EVENTS\n`;
      for (const event of events) {
        const status = event.acknowledged ? "acknowledged" : event.delivered ? "delivered" : "queued";
        const peer = event.peerName ? ` | peer: ${event.peerName}` : "";
        const filePath = event.filePath ? ` | file: ${event.filePath}` : "";
        const detail = event.details?.requestId
          ? ` | request: ${event.details.requestId}`
          : event.details?.reason
            ? ` | reason: ${event.details.reason}`
            : "";
        message += `- ${event.id} | ${event.kind} | ${status}${peer}${filePath}${detail}\n  ${event.message}\n`;
      }

      return {
        content: [{ type: "text" as const, text: message.trimEnd() }],
        details: {
          ok: true,
          events: events.map((event) => ({
            id: event.id,
            kind: event.kind,
            peerName: event.peerName,
            filePath: event.filePath,
            acknowledged: event.acknowledged,
            delivered: event.delivered,
            createdAt: event.createdAt,
            details: event.details,
          })),
        },
      };
    },
  };
}
