import type { DiscoveryService, PeerInfo } from "../discovery.js";
import type { TransportService } from "../transport.js";
export type DiscoverServices = {
    discovery: DiscoveryService;
    transport: TransportService;
};
export declare function createMeshDiscoverTool(services: DiscoverServices, _ctx: any): {
    label: string;
    name: string;
    description: string;
    parameters: {
        type: "object";
        properties: {
            connect: {
                type: string;
                description: string;
            };
        };
        required: string[];
    };
    execute: (_toolCallId: string, toolParams: {
        connect?: string;
    }, _signal: any, _onUpdate: any) => Promise<{
        content: {
            type: "text";
            text: string;
        }[];
        details: {
            ok: boolean;
            error: string;
            action?: undefined;
            host?: undefined;
            port?: undefined;
            peerName?: undefined;
            direction?: undefined;
            localNode?: undefined;
            peers?: undefined;
            connections?: undefined;
            pending?: undefined;
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
            host: string;
            port: number;
            peerName: string;
            direction: "incoming" | "outgoing";
            error?: undefined;
            localNode?: undefined;
            peers?: undefined;
            connections?: undefined;
            pending?: undefined;
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
            host: string;
            port: number;
            error?: undefined;
            peerName?: undefined;
            direction?: undefined;
            localNode?: undefined;
            peers?: undefined;
            connections?: undefined;
            pending?: undefined;
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
            host: string;
            port: number;
            action?: undefined;
            peerName?: undefined;
            direction?: undefined;
            localNode?: undefined;
            peers?: undefined;
            connections?: undefined;
            pending?: undefined;
            timestamp?: undefined;
        };
    } | {
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
            peers: PeerInfo[];
            connections: string[];
            pending: import("../transport.js").PendingConnection[];
            timestamp: string;
            error?: undefined;
            action?: undefined;
            host?: undefined;
            port?: undefined;
            peerName?: undefined;
            direction?: undefined;
        };
    }>;
};
