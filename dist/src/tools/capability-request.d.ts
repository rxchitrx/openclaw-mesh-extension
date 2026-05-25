import type { TransportService } from "../transport.js";
type CapabilityRequestTransport = Pick<TransportService, "getConnections" | "sendCapabilityExecute">;
export declare function createMeshCapabilityRequestTool(transport: CapabilityRequestTransport, _ctx: any): {
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
            capability: {
                type: string;
                description: string;
            };
            instruction: {
                type: string;
                description: string;
            };
            requestId: {
                type: string;
                description: string;
            };
        };
        required: string[];
    };
    execute: (_toolCallId: string, toolParams: {
        peerName?: string;
        capability?: string;
        instruction?: string;
        requestId?: string;
    }, _signal: any, _onUpdate: any) => Promise<{
        content: {
            type: "text";
            text: string;
        }[];
        details: {
            ok: boolean;
            error: string;
            peerName?: undefined;
            capability?: undefined;
            connectedPeers?: undefined;
            requestId?: undefined;
            providedRequestId?: undefined;
            instruction?: undefined;
        };
    } | {
        content: {
            type: "text";
            text: string;
        }[];
        details: {
            ok: boolean;
            error: string;
            peerName: string;
            capability?: undefined;
            connectedPeers?: undefined;
            requestId?: undefined;
            providedRequestId?: undefined;
            instruction?: undefined;
        };
    } | {
        content: {
            type: "text";
            text: string;
        }[];
        details: {
            ok: boolean;
            error: string;
            peerName: string;
            capability: string;
            connectedPeers?: undefined;
            requestId?: undefined;
            providedRequestId?: undefined;
            instruction?: undefined;
        };
    } | {
        content: {
            type: "text";
            text: string;
        }[];
        details: {
            ok: boolean;
            error: string;
            peerName: string;
            connectedPeers: string[];
            capability?: undefined;
            requestId?: undefined;
            providedRequestId?: undefined;
            instruction?: undefined;
        };
    } | {
        content: {
            type: "text";
            text: string;
        }[];
        details: {
            ok: boolean;
            error: string;
            peerName: string;
            capability: string;
            requestId: string;
            connectedPeers?: undefined;
            providedRequestId?: undefined;
            instruction?: undefined;
        };
    } | {
        content: {
            type: "text";
            text: string;
        }[];
        details: {
            ok: boolean;
            requestId: string;
            providedRequestId: boolean;
            peerName: string;
            capability: string;
            instruction: string;
            error?: undefined;
            connectedPeers?: undefined;
        };
    }>;
};
export {};
