export function createMeshConnectionsTool(services, _ctx) {
    return {
        label: "Mesh Connections",
        name: "mesh_connections",
        description: "Inspect mesh peer connections, pending approvals, and remote manifest state",
        parameters: {
            type: "object",
            properties: {},
            required: [],
        },
        execute: async (_toolCallId, _toolParams, _signal, _onUpdate) => {
            const { transport, eventStore } = services;
            const connections = transport.getConnections();
            const pending = transport.getPendingConnections();
            const recentEvents = eventStore.listRecent(20);
            const now = Date.now();
            let message = `MESH CONNECTIONS\n`;
            message += `Timestamp: ${new Date(now).toISOString()}\n\n`;
            if (pending.length > 0) {
                message += `PENDING APPROVALS\n`;
                for (const item of pending) {
                    const fingerprint = item.fingerprint ? ` | fingerprint: ${item.fingerprint}` : " | fingerprint: unverified";
                    const warning = item.fingerprintMismatch ? " | WARNING: possible impersonation" : "";
                    message += `  ${item.peerName} from ${item.host}${fingerprint}${warning} (${Math.floor((now - item.connectedAt) / 1000)}s ago)\n`;
                }
                message += `\n`;
            }
            else {
                message += `PENDING APPROVALS\n  none\n\n`;
            }
            if (connections.length > 0) {
                message += `ACTIVE CONNECTIONS\n`;
                for (const peerName of connections) {
                    const manifest = transport.getRemoteManifest(peerName);
                    const info = transport.getNodeInfo(peerName);
                    const applied = transport.getRemoteAppliedFiles(peerName);
                    const rejected = transport.getRemoteRejectedFiles(peerName);
                    const inFlight = transport.getInFlightSends(peerName);
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
                    }
                    if (inFlight.length > 0) {
                        message += ` | in-flight: ${inFlight.length}`;
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
            }
            else {
                message += `ACTIVE CONNECTIONS\n  none\n`;
            }
            return {
                content: [{ type: "text", text: message }],
                details: {
                    ok: true,
                    connections,
                    pendingConnections: pending.map((item) => ({
                        peerName: item.peerName,
                        host: item.host,
                        connectedAt: item.connectedAt,
                        fingerprint: item.fingerprint,
                        identityVerified: item.identityVerified,
                        fingerprintMismatch: item.fingerprintMismatch,
                    })),
                    peerState: connections.map((peerName) => ({
                        peerName,
                        fingerprint: transport.getPeerFingerprint(peerName),
                        trustWarning: transport.getPeerTrustWarning(peerName),
                        remoteAppliedFiles: transport.getRemoteAppliedFiles(peerName),
                        remoteRejectedFiles: transport.getRemoteRejectedFiles(peerName),
                        inFlightSends: transport.getInFlightSends(peerName),
                    })),
                },
            };
        },
    };
}
