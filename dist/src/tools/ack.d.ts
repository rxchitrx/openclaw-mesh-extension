import type { MeshEventStore } from "../events.js";
export declare function createMeshAckTool(eventStore: MeshEventStore, _ctx: any): {
    label: string;
    name: string;
    description: string;
    parameters: {
        type: "object";
        properties: {
            eventId: {
                type: string;
                description: string;
            };
        };
        required: string[];
    };
    execute: (_toolCallId: string, toolParams: {
        eventId?: string;
    }) => Promise<{
        content: {
            type: "text";
            text: string;
        }[];
        details: {
            ok: boolean;
            acknowledged: number;
            target: string;
        };
    }>;
};
