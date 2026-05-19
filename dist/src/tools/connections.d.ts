import type { TransportService } from "../transport.js";
import type { MeshEventStore } from "../events.js";
export declare function createMeshConnectionsTool(services: {
    transport: TransportService;
    eventStore: MeshEventStore;
}, _ctx: any): {
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
            connections: string[];
            pendingConnections: {
                peerName: string;
                host: string;
                connectedAt: number;
                fingerprint: string;
                identityVerified: boolean;
                fingerprintMismatch: boolean;
            }[];
            peerState: {
                peerName: string;
                fingerprint: string;
                trustWarning: string;
                remoteAppliedFiles: import("../transport.js").RemoteApplyRecord[];
                remoteRejectedFiles: import("../transport.js").RemoteRejectRecord[];
                inFlightSends: import("../transport.js").InFlightSendRecord[];
            }[];
        };
    }>;
};
