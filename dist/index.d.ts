export type MeshConfig = {
    enabled?: boolean;
    nodeName?: string;
    port?: number;
    trackDir?: string;
    ignorePatterns?: string[];
    capabilities?: string[];
    urgentNotifyCooldownMs?: number;
    notificationSessionTtlMs?: number;
    signalUrl?: string;
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
            urgentNotifyCooldownMs: {
                type: string;
                default: number;
            };
            notificationSessionTtlMs: {
                type: string;
                default: number;
            };
            signalUrl: {
                type: string;
            };
        };
    };
    register(api: any): void;
};
export default meshPlugin;
