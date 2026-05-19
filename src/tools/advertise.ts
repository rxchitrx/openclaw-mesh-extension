import type { CapabilityRegistry } from "../capability-registry.js";
import type { TransportService } from "../transport.js";

export type AdvertiseServices = {
  capabilityRegistry: CapabilityRegistry;
  transport: Pick<TransportService, "broadcastNodeInfo">;
};

export function createMeshAdvertiseTool(services: AdvertiseServices, _ctx: any) {
  return {
    label: "Mesh Advertise",
    name: "mesh_advertise",
    description: "Add, remove, or list runtime capability tags advertised to connected mesh peers.",
    parameters: {
      type: "object" as const,
      properties: {
        action: {
          type: "string",
          description: "Capability action: add, remove, or list.",
        },
        tag: {
          type: "string",
          description: "Capability tag to add or remove, such as has:xcode, os:macos, or can:ios-build.",
        },
      },
      required: ["action"] as string[],
    },
    execute: async (_toolCallId: string, toolParams: { action: string; tag?: string }, _signal: any, _onUpdate: any) => {
      const action = toolParams?.action?.trim().toLowerCase();
      const tag = toolParams?.tag?.trim();

      if (action === "list") {
        const capabilities = services.capabilityRegistry.list();
        return {
          content: [{ type: "text" as const, text: capabilities.length > 0 ? `Advertised capabilities: ${capabilities.join(", ")}` : "No capabilities are currently advertised." }],
          details: { ok: true, action, capabilities },
        };
      }

      if (action !== "add" && action !== "remove") {
        return {
          content: [{ type: "text" as const, text: `Unknown advertise action '${toolParams?.action}'. Use add, remove, or list.` }],
          details: { ok: false, error: "invalid_action", action: toolParams?.action },
        };
      }

      if (!tag) {
        return {
          content: [{ type: "text" as const, text: `A capability tag is required to ${action}.` }],
          details: { ok: false, error: "missing_tag", action },
        };
      }

      if (action === "add") {
        services.capabilityRegistry.add(tag);
      } else {
        services.capabilityRegistry.remove(tag);
      }
      services.transport.broadcastNodeInfo();

      const capabilities = services.capabilityRegistry.list();
      const verb = action === "add" ? "Added" : "Removed";
      return {
        content: [{ type: "text" as const, text: `${verb} capability '${tag}'. Updated capabilities were broadcast to connected peers.` }],
        details: { ok: true, action, tag, capabilities, broadcastNodeInfo: true },
      };
    },
  };
}
