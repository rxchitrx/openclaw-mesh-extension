import type { MeshEventStore } from "../events.js";
export declare function createMeshEventsTool(eventStore: MeshEventStore, _ctx: any): {
    label: string;
    name: string;
    description: string;
    parameters: {
        type: "object";
        properties: {
            limit: {
                type: string;
                description: string;
            };
            unreadOnly: {
                type: string;
                description: string;
            };
        };
        required: string[];
    };
    execute: (_toolCallId: string, toolParams: {
        limit?: number;
        unreadOnly?: boolean;
    }) => Promise<{
        content: {
            type: "text";
            text: string;
        }[];
        details: {
            ok: boolean;
            events: {
                id: string;
                kind: import("../events.js").MeshEventKind;
                peerName: string;
                filePath: string;
                acknowledged: boolean;
                delivered: boolean;
                createdAt: number;
                details: Record<string, unknown>;
            }[];
        };
    }>;
};
