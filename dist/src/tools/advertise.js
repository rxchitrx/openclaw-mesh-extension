export function createMeshAdvertiseTool(services, _ctx) {
    return {
        label: "Mesh Advertise",
        name: "mesh_advertise",
        description: "Add, remove, or list runtime capability tags advertised to connected mesh peers.",
        parameters: {
            type: "object",
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
            required: ["action"],
        },
        execute: async (_toolCallId, toolParams, _signal, _onUpdate) => {
            const action = toolParams?.action?.trim().toLowerCase();
            const tag = toolParams?.tag?.trim();
            if (action === "list") {
                const capabilities = services.capabilityRegistry.list();
                return {
                    content: [{ type: "text", text: capabilities.length > 0 ? `Advertised capabilities: ${capabilities.join(", ")}` : "No capabilities are currently advertised." }],
                    details: { ok: true, action, capabilities },
                };
            }
            if (action !== "add" && action !== "remove") {
                return {
                    content: [{ type: "text", text: `Unknown advertise action '${toolParams?.action}'. Use add, remove, or list.` }],
                    details: { ok: false, error: "invalid_action", action: toolParams?.action },
                };
            }
            if (!tag) {
                return {
                    content: [{ type: "text", text: `A capability tag is required to ${action}.` }],
                    details: { ok: false, error: "missing_tag", action },
                };
            }
            if (action === "add") {
                services.capabilityRegistry.add(tag);
            }
            else {
                services.capabilityRegistry.remove(tag);
            }
            services.transport.broadcastNodeInfo();
            const capabilities = services.capabilityRegistry.list();
            const verb = action === "add" ? "Added" : "Removed";
            return {
                content: [{ type: "text", text: `${verb} capability '${tag}'. Updated capabilities were broadcast to connected peers.` }],
                details: { ok: true, action, tag, capabilities, broadcastNodeInfo: true },
            };
        },
    };
}
