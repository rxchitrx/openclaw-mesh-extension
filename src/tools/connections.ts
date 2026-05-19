import type { TransportService } from "../transport.js";
import type { MeshEventStore } from "../events.js";

export function createMeshConnectionsTool(
  services: { transport: TransportService; eventStore: MeshEventStore },
  _ctx: any,
) {
  return {
    label: "Mesh Connections",
    name: "mesh_connections",
    description: "Inspect mesh peer connections, pending approvals, and remote manifest state",
    parameters: {
      type: "object" as const,
      properties: {},
      required: [] as string[],
    },
    execute: async (_toolCallId: string, _toolParams: any, _signal: any, _onUpdate: any) => {
      const { transport, eventStore } = services;
      const connections = transport.getConnections();
      const pending = transport.getPendingConnections();
      const pendingExecutions = transport.getPendingExecutions();
      const recentEvents = eventStore.listRecent(20);
      const now = Date.now();

      let message = `MESH CONNECTIONS\n`;
      message += `Timestamp: ${new Date(now).toISOString()}\n\n`;

      if (pending.length > 0) {
        message += `PENDING CONNECTIONS\n`;
        for (const item of pending) {
          const direction = item.direction === "incoming" ? "incoming approval needed" : "outgoing waiting for remote approval";
          const fingerprint = item.fingerprint ? ` | fingerprint: ${item.fingerprint}` : " | fingerprint: unverified";
          const warning = item.fingerprintMismatch ? " | WARNING: possible impersonation" : "";
          message += `  ${item.peerName} from ${item.host} | ${direction}${fingerprint}${warning} (${Math.floor((now - item.connectedAt) / 1000)}s ago)\n`;
        }
        message += `\n`;
      } else {
        message += `PENDING CONNECTIONS\n  none\n\n`;
      }

      if (connections.length > 0) {
        message += `ACTIVE CONNECTIONS\n`;
        for (const peerName of connections) {
          const manifest = transport.getRemoteManifest(peerName);
          const info = transport.getNodeInfo(peerName);
          const applied = transport.getRemoteAppliedFiles(peerName);
          const rejected = transport.getRemoteRejectedFiles(peerName);
          const inFlight = transport.getInFlightSends(peerName);
          const executions = transport.getPendingExecutions(peerName);
          const lastEvent = recentEvents.find((event) => event.peerName === peerName);
          message += `  ${peerName}`;
          const fingerprint = transport.getPeerFingerprint(peerName);
          const warning = transport.getPeerTrustWarning(peerName);
          if (fingerprint) {
            message += ` | fingerprint: ${fingerprint}`;
          }
          if (warning) {
            message += ` | WARNING: ${warning}`;
          }
          if (manifest) {
            message += ` | manifest: ${manifest.length} files`;
          }
          if (info) {
            const trackDir = info.trackingDir || "not tracking";
            message += ` | tracking: ${trackDir} (${info.trackingFileCount} files)`;
            message += ` | capabilities: ${info.capabilities.length > 0 ? info.capabilities.join(", ") : "none"}`;
          }
          if (inFlight.length > 0) {
            message += ` | in-flight: ${inFlight.length}`;
          }
          if (executions.length > 0) {
            message += ` | pending executions: ${executions.length}`;
          }
          if (applied.length > 0) {
            const lastApplied = applied[applied.length - 1];
            message += ` | last applied: ${lastApplied.path}${lastApplied.hash ? `@${lastApplied.hash.slice(0, 8)}` : ""}`;
          }
          if (rejected.length > 0) {
            const lastRejected = rejected[rejected.length - 1];
            message += ` | last rejected: ${lastRejected.path} (${lastRejected.reason})`;
          }
          if (lastEvent) {
            message += ` | last event: ${lastEvent.kind}`;
          }
          message += `\n`;
        }
      } else {
        message += `ACTIVE CONNECTIONS\n  none\n`;
      }

      message += `\nPENDING EXECUTIONS\n`;
      if (pendingExecutions.length > 0) {
        for (const execution of pendingExecutions) {
          message += `  ${execution.requestId} from ${execution.peerName} | ${execution.capability} | expires ${new Date(execution.expiresAt).toISOString()}\n`;
        }
      } else {
        message += `  none\n`;
      }

      return {
        content: [{ type: "text" as const, text: message }],
        details: {
          ok: true,
          connections,
          pendingConnections: pending.map((item) => ({
            peerName: item.peerName,
            host: item.host,
            direction: item.direction,
            connectedAt: item.connectedAt,
            fingerprint: item.fingerprint,
            identityVerified: item.identityVerified,
            fingerprintMismatch: item.fingerprintMismatch,
          })),
          pendingExecutions,
          peerState: connections.map((peerName) => ({
            peerName,
            fingerprint: transport.getPeerFingerprint(peerName),
            trustWarning: transport.getPeerTrustWarning(peerName),
            capabilities: transport.getNodeInfo(peerName)?.capabilities ?? [],
            remoteAppliedFiles: transport.getRemoteAppliedFiles(peerName),
            remoteRejectedFiles: transport.getRemoteRejectedFiles(peerName),
            inFlightSends: transport.getInFlightSends(peerName),
            pendingExecutions: transport.getPendingExecutions(peerName),
          })),
        },
      };
    },
  };
}
