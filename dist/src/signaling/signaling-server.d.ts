export declare class SignalingServer {
    private wss;
    private peers;
    private logger;
    constructor(port: number, logger: any);
    private relay;
    private broadcast;
    close(): void;
}
