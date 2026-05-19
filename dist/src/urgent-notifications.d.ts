import type { MeshEventKind, MeshEventRecord } from "./events.js";
export declare const DEFAULT_URGENT_NOTIFICATION_COOLDOWN_MS = 2000;
export declare const URGENT_MESH_EVENT_KINDS: Set<MeshEventKind>;
export type HeartbeatWakeRequest = {
    source: "notifications-event";
    intent: "event";
    reason: "mesh-urgent-event";
    sessionKey: string;
    heartbeat: {
        target: "last";
    };
    coalesceMs: 0;
};
export type SystemEventOptions = {
    sessionKey: string;
    contextKey?: string | null;
    trusted?: boolean;
};
export type UrgentNotificationTarget = {
    sessionKey: string;
    deliveryContext?: unknown;
};
export type ChatInjectionRequest = {
    sessionKey: string;
    message: string;
    label?: string;
    idempotencyKey?: string;
};
export type UrgentNotificationScheduler = {
    schedule: (event: MeshEventRecord) => Promise<boolean>;
};
export type UrgentNotificationSchedulerOptions = {
    getSessionKey: () => string | null;
    getSessionTarget?: () => UrgentNotificationTarget | null;
    injectChatMessage?: (request: ChatInjectionRequest) => Promise<boolean>;
    enqueueSystemEvent?: (text: string, options: SystemEventOptions) => boolean;
    requestHeartbeat?: (request: HeartbeatWakeRequest) => void;
    runHeartbeatOnce?: (request: {
        reason: "mesh-urgent-event";
        sessionKey: string;
        heartbeat: {
            target: "last";
        };
    }) => Promise<unknown>;
    cooldownMs?: number;
    now?: () => number;
    logger?: {
        warn?: (message: string) => void;
        debug?: (message: string) => void;
    };
};
export declare function isUrgentMeshEvent(kind: MeshEventKind): boolean;
export declare function formatUrgentMeshSystemEvent(event: MeshEventRecord): string;
export declare function formatUrgentMeshChatMessage(event: MeshEventRecord): string;
export declare function createUrgentNotificationScheduler(options: UrgentNotificationSchedulerOptions): UrgentNotificationScheduler;
