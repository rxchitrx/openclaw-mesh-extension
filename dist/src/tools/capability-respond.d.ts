import type { TransportService } from "../transport.js";
export declare function createMeshCapabilityRespondTool(transport: Pick<TransportService, "getPendingExecutions" | "respondToExecution">, _ctx: any): {
    label: string;
    name: string;
    description: string;
    parameters: {
        type: "object";
        properties: {
            requestId: {
                type: string;
                description: string;
            };
            result: {
                type: string;
                description: string;
            };
            error: {
                type: string;
                description: string;
            };
        };
        required: string[];
    };
    execute: (_toolCallId: string, toolParams: {
        requestId?: string;
        result?: string;
        error?: string;
    }, _signal: any, _onUpdate: any) => Promise<{
        content: {
            type: "text";
            text: string;
        }[];
        details: {
            ok: boolean;
            error: string;
            pendingIncomingRequests: import("../transport.js").PendingExecution[];
            requestId?: undefined;
            peerName?: undefined;
            capability?: undefined;
            result?: undefined;
            autoSelectedRequestId?: undefined;
        };
    } | {
        content: {
            type: "text";
            text: string;
        }[];
        details: {
            ok: boolean;
            error: string;
            requestId: string;
            pendingIncomingRequests?: undefined;
            peerName?: undefined;
            capability?: undefined;
            result?: undefined;
            autoSelectedRequestId?: undefined;
        };
    } | {
        content: {
            type: "text";
            text: string;
        }[];
        details: {
            ok: boolean;
            requestId: string;
            peerName: string;
            capability: string;
            result: string;
            error: string;
            autoSelectedRequestId: boolean;
            pendingIncomingRequests?: undefined;
        };
    }>;
};
