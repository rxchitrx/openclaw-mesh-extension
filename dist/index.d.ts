import { type CRDTService } from "./src/crdt.js";
import { type DiscoveryService } from "./src/discovery.js";
import { type FileWatcherService } from "./src/file-watcher.js";
import { type TransportService } from "./src/transport.js";
export type MeshConfig = {
    enabled?: boolean;
    nodeName?: string;
    port?: number;
    workspaceDir?: string;
};
export type MeshServices = {
    discovery: DiscoveryService;
    transport: TransportService;
    crdt: CRDTService;
    fileWatcher: FileWatcherService;
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
            workspaceDir: {
                type: string;
            };
        };
    };
    register(api: any): void;
};
export default meshPlugin;
