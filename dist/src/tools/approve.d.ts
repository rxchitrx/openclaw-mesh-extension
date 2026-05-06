import type { TransportService } from "../transport.js";
export declare function createMeshApproveTool(transport: TransportService, _ctx: any): {
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
            action: {
                type: string;
                description: string;
            };
        };
        required: string[];
    };
    execute: (_toolCallId: string, toolParams: {
        peerName: string;
        action: string;
    }, _signal: any, _onUpdate: any) => Promise<{
        content: {
            type: "text";
            text: string;
        }[];
        details: {
            ok: boolean;
            alreadyConnected: boolean;
            error?: undefined;
            action?: undefined;
            peerName?: undefined;
            timestamp?: undefined;
        };
    } | {
        content: {
            type: "text";
            text: string;
        }[];
        details: {
            ok: boolean;
            error: string;
            alreadyConnected?: undefined;
            action?: undefined;
            peerName?: undefined;
            timestamp?: undefined;
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
            timestamp: string;
            alreadyConnected?: undefined;
            error?: undefined;
        };
    }>;
};
