import type { DiscoveryService } from "../discovery.js";
export declare function createMeshDiscoverTool(discovery: DiscoveryService, _ctx: any): {
    label: string;
    name: string;
    description: string;
    parameters: {
        type: "object";
        properties: {};
        required: string[];
    };
    execute: (_toolCallId: string, _toolParams: any, _signal: any, _onUpdate: any) => Promise<{
        content: {
            type: "text";
            text: string;
        }[];
        details: {
            ok: boolean;
            localNode: {
                name: string;
                host: string;
                port: number;
            };
            peers: import("../discovery.js").PeerInfo[];
            timestamp: string;
        };
    }>;
};
