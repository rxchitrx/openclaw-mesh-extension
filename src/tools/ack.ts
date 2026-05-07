import type { MeshEventStore } from "../events.js";

export function createMeshAckTool(eventStore: MeshEventStore, _ctx: any) {
  return {
    label: "Mesh Ack",
    name: "mesh_ack",
    description: "Acknowledge one mesh event by id, or all unread events.",
    parameters: {
      type: "object" as const,
      properties: {
        eventId: {
          type: "string",
          description: "Specific event id to acknowledge. Use 'all' or omit to acknowledge all unread events.",
        },
      },
      required: [] as string[],
    },
    execute: async (_toolCallId: string, toolParams: { eventId?: string }) => {
      const result = eventStore.acknowledge(toolParams?.eventId || "all");
      return {
        content: [
          {
            type: "text" as const,
            text:
              result.acknowledged > 0
                ? `Acknowledged ${result.acknowledged} mesh event(s).`
                : `No matching unread mesh events were found to acknowledge.`,
          },
        ],
        details: {
          ok: result.acknowledged > 0,
          acknowledged: result.acknowledged,
          target: toolParams?.eventId || "all",
        },
      };
    },
  };
}
