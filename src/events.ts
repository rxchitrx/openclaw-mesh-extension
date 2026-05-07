export type MeshEventKind =
  | "peer_discovered"
  | "peer_pending_approval"
  | "peer_approved"
  | "peer_denied"
  | "peer_connected"
  | "peer_disconnected"
  | "manifest_received"
  | "sync_requested"
  | "file_sent"
  | "file_received"
  | "file_written"
  | "sync_applied"
  | "sync_failed"
  | "conflict"
  | "discovery_warning";

export type MeshEventRecord = {
  id: string;
  kind: MeshEventKind;
  peerName?: string;
  filePath?: string;
  createdAt: number;
  message: string;
  details?: Record<string, unknown>;
  delivered: boolean;
  acknowledged: boolean;
  expiresAt?: number;
  lastDeliveredAt?: number;
  lastAcknowledgedAt?: number;
  lastSurfacedAt?: number;
  occurrences: number;
};

export type MeshEventInput = {
  kind: MeshEventKind;
  message: string;
  peerName?: string;
  filePath?: string;
  details?: Record<string, unknown>;
  expiresAt?: number;
};

export type MeshEventStore = {
  addEvent: (input: MeshEventInput) => MeshEventRecord;
  acknowledge: (eventId?: string) => { acknowledged: number; all: boolean };
  markDelivered: (eventIds: string[], timestamp: number) => void;
  getUnreadCount: () => number;
  getUnacknowledged: () => MeshEventRecord[];
  getDeliverable: (timestamp: number) => MeshEventRecord[];
  listRecent: (limit?: number) => MeshEventRecord[];
  listUnread: () => MeshEventRecord[];
  getStats: () => {
    unreadCount: number;
    undeliveredCount: number;
    lastDeliveredAt: number | null;
    lastAcknowledgedAt: number | null;
  };
};

const MAX_EVENTS = 200;
const DEDUPE_WINDOW_MS = 5000;
const REPEAT_SURFACE_MS = 60000;
const HIGH_PRIORITY = new Set<MeshEventKind>([
  "peer_pending_approval",
  "peer_disconnected",
  "sync_failed",
]);

function createId(): string {
  return `mesh-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function eventKey(event: Pick<MeshEventRecord, "kind" | "peerName" | "filePath" | "message">): string {
  return [event.kind, event.peerName || "", event.filePath || "", event.message].join("::");
}

function priorityScore(kind: MeshEventKind): number {
  return HIGH_PRIORITY.has(kind) ? 2 : (kind === "peer_connected" || kind === "sync_applied" ? 1 : 0);
}

export function summarizeMeshEvents(events: MeshEventRecord[]): string {
  if (events.length === 0) return "";

  const high = events.filter((event) => priorityScore(event.kind) === 2);
  const grouped = new Map<string, { count: number; peerName?: string; prefix: string }>();

  for (const event of events.filter((entry) => priorityScore(entry.kind) < 2)) {
    const key = `${event.kind}:${event.peerName || ""}`;
    const existing = grouped.get(key);
    const peerLabel = event.peerName ? ` from ${event.peerName}` : "";
    const prefix =
      event.kind === "file_written"
        ? `file write${peerLabel}`
        : event.kind === "file_received"
          ? `file receipt${peerLabel}`
          : event.kind === "file_sent"
            ? `file send${peerLabel}`
            : event.kind === "manifest_received"
              ? `manifest update${peerLabel}`
              : event.kind === "sync_applied"
                ? `remote apply confirmation${peerLabel}`
                : event.kind === "peer_connected"
                  ? `connection${peerLabel}`
                  : event.message;
    if (existing) {
      existing.count += 1;
    } else {
      grouped.set(key, { count: 1, peerName: event.peerName, prefix });
    }
  }

  const parts: string[] = [];
  for (const event of high) {
    parts.push(event.message);
  }
  for (const [, group] of grouped) {
    if (group.count === 1) {
      parts.push(`${group.prefix}.`);
    } else {
      parts.push(`${group.count} ${group.prefix} events.`);
    }
  }
  return `[mesh] IMPORTANT — You MUST immediately tell the user about the following mesh event(s). Do NOT keep this to yourself or wait for them to ask. Notify them now: ${parts.join(" ")}`;
}

export function createMeshEventStore(): MeshEventStore {
  const events: MeshEventRecord[] = [];

  const prune = () => {
    while (events.length > MAX_EVENTS) {
      const acknowledgedIndex = events.findIndex((event) => event.acknowledged);
      if (acknowledgedIndex >= 0) {
        events.splice(acknowledgedIndex, 1);
      } else {
        events.shift();
      }
    }
  };

  const purgeExpired = () => {
    const now = Date.now();
    for (let index = events.length - 1; index >= 0; index -= 1) {
      const event = events[index];
      if (event.expiresAt && event.expiresAt <= now) {
        events.splice(index, 1);
      }
    }
  };

  return {
    addEvent(input) {
      purgeExpired();
      const now = Date.now();
      const existing = [...events]
        .reverse()
        .find(
          (event) =>
            now - event.createdAt <= DEDUPE_WINDOW_MS &&
            eventKey(event) ===
              eventKey({
                kind: input.kind,
                peerName: input.peerName,
                filePath: input.filePath,
                message: input.message,
              }),
        );

      if (existing) {
        existing.occurrences += 1;
        existing.createdAt = now;
        existing.details = input.details ?? existing.details;
        existing.expiresAt = input.expiresAt ?? existing.expiresAt;
        existing.acknowledged = false;
        return existing;
      }

      const record: MeshEventRecord = {
        id: createId(),
        kind: input.kind,
        peerName: input.peerName,
        filePath: input.filePath,
        createdAt: now,
        message: input.message,
        details: input.details,
        delivered: false,
        acknowledged: false,
        expiresAt: input.expiresAt,
        occurrences: 1,
      };
      events.push(record);
      prune();
      return record;
    },

    acknowledge(eventId) {
      purgeExpired();
      const now = Date.now();
      let acknowledged = 0;
      if (!eventId || eventId === "all") {
        for (const event of events) {
          if (!event.acknowledged) {
            event.acknowledged = true;
            event.lastAcknowledgedAt = now;
            acknowledged += 1;
          }
        }
        return { acknowledged, all: true };
      }

      const match = events.find((event) => event.id === eventId);
      if (match && !match.acknowledged) {
        match.acknowledged = true;
        match.lastAcknowledgedAt = now;
        acknowledged = 1;
      }
      return { acknowledged, all: false };
    },

    markDelivered(eventIds, timestamp) {
      const targets = new Set(eventIds);
      for (const event of events) {
        if (targets.has(event.id)) {
          event.delivered = true;
          event.lastDeliveredAt = timestamp;
          event.lastSurfacedAt = timestamp;
        }
      }
    },

    getUnreadCount() {
      purgeExpired();
      return events.filter((event) => !event.acknowledged).length;
    },

    getUnacknowledged() {
      purgeExpired();
      return [...events].filter((event) => !event.acknowledged).sort((a, b) => a.createdAt - b.createdAt);
    },

    getDeliverable(timestamp) {
      purgeExpired();
      return [...events]
        .filter((event) => {
          if (event.acknowledged) return false;
          if (!event.delivered) return true;
          return (event.lastSurfacedAt ?? event.lastDeliveredAt ?? 0) + REPEAT_SURFACE_MS <= timestamp;
        })
        .sort((a, b) => {
          const priorityDelta = priorityScore(b.kind) - priorityScore(a.kind);
          if (priorityDelta !== 0) return priorityDelta;
          return a.createdAt - b.createdAt;
        });
    },

    listRecent(limit = 20) {
      purgeExpired();
      return [...events].sort((a, b) => b.createdAt - a.createdAt).slice(0, limit);
    },

    listUnread() {
      purgeExpired();
      return [...events].filter((event) => !event.acknowledged).sort((a, b) => a.createdAt - b.createdAt);
    },

    getStats() {
      purgeExpired();
      const unread = events.filter((event) => !event.acknowledged);
      const delivered = events.filter((event) => event.lastDeliveredAt).map((event) => event.lastDeliveredAt as number);
      const acknowledged = events
        .filter((event) => event.lastAcknowledgedAt)
        .map((event) => event.lastAcknowledgedAt as number);
      return {
        unreadCount: unread.length,
        undeliveredCount: unread.filter((event) => !event.delivered).length,
        lastDeliveredAt: delivered.length > 0 ? Math.max(...delivered) : null,
        lastAcknowledgedAt: acknowledged.length > 0 ? Math.max(...acknowledged) : null,
      };
    },
  };
}
