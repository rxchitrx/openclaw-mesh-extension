export type MeshConfig = {
    enabled?: boolean;
    nodeName?: string;
    port?: number;
    trackDir?: string;
    ignorePatterns?: string[];
    capabilities?: string[];
    internetMode?: "off" | "relay" | "hybrid";
    relayUrl?: string;
    relayRoom?: string;
    relayToken?: string;
    urgentNotifyCooldownMs?: number;
    notificationSessionTtlMs?: number;
};
declare const meshPlugin: {
    id: string;
    name: string;
    description: string;
    configSchema: {
        type: "object";
        additionalProperties: boolean;
        properties: {
            enabled: {
                type: string;
                default: boolean;
            };
            nodeName: {
                type: string;
            };
            port: {
                type: string;
                default: number;
            };
            trackDir: {
                type: string;
            };
            ignorePatterns: {
                type: string;
                items: {
                    type: string;
                };
                default: any[];
            };
            capabilities: {
                type: string;
                items: {
                    type: string;
                };
                default: any[];
            };
            internetMode: {
                type: string;
                enum: string[];
                default: string;
            };
            relayUrl: {
                type: string;
            };
            relayRoom: {
                type: string;
            };
            relayToken: {
                type: string;
            };
            urgentNotifyCooldownMs: {
                type: string;
                default: number;
            };
            notificationSessionTtlMs: {
                type: string;
                default: number;
            };
        };
    };
    register(api: any): void;
};
export default meshPlugin;
