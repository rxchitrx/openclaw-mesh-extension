import type { CapabilityRegistry } from "../capability-registry.js";
import type { TransportService } from "../transport.js";
export type AdvertiseServices = {
    capabilityRegistry: CapabilityRegistry;
    transport: Pick<TransportService, "broadcastNodeInfo">;
};
export declare function createMeshAdvertiseTool(services: AdvertiseServices, _ctx: any): {
    label: string;
    name: string;
    description: string;
    parameters: {
        type: "object";
        properties: {
            action: {
                type: string;
                description: string;
            };
            tag: {
                type: string;
                description: string;
            };
        };
        required: string[];
    };
    execute: (_toolCallId: string, toolParams: {
        action: string;
        tag?: string;
    }, _signal: any, _onUpdate: any) => Promise<{
        content: {
            type: "text";
            text: string;
        }[];
        details: {
            ok: boolean;
            action: string;
            capabilities: string[];
            error?: undefined;
            tag?: undefined;
            broadcastNodeInfo?: undefined;
        };
    } | {
        content: {
            type: "text";
            text: string;
        }[];
        details: {
            ok: boolean;
            error: string;
            action: string;
            capabilities?: undefined;
            tag?: undefined;
            broadcastNodeInfo?: undefined;
        };
    } | {
        content: {
            type: "text";
            text: string;
        }[];
        details: {
            ok: boolean;
            action: string;
            tag: string;
            capabilities: string[];
            broadcastNodeInfo: boolean;
            error?: undefined;
        };
    }>;
};
