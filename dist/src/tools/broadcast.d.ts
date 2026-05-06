import type { CRDTService } from "../crdt.js";
export declare function createMeshBroadcastTool(crdt: CRDTService, _ctx: any): {
    label: string;
    name: string;
    description: string;
    parameters: {
        type: "object";
        properties: {
            file: {
                type: string;
                description: string;
            };
        };
        required: string[];
    };
    execute: (_toolCallId: string, toolParams: {
        file?: string;
    }, _signal: any, _onUpdate: any) => Promise<{
        content: {
            type: "text";
            text: string;
        }[];
        details: {
            ok: boolean;
            deltas: import("../crdt.js").Delta[];
            files: any[];
            timestamp: string;
        };
    }>;
};
