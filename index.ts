import * as fs from "fs";
import * as path from "path";
import { execFile } from "child_process";
import { promisify } from "util";

import { createSyncState, type SyncStateService } from "./src/sync-state.js";
import { createDiscovery, type DiscoveryService } from "./src/discovery.js";
import { createMeshEventStore, summarizeMeshEvents, type MeshEventKind, type MeshEventStore } from "./src/events.js";
import { createFileWatcher, type FileWatcherService, type TrackedFile } from "./src/file-watcher.js";
import { createCapabilityRegistry } from "./src/capability-registry.js";
import { resolveInsideRoot } from "./src/path-safety.js";
import { createMeshAdvertiseTool } from "./src/tools/advertise.js";
import { createMeshApproveTool } from "./src/tools/approve.js";
import { createMeshConnectionsTool } from "./src/tools/connections.js";
import { createMeshCapabilityRespondTool } from "./src/tools/capability-respond.js";
import { createMeshDiffTool } from "./src/tools/diff.js";
import { createMeshDiscoverTool } from "./src/tools/discover.js";
import { createMeshEventsTool } from "./src/tools/events.js";
import { createMeshAckTool } from "./src/tools/ack.js";
import { createMeshBroadcastTool } from "./src/tools/broadcast.js";
import { createMeshRejectTool } from "./src/tools/reject.js";
import { createMeshStatusTool } from "./src/tools/status.js";
import { createMeshSyncTool } from "./src/tools/sync.js";
import { createMeshTrackTool } from "./src/tools/track.js";
import { createTransport, type TransportNotification, type TransportService } from "./src/transport.js";
import {
  DEFAULT_URGENT_NOTIFICATION_COOLDOWN_MS,
  createUrgentNotificationScheduler,
} from "./src/urgent-notifications.js";
import {
  DEFAULT_NOTIFICATION_SESSION_TTL_MS,
  type MeshSessionTarget,
  createMeshSessionTargetStore,
} from "./src/mesh-session-target.js";

const execFileAsync = promisify(execFile);

function readSessionDeliveryContext(sessionKey: string): unknown {
  const match = /^agent:([^:]+):/.exec(sessionKey);
  const agentId = match?.[1];
  if (!agentId) return undefined;
  try {
    const sessionStorePath = path.join(
      process.env.OPENCLAW_STATE_DIR || path.join(process.env.HOME || "", ".openclaw"),
      "agents",
      agentId,
      "sessions",
      "sessions.json",
    );
    const store = JSON.parse(fs.readFileSync(sessionStorePath, "utf-8"));
    return store?.[sessionKey]?.deliveryContext;
  } catch {
    return undefined;
  }
}

export type MeshConfig = {
  enabled?: boolean;
  nodeName?: string;
  port?: number;
  trackDir?: string;
  ignorePatterns?: string[];
  capabilities?: string[];
  urgentNotifyCooldownMs?: number;
  notificationSessionTtlMs?: number;
};

type TrackState = {
  fileWatcher: FileWatcherService | null;
  currentTrackDir: string | null;
  startFileWatcher: (dir: string) => Promise<void>;
  stopFileWatcher: () => Promise<void>;
};

function mapTransportEventKind(type: TransportNotification["type"]): MeshEventKind {
  switch (type) {
    case "peer_pending":
      return "peer_pending_approval";
    case "peer_approved":
      return "peer_approved";
    case "peer_denied":
      return "peer_denied";
    case "peer_connected":
    case "node_info_received":
      return "peer_connected";
    case "peer_disconnected":
      return "peer_disconnected";
    case "manifest_received":
      return "manifest_received";
    case "sync_requested":
      return "sync_requested";
    case "sync_applied":
      return "sync_applied";
    case "sync_failed":
      return "sync_failed";
    case "file_sent":
    case "file_patch":
      return "file_sent";
    case "file_received":
      return "file_received";
    case "file_written":
      return "file_written";
    case "file_rejected":
      return "file_rejected";
    case "file_conflict":
    case "conflict":
      return "conflict";
    case "capability_execute_requested":
      return "capability_execute_requested";
    case "capability_execute_completed":
      return "capability_execute_completed";
    case "file_deleted":
      return "discovery_warning";
    default:
      return "discovery_warning";
  }
}

const meshPlugin = {
  id: "mesh",
  name: "OpenClaw Mesh",
  description: "P2P project file sharing between OpenClaw nodes — a local offline GitHub",
  configSchema: {
    type: "object" as const,
    additionalProperties: false,
    properties: {
      enabled: { type: "boolean", default: true },
      nodeName: { type: "string" },
      port: { type: "number", default: 18790 },
      trackDir: { type: "string" },
      ignorePatterns: {
        type: "array",
        items: { type: "string" },
        default: [],
      },
      capabilities: {
        type: "array",
        items: { type: "string" },
        default: [],
      },
      urgentNotifyCooldownMs: { type: "number", default: DEFAULT_URGENT_NOTIFICATION_COOLDOWN_MS },
      notificationSessionTtlMs: { type: "number", default: DEFAULT_NOTIFICATION_SESSION_TTL_MS },
    },
  },
  register(api: any) {
    const config = (api.pluginConfig as MeshConfig) || {};
    const logger = api.logger;

    if (config.enabled === false) {
      logger.info("Mesh extension disabled, skipping registration");
      return;
    }

    const nodeName = config.nodeName || `node-${process.pid}`;
    const port = config.port || 18790;
    let currentTrackDir: string | null = config.trackDir || null;
    let currentSessionKey: string | null = null;
    const registeredSessionJobs = new Set<string>();

    logger.info(`Initializing mesh node: ${nodeName} on port ${port}`);

    const discovery = createDiscovery({ nodeName, port, logger });
    const syncState = createSyncState({ nodeName, logger });
    const capabilityRegistry = createCapabilityRegistry(config.capabilities ?? []);
    const transport = createTransport({ nodeName, port, syncState, logger });
    const eventStore = createMeshEventStore();
    const sessionTargets = createMeshSessionTargetStore({
      ttlMs: config.notificationSessionTtlMs ?? DEFAULT_NOTIFICATION_SESSION_TTL_MS,
      logger,
    });
    const getNotificationTarget = (): MeshSessionTarget | null => {
      if (currentSessionKey) {
        const persisted = sessionTargets.getCurrent();
        const deliveryContext = persisted?.sessionKey === currentSessionKey
          ? persisted.deliveryContext ?? readSessionDeliveryContext(currentSessionKey)
          : readSessionDeliveryContext(currentSessionKey);
        return {
          sessionKey: currentSessionKey,
          updatedAt: Date.now(),
          source: "memory",
          deliveryContext,
        };
      }
      const persisted = sessionTargets.getCurrent();
      if (!persisted) return null;
      return {
        ...persisted,
        deliveryContext: persisted.deliveryContext ?? readSessionDeliveryContext(persisted.sessionKey),
      };
    };
    const injectDashboardChatMessage = async (request: {
      sessionKey: string;
      message: string;
      label?: string;
      idempotencyKey?: string;
    }): Promise<boolean> => {
      const params = {
        sessionKey: request.sessionKey,
        message: request.message,
        ...(request.label ? { label: request.label } : {}),
      };
      const { stdout } = await execFileAsync("openclaw", [
        "gateway",
        "call",
        "chat.inject",
        "--json",
        "--timeout",
        "10000",
        "--params",
        JSON.stringify(params),
      ], {
        timeout: 15000,
        maxBuffer: 1024 * 1024,
      });
      const parsed = JSON.parse(stdout);
      return parsed?.ok === true;
    };
    const urgentNotifications = createUrgentNotificationScheduler({
      getSessionKey: () => getNotificationTarget()?.sessionKey ?? null,
      getSessionTarget: getNotificationTarget,
      injectChatMessage: injectDashboardChatMessage,
      enqueueSystemEvent: api.runtime?.system?.enqueueSystemEvent,
      requestHeartbeat: api.runtime?.system?.requestHeartbeat,
      runHeartbeatOnce: api.runtime?.system?.runHeartbeatOnce,
      cooldownMs: config.urgentNotifyCooldownMs ?? DEFAULT_URGENT_NOTIFICATION_COOLDOWN_MS,
      logger,
    });

    let fileWatcher: FileWatcherService | null = null;

    const getTrackState = (): TrackState => ({
      fileWatcher,
      currentTrackDir,
      startFileWatcher,
      stopFileWatcher,
    });

    const tryInjectDigest = async (force = false): Promise<string | null> => {
      const targetSessionKey = currentSessionKey ?? sessionTargets.getCurrent()?.sessionKey ?? null;
      if (!targetSessionKey || !api.enqueueNextTurnInjection) {
        return null;
      }
      const deliverable = force ? eventStore.getUnacknowledged() : eventStore.getDeliverable(Date.now());
      if (deliverable.length === 0) {
        return null;
      }
      const text = summarizeMeshEvents(deliverable);
      if (!text) {
        return null;
      }

      try {
        await api.enqueueNextTurnInjection({
          sessionKey: targetSessionKey,
          text,
          placement: "append_context",
          ttlMs: 300000,
        });
        eventStore.markDelivered(
          deliverable.map((event) => event.id),
          Date.now(),
        );
        return text;
      } catch (err) {
        logger.warn(`Could not inject mesh digest into ${targetSessionKey}: ${err}`);
        return null;
      }
    };

    const registerSessionJob = (sessionKey: string) => {
      if (!api.registerSessionSchedulerJob || registeredSessionJobs.has(sessionKey)) {
        return;
      }
      api.registerSessionSchedulerJob({
        id: `mesh-notifier:${sessionKey}`,
        sessionKey,
        kind: "nudge",
        description: "Track mesh notification ownership for this active session",
      });
      registeredSessionJobs.add(sessionKey);
    };

    const enqueueEvent = (kind: MeshEventKind, message: string, options?: {
      peerName?: string;
      filePath?: string;
      details?: Record<string, unknown>;
      expiresAt?: number;
    }) => {
      const record = eventStore.addEvent({
        kind,
        message,
        peerName: options?.peerName,
        filePath: options?.filePath,
        details: options?.details,
        expiresAt: options?.expiresAt,
      });
      void urgentNotifications.schedule(record).then(async (delivered) => {
        if (delivered) {
          eventStore.markDelivered([record.id], Date.now());
          return;
        }
        await tryInjectDigest(false);
      });
    };

    const rememberSession = (ctx: any, source = "tool") => {
      if (typeof ctx?.sessionKey !== "string" || ctx.sessionKey.length === 0) {
        return;
      }
      currentSessionKey = ctx.sessionKey;
      sessionTargets.remember(ctx.sessionKey, source, ctx.deliveryContext);
      registerSessionJob(ctx.sessionKey);
    };

    const registerMeshTool = (name: string, factory: (ctx: any) => any) => {
      api.registerTool((ctx: any) => {
        rememberSession(ctx, `tool:${name}`);
        const tool = factory(ctx);
        if (!tool?.execute) {
          return tool;
        }
        return {
          ...tool,
          execute: async (...args: any[]) => {
            rememberSession(ctx, `tool:${name}:execute`);
            const result = await tool.execute(...args);
            if (name === "mesh_discover") {
              void surfaceToolResult("mesh_discover", result);
            }
            return result;
          },
        };
      }, { name });
    };

    const extractToolText = (result: any): string | null => {
      const content = Array.isArray(result?.content) ? result.content : [];
      const text = content
        .map((block: any) => typeof block?.text === "string" ? block.text : "")
        .filter(Boolean)
        .join("\n")
        .trim();
      return text.length > 0 ? text.slice(0, 6000) : null;
    };

    const surfaceToolResult = async (toolName: string, result: any) => {
      const targetSessionKey = currentSessionKey;
      const text = extractToolText(result);
      if (!targetSessionKey || !text || !api.enqueueNextTurnInjection) {
        return;
      }
      try {
        await api.enqueueNextTurnInjection({
          sessionKey: targetSessionKey,
          placement: "append_context",
          ttlMs: 120000,
          text: `[mesh] The user just ran ${toolName}. You MUST summarize the important result to the user in plain language now. Do not leave only the tool card visible.\n\n${text}`,
        });
        await api.runtime?.system?.runHeartbeatOnce?.({
          reason: "mesh-tool-result-summary",
          sessionKey: targetSessionKey,
          heartbeat: { target: "last" },
        });
      } catch (err) {
        logger.warn(`Could not surface ${toolName} result: ${err}`);
      }
    };

    const startFileWatcher = async (dir: string) => {
      if (fileWatcher) {
        await fileWatcher.stop();
        fileWatcher = null;
      }
      fileWatcher = createFileWatcher({ workspaceDir: dir, syncState, logger, ignorePatterns: config.ignorePatterns });
      fileWatcher.onFileDeleted = (relativePath: string) => {
        transport.notifyFileDeleted(relativePath);
        enqueueEvent("file_written", `Local tracked file '${relativePath}' was deleted and peers were notified.`, {
          filePath: relativePath,
          details: { direction: "local-delete" },
        });
      };
      await fileWatcher.start();
      currentTrackDir = dir;
    };

    const stopFileWatcher = async () => {
      if (!fileWatcher) {
        currentTrackDir = null;
        return;
      }
      fileWatcher.onFileDeleted = null;
      await fileWatcher.stop();
      fileWatcher = null;
      currentTrackDir = null;
    };

    const getFileContent = async (relativePath: string): Promise<{ content: string; isBinary: boolean } | null> => {
      if (!fileWatcher) return null;
      return fileWatcher.getFileContent(relativePath);
    };

    const getLocalManifest = (): TrackedFile[] => {
      if (!fileWatcher) return [];
      return fileWatcher.getManifest();
    };

    transport.setNotificationHandler((notification: TransportNotification) => {
      const host = typeof notification.data?.host === "string" ? notification.data.host : undefined;
      if (notification.peerName && host) {
        discovery.notePeer({
          name: notification.peerName,
          host,
          port,
          source: "transport",
        });
      }
      enqueueEvent(mapTransportEventKind(notification.type), notification.message, {
        peerName: notification.peerName,
        filePath: notification.filePath,
        details: notification.data,
        expiresAt: notification.type === "peer_pending" ? Date.now() + 60000 : undefined,
      });
    });

    transport.setNodeInfoProvider(() => {
      const manifest = getLocalManifest();
      return {
        nodeName,
        trackingDir: currentTrackDir,
        trackingFileCount: manifest.length,
        trackingFiles: manifest.map((file) => file.relativePath),
        capabilities: capabilityRegistry.list(),
      };
    });

    transport.setFileContentProvider(async (relativePath: string) => getFileContent(relativePath));
    transport.setManifestProvider(() => getLocalManifest());
    transport.setFileWriter(async (relativePath: string, content: string, isBinary: boolean) => {
      if (!currentTrackDir) {
        logger.warn(`Cannot write file ${relativePath}: no track directory set`);
        throw new Error("no_track_directory");
      }
      const filePath = resolveInsideRoot(currentTrackDir, relativePath);
      if (!filePath) {
        logger.warn(`Rejected unsafe received file path: ${relativePath}`);
        throw new Error("invalid_path");
      }
      const dir = path.dirname(filePath);
      await fs.promises.mkdir(dir, { recursive: true });
      if (isBinary) {
        await fs.promises.writeFile(filePath, Buffer.from(content, "base64"));
      } else {
        await fs.promises.writeFile(filePath, content, "utf-8");
      }
      logger.info(`Wrote received file to disk: ${filePath}`);
    });

    transport.setIgnoreNextChange((relativePath: string) => {
      if (fileWatcher) {
        fileWatcher.ignoreNextChange(relativePath);
      }
    });

    if (api.registerAgentEventSubscription) {
      api.registerAgentEventSubscription({
        id: "mesh-active-session",
        streams: ["lifecycle", "tool", "error"],
        handle(event: any) {
          if (!event?.sessionKey) {
            return;
          }
          currentSessionKey = event.sessionKey;
          sessionTargets.remember(event.sessionKey, "agent-event", event.deliveryContext);
          registerSessionJob(event.sessionKey);
          void tryInjectDigest(true);
        },
      });
    }

    registerMeshTool("mesh_discover", (ctx: any) => createMeshDiscoverTool({ discovery, transport }, ctx));
    registerMeshTool("mesh_status", (ctx: any) => createMeshStatusTool({ discovery, transport, syncState, getTrackState, capabilityRegistry }, ctx));
    registerMeshTool("mesh_advertise", (ctx: any) => createMeshAdvertiseTool({ capabilityRegistry, transport }, ctx));
    registerMeshTool("mesh_capability_respond", (ctx: any) => createMeshCapabilityRespondTool(transport, ctx));
    registerMeshTool("mesh_broadcast", (ctx: any) => createMeshBroadcastTool({ syncState, transport, getFileContent, getLocalManifest }, ctx));
    registerMeshTool("mesh_sync", (ctx: any) => createMeshSyncTool({ syncState, transport, getFileContent, getLocalManifest }, ctx));
    registerMeshTool("mesh_track", (ctx: any) => createMeshTrackTool(getTrackState, ctx));
    registerMeshTool("mesh_approve", (ctx: any) => createMeshApproveTool(transport, ctx));
    registerMeshTool("mesh_reject", (ctx: any) => createMeshRejectTool(transport, ctx));
    registerMeshTool("mesh_connections", (ctx: any) => createMeshConnectionsTool({ transport, eventStore }, ctx));
    registerMeshTool("mesh_diff", (ctx: any) => createMeshDiffTool({ transport, syncState, getLocalManifest, getFileContent }, ctx));
    registerMeshTool("mesh_events", (ctx: any) => createMeshEventsTool(eventStore, ctx));
    registerMeshTool("mesh_ack", (ctx: any) => createMeshAckTool(eventStore, ctx));

    api.on("gateway_start", async () => {
      try {
        logger.info(`Starting mesh services... Node: ${nodeName}, Port: ${port}`);
        await discovery.start();
        await transport.start();

        if (currentTrackDir) {
          await startFileWatcher(currentTrackDir);
          logger.info(`Auto-tracking directory: ${currentTrackDir}`);
        } else {
          logger.info("No track directory configured. Tell me to track a project directory to get started.");
        }

        setTimeout(async () => {
          await discovery.scan();
          const discoveredPeers = discovery.getPeers();
          for (const peer of discoveredPeers) {
            const connections = transport.getConnections();
            const pending = transport.getPendingConnections();
            if (!connections.includes(peer.name) && !pending.some((item) => item.peerName === peer.name)) {
              await transport.connectToPeer(peer);
            }
          }
        }, 5000);
      } catch (err) {
        logger.error(`Failed to start mesh services: ${err}`);
      }
    });

    api.on("gateway_stop", async () => {
      try {
        await stopFileWatcher();
        await transport.stop();
        await discovery.stop();
        logger.info("Mesh services stopped");
      } catch (err) {
        logger.error(`Error stopping mesh services: ${err}`);
      }
    });

    api.on("heartbeat_prompt_contribution", async () => {
      const peers = discovery.getPeers();
      const connections = transport.getConnections();
      const pending = transport.getPendingConnections();
      const pendingChanges = syncState.getPendingChanges();

      logger.debug(
        `Heartbeat: ${peers.length} peers, ${connections.length} connections, ${pendingChanges.length} pending changes, ${pending.length} pending approvals`,
      );

      try {
        await discovery.scan();
        await transport.maintainConnections();

        for (const peer of discovery.getPeers()) {
          if (!connections.includes(peer.name) && !pending.some((item) => item.peerName === peer.name)) {
            await transport.connectToPeer(peer);
          }
        }
      } catch (err) {
        logger.warn(`Heartbeat error: ${err}`);
      }

      await tryInjectDigest(false);

      const parts: string[] = [];
      const unreadEvents = eventStore.listUnread();
      if (pending.length > 0) {
        const names = pending.map((item) => item.peerName).join(", ");
        parts.push(`${pending.length} peer(s) awaiting approval: ${names}. Ask the user if they want to approve or deny.`);
      }
      if (unreadEvents.length > 0 && !currentSessionKey) {
        parts.push(`${unreadEvents.length} unread mesh event(s) are queued, but there is no active session target yet.`);
      }
      if (pendingChanges.length > 0) {
        parts.push(`${pendingChanges.length} pending file change(s) not yet broadcast. Ask the user if they want to broadcast.`);
      }

      if (parts.length > 0) {
        return {
          appendContext: `[mesh heartbeat] IMPORTANT — You MUST immediately tell the user about the following. Do NOT keep this to yourself: ${parts.join(" ")}`,
        };
      }
      return {};
    });

    logger.info("Mesh extension registered successfully");
  },
};

export default meshPlugin;
