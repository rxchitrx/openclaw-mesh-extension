import type { MeshEventKind, MeshEventRecord } from "./events.js";

export const DEFAULT_URGENT_NOTIFICATION_COOLDOWN_MS = 2000;
export const URGENT_MESH_EVENT_KINDS = new Set<MeshEventKind>([
  "peer_pending_approval",
  "peer_disconnected",
  "sync_failed",
  "file_rejected",
]);

export type HeartbeatWakeRequest = {
  source: "notifications-event";
  intent: "event";
  reason: "mesh-urgent-event";
  sessionKey: string;
  heartbeat: { target: "last" };
  coalesceMs: 0;
};

export type SystemEventOptions = {
  sessionKey: string;
  contextKey?: string | null;
  trusted?: boolean;
};

export type UrgentNotificationScheduler = {
  schedule: (event: MeshEventRecord) => Promise<boolean>;
};

export type UrgentNotificationSchedulerOptions = {
  getSessionKey: () => string | null;
  enqueueSystemEvent?: (text: string, options: SystemEventOptions) => boolean;
  requestHeartbeat?: (request: HeartbeatWakeRequest) => void;
  runHeartbeatOnce?: (request: {
    reason: "mesh-urgent-event";
    sessionKey: string;
    heartbeat: { target: "last" };
  }) => Promise<unknown>;
  cooldownMs?: number;
  now?: () => number;
  logger?: {
    warn?: (message: string) => void;
    debug?: (message: string) => void;
  };
};

export function isUrgentMeshEvent(kind: MeshEventKind): boolean {
  return URGENT_MESH_EVENT_KINDS.has(kind);
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

export function formatUrgentMeshSystemEvent(event: MeshEventRecord): string {
  const fingerprint = asString(event.details?.fingerprint);
  const host = asString(event.details?.host);
  const mismatch = event.details?.fingerprintMismatch === true;
  const peerLabel = event.peerName ? ` '${event.peerName}'` : "";
  const hostLabel = host ? ` from ${host}` : "";
  const fingerprintLabel = fingerprint ? ` Fingerprint: ${fingerprint}.` : "";
  const mismatchLabel = mismatch
    ? " WARNING: possible impersonation because this peer name matches a trusted peer but the fingerprint changed."
    : "";

  if (event.kind === "peer_pending_approval") {
    return `[mesh] Mesh approval needed: peer${peerLabel}${hostLabel} wants to connect.${fingerprintLabel}${mismatchLabel} Tell the user immediately and ask whether to approve or deny. Do not approve or deny without the user's decision.`;
  }

  return `[mesh] Urgent mesh event: ${event.message} Tell the user immediately in plain language.`;
}

export function createUrgentNotificationScheduler(
  options: UrgentNotificationSchedulerOptions,
): UrgentNotificationScheduler {
  const cooldownMs = options.cooldownMs ?? DEFAULT_URGENT_NOTIFICATION_COOLDOWN_MS;
  const now = options.now ?? Date.now;
  let lastWakeAt = 0;

  return {
    async schedule(event) {
      if (!isUrgentMeshEvent(event.kind)) {
        return false;
      }

      const sessionKey = options.getSessionKey();
      if (!sessionKey) {
        options.logger?.debug?.(`No active session target for urgent mesh event ${event.kind}`);
        return false;
      }
      if (!options.enqueueSystemEvent) {
        options.logger?.warn?.("OpenClaw system-event runtime is unavailable for urgent mesh event");
        return false;
      }
      if (!options.runHeartbeatOnce && !options.requestHeartbeat) {
        options.logger?.warn?.("OpenClaw heartbeat runtime is unavailable for urgent mesh event");
        return false;
      }

      const timestamp = now();
      if (lastWakeAt > 0 && timestamp - lastWakeAt < cooldownMs) {
        options.logger?.debug?.(`Skipping urgent mesh wake during cooldown for ${event.kind}`);
        return false;
      }

      try {
        const queued = options.enqueueSystemEvent(formatUrgentMeshSystemEvent(event), {
          sessionKey,
          contextKey: `mesh:${event.id}`,
          trusted: true,
        });
        options.logger?.debug?.(`Queued mesh system event ${event.id}: ${queued}`);
        if (!queued) {
          return false;
        }

        if (options.requestHeartbeat) {
          options.requestHeartbeat({
            source: "notifications-event",
            intent: "event",
            reason: "mesh-urgent-event",
            sessionKey,
            heartbeat: { target: "last" },
            coalesceMs: 0,
          });
        } else if (options.runHeartbeatOnce) {
          await options.runHeartbeatOnce({
            reason: "mesh-urgent-event",
            sessionKey,
            heartbeat: { target: "last" },
          });
        } else {
          return false;
        }
        options.logger?.debug?.(`Requested immediate mesh wake for ${event.kind} in ${sessionKey}`);
        lastWakeAt = timestamp;
        return true;
      } catch (err) {
        options.logger?.warn?.(`Could not request urgent mesh wake: ${err}`);
        return false;
      }
    },
  };
}
