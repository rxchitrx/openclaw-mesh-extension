export type MeshConfig = {
    enabled?: boolean;
    nodeName?: string;
    port?: number;
    trackDir?: string;
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
