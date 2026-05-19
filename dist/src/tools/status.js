export function createMeshStatusTool(services, _ctx) {
    return {
        label: "Mesh Status",
        name: "mesh_status",
        description: "Show current mesh state — tracked directory, peers, connections, pending approvals, and file sync status",
        parameters: {
            type: "object",
            properties: {},
            required: [],
        },
        execute: async (_toolCallId, _toolParams, _signal, _onUpdate) => {
            const { discovery, transport, syncState, getTrackState } = services;
            const { fileWatcher, currentTrackDir } = getTrackState();
            const localNode = discovery.getLocalNode();
            const peers = discovery.getPeers();
            const connections = transport.getConnections();
            const pending = transport.getPendingConnections();
            const watchedFiles = fileWatcher?.getWatchedFiles() ?? [];
            const pendingChanges = syncState.getPendingChanges();
            const eventStats = services.eventStore?.getStats();
            const recentEvents = services.eventStore?.listUnread().slice(0, 5) ?? [];
            const inFlight = transport.getInFlightSends();
            const now = new Date().toISOString();
            let message = `MESH STATUS\n`;
            message += `Timestamp: ${now}\n\n`;
            message += `TRACKED DIRECTORY\n`;
            if (currentTrackDir) {
                message += `  ${currentTrackDir} (${watchedFiles.length} files)\n\n`;
            }
            else {
                message += `  None — tell me to track a project directory to get started\n\n`;
            }
            message += `LOCAL NODE\n`;
            message += `  Name: ${localNode.name}\n`;
            message += `  Host: ${localNode.host}\n`;
            message += `  Port: ${localNode.port}\n\n`;
            message += `NETWORK\n`;
            message += `  Discovered peers: ${peers.length}\n`;
            if (peers.length > 0) {
                for (const p of peers) {
                    const connected = connections.includes(p.name);
                    const fingerprint = transport.getPeerFingerprint(p.name);
                    message += `    ${p.name} at ${p.host}:${p.port} ${connected ? "[connected]" : ""}${fingerprint ? ` fingerprint ${fingerprint}` : ""}\n`;
                }
            }
            message += `  Connected: ${connections.length}\n`;
            if (connections.length > 0) {
                for (const name of connections) {
                    const manifest = transport.getRemoteManifest(name);
                    const info = transport.getNodeInfo(name);
                    message += `    ${name}`;
                    const fingerprint = transport.getPeerFingerprint(name);
                    const warning = transport.getPeerTrustWarning(name);
                    if (fingerprint) {
                        message += ` | fingerprint: ${fingerprint}`;
                    }
                    if (warning) {
                        message += ` | WARNING: ${warning}`;
                    }
                    if (info) {
                        const dirStr = info.trackingDir || "not tracking";
                        message += ` | tracking: ${dirStr} (${info.trackingFileCount} files)`;
                    }
                    message += manifest ? ` | manifest: ${manifest.length} files` : " | manifest: none";
                    const applied = transport.getRemoteAppliedFiles(name);
                    const rejected = transport.getRemoteRejectedFiles(name);
                    const peerInFlight = transport.getInFlightSends(name);
                    if (peerInFlight.length > 0) {
                        message += ` | in-flight: ${peerInFlight.length}`;
                    }
                    if (applied.length > 0) {
                        const last = applied[applied.length - 1];
                        message += ` | last applied: ${last.path}${last.hash ? `@${last.hash.slice(0, 8)}` : ""}`;
                    }
                    if (rejected.length > 0) {
                        const last = rejected[rejected.length - 1];
                        message += ` | last rejected: ${last.path} (${last.reason})`;
                    }
                    message += `\n`;
                }
            }
            if (pending.length > 0) {
                message += `  PENDING APPROVAL: ${pending.length}\n`;
                for (const p of pending) {
                    const fingerprint = p.fingerprint ? ` fingerprint ${p.fingerprint}` : " fingerprint unverified";
                    const warning = p.fingerprintMismatch ? " WARNING: possible impersonation" : "";
                    message += `    ${p.peerName} from ${p.host}${fingerprint}${warning}\n`;
                }
            }
            message += `\n`;
            message += `EVENTS\n`;
            message += `  Unread: ${eventStats?.unreadCount ?? 0}\n`;
            message += `  Undelivered: ${eventStats?.undeliveredCount ?? 0}\n`;
            if (eventStats?.lastDeliveredAt) {
                message += `  Last delivered: ${new Date(eventStats.lastDeliveredAt).toISOString()}\n`;
            }
            if (eventStats?.lastAcknowledgedAt) {
                message += `  Last acknowledged: ${new Date(eventStats.lastAcknowledgedAt).toISOString()}\n`;
            }
            if (recentEvents.length > 0) {
                message += `  Recent unread:\n`;
                for (const event of recentEvents) {
                    message += `    ${event.kind}${event.peerName ? ` from ${event.peerName}` : ""}: ${event.message}\n`;
                }
            }
            message += `\n`;
            message += `FILE SYNC\n`;
            message += `  Watched: ${watchedFiles.length}\n`;
            message += `  Pending changes: ${pendingChanges.length}\n`;
            message += `  In-flight sends: ${inFlight.length}\n`;
            if (pendingChanges.length > 0) {
                message += `  Pending files: ${pendingChanges.map((change) => change.relativePath).join(", ")}\n`;
            }
            const health = connections.length > 0 ? "HEALTHY" : (peers.length > 0 ? "PARTIAL" : "STANDALONE");
            message += `\nSUMMARY: ${health} | ${connections.length > 0 ? "MESH" : "STANDALONE"} | ${pendingChanges.length === 0 && inFlight.length === 0 ? "IN SYNC" : `${pendingChanges.length} PENDING / ${inFlight.length} IN-FLIGHT`}${pending.length > 0 ? ` | ${pending.length} PENDING APPROVAL` : ""}\n`;
            return {
                content: [{ type: "text", text: message }],
                details: {
                    ok: true,
                    status: {
                        localNode,
                        trackDir: currentTrackDir,
                        peerCount: peers.length,
                        connectionCount: connections.length,
                        pendingApprovalCount: pending.length,
                        unreadEventCount: eventStats?.unreadCount ?? 0,
                        undeliveredEventCount: eventStats?.undeliveredCount ?? 0,
                        lastDeliveredEventAt: eventStats?.lastDeliveredAt ?? null,
                        lastAcknowledgedEventAt: eventStats?.lastAcknowledgedAt ?? null,
                        watchedFiles: watchedFiles.length,
                        pendingChanges: pendingChanges.length,
                        inFlightSends: inFlight.length,
                        health,
                        timestamp: now,
                    },
                },
            };
        },
    };
}
