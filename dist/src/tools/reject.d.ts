import type { TransportService } from "../transport.js";
export declare function createMeshRejectTool(transport: TransportService, _ctx: any): {
    label: string;
    name: string;
    description: string;
    parameters: {
        type: "object";
        properties: {
            peerName: {
                type: string;
                description: string;
            };
        };
        required: string[];
    };
    execute: (_toolCallId: string, toolParams: {
        peerName: string;
    }, _signal: any, _onUpdate: any) => Promise<{
        content: {
            type: "text";
            text: string;
        }[];
        details: {
            ok: boolean;
            error: string;
            peerName: string;
            action?: undefined;
        };
    } | {
        content: {
            type: "text";
            text: string;
        }[];
        details: {
            ok: boolean;
            action: string;
            peerName: string;
            error?: undefined;
        };
    }>;
};
