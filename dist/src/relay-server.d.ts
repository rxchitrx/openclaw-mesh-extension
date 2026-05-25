import { type Server } from "http";
export type MeshRelayServerOptions = {
    port?: number;
    host?: string;
    token?: string;
    logger?: any;
};
export type MeshRelayServerHandle = {
    port: number;
    server: Server;
    close: () => Promise<void>;
};
export declare function startMeshRelayServer(options?: MeshRelayServerOptions): Promise<MeshRelayServerHandle>;
