export const DEFAULT_URGENT_NOTIFICATION_COOLDOWN_MS = 2000;
export const URGENT_MESH_EVENT_KINDS = new Set([
    "peer_pending_approval",
    "peer_disconnected",
    "sync_failed",
    "file_rejected",
    "peer_approved",
    "peer_denied",
    "file_sent",
    "file_received",
    "discovery_warning",
]);
export function isUrgentMeshEvent(kind) {
    return URGENT_MESH_EVENT_KINDS.has(kind);
}
function asString(value) {
    return typeof value === "string" && value.length > 0 ? value : null;
}
function eventDirection(event) {
    const direction = event.details?.direction;
    return direction === "inbound" || direction === "outbound" ? direction : null;
}
function peerApprovalDirectionLabel(event) {
    const direction = eventDirection(event);
    if (direction === "inbound") {
        return `Peer '${event.peerName ?? "Unknown"}' approved your connection request. Tell the user.`;
    }
    if (direction === "outbound") {
        return `You approved peer '${event.peerName ?? "Unknown"}'. Tell the user.`;
    }
    return `Connection approval recorded for peer '${event.peerName ?? "Unknown"}'. Tell the user.`;
}
function peerDenialDirectionLabel(event) {
    const direction = eventDirection(event);
    if (direction === "inbound") {
        return `Peer '${event.peerName ?? "Unknown"}' denied your connection request. Tell the user.`;
    }
    if (direction === "outbound") {
        return `You denied peer '${event.peerName ?? "Unknown"}'. Tell the user.`;
    }
    return `Connection denial recorded for peer '${event.peerName ?? "Unknown"}'. Tell the user.`;
}
export function formatUrgentMeshSystemEvent(event) {
    const fingerprint = asString(event.details?.fingerprint);
    const host = asString(event.details?.host);
    const mismatch = event.details?.fingerprintMismatch === true;
    const peerLabel = event.peerName ? ` '${event.peerName}'` : "";
    const hostLabel = host ? ` from ${host}` : "";
    const fingerprintLabel = fingerprint ? ` Fingerprint: ${fingerprint}.` : "";
    const mismatchLabel = mismatch
        ? " WARNING: possible impersonation because this peer name matches a trusted peer but the fingerprint changed."
        : "";
    const filePath = event.filePath ? ` '${event.filePath}'` : "";
    if (event.kind === "peer_pending_approval") {
        return `[mesh] Mesh approval needed: peer${peerLabel}${hostLabel} wants to connect.${fingerprintLabel}${mismatchLabel} Tell the user immediately and ask whether to approve or deny. Do not approve or deny without the user's decision.`;
    }
    if (event.kind === "peer_approved") {
        return `[mesh] ${peerApprovalDirectionLabel(event)}`;
    }
    if (event.kind === "peer_denied") {
        return `[mesh] ${peerDenialDirectionLabel(event)}`;
    }
    if (event.kind === "file_sent") {
        return `[mesh] Sent file${filePath} to peer${peerLabel}. Tell the user.`;
    }
    if (event.kind === "file_received") {
        return `[mesh] Received file${filePath} from peer${peerLabel}. Tell the user.`;
    }
    if (event.kind === "discovery_warning") {
        return `[mesh] Warning: ${event.message} Tell the user immediately in plain language.`;
    }
    return `[mesh] Urgent mesh event: ${event.message} Tell the user immediately in plain language.`;
}
export function formatUrgentMeshChatMessage(event) {
    const fingerprint = asString(event.details?.fingerprint);
    const host = asString(event.details?.host);
    const mismatch = event.details?.fingerprintMismatch === true;
    const peer = event.peerName ?? "Unknown peer";
    const direction = eventDirection(event);
    if (event.kind === "peer_pending_approval") {
        return [
            "**Mesh approval needed**",
            "",
            "A peer wants to connect:",
            `- **Peer:** \`${peer}\``,
            host ? `- **IP:** \`${host}\`` : null,
            fingerprint ? `- **Fingerprint:** \`${fingerprint}\`` : null,
            mismatch ? "- **Warning:** this peer name matches a trusted peer, but the fingerprint changed." : null,
            "",
            "Do you want to approve or deny this connection?",
            "",
            "Reply with `approve` to accept it, or `deny` to reject it.",
        ].filter((line) => line !== null).join("\n");
    }
    if (event.kind === "peer_approved") {
        if (direction === "inbound") {
            return `**Connection approved**\n\nPeer \`${peer}\` approved your connection request.`;
        }
        if (direction === "outbound") {
            return `**Peer approved**\n\nYou approved peer \`${peer}\`.`;
        }
        return `**Approval recorded**\n\nA connection approval was recorded for peer \`${peer}\`.`;
    }
    if (event.kind === "peer_denied") {
        if (direction === "inbound") {
            return `**Connection denied**\n\nPeer \`${peer}\` denied your connection request.`;
        }
        if (direction === "outbound") {
            return `**Peer denied**\n\nYou denied peer \`${peer}\`.`;
        }
        return `**Denial recorded**\n\nA connection denial was recorded for peer \`${peer}\`.`;
    }
    if (event.kind === "file_sent") {
        const filePath = event.filePath ? ` \`${event.filePath}\`` : "";
        return `**File sent**\n\nSent${filePath} to peer \`${peer}\`.`;
    }
    if (event.kind === "file_received") {
        const filePath = event.filePath ? ` \`${event.filePath}\`` : "";
        return `**File received**\n\nReceived${filePath} from peer \`${peer}\`.`;
    }
    if (event.kind === "discovery_warning") {
        return `**Discovery warning**\n\n${event.message}`;
    }
    return `**Urgent mesh event**\n\n${event.message}`;
}
function isWebchatDeliveryContext(value) {
    if (!value || typeof value !== "object")
        return false;
    const context = value;
    return context.channel === "webchat";
}
export function createUrgentNotificationScheduler(options) {
    const cooldownMs = options.cooldownMs ?? DEFAULT_URGENT_NOTIFICATION_COOLDOWN_MS;
    const now = options.now ?? Date.now;
    let lastWakeAt = 0;
    return {
        async schedule(event) {
            if (!isUrgentMeshEvent(event.kind)) {
                return false;
            }
            const target = options.getSessionTarget?.();
            const sessionKey = target?.sessionKey ?? options.getSessionKey();
            if (!sessionKey) {
                options.logger?.debug?.(`No active session target for urgent mesh event ${event.kind}`);
                return false;
            }
            const timestamp = now();
            if (lastWakeAt > 0 && timestamp - lastWakeAt < cooldownMs) {
                options.logger?.debug?.(`Skipping urgent mesh wake during cooldown for ${event.kind}`);
                return false;
            }
            const shouldInjectWebchat = Boolean(options.injectChatMessage && isWebchatDeliveryContext(target?.deliveryContext));
            if (shouldInjectWebchat && options.injectChatMessage) {
                try {
                    const injected = await options.injectChatMessage({
                        sessionKey,
                        message: formatUrgentMeshChatMessage(event),
                        label: "Mesh",
                        idempotencyKey: `mesh:${event.id}`,
                    });
                    options.logger?.debug?.(`Injected mesh chat notification ${event.id}: ${injected}`);
                    if (injected) {
                        lastWakeAt = timestamp;
                        return true;
                    }
                }
                catch (err) {
                    options.logger?.warn?.(`Could not inject mesh chat notification: ${err}`);
                }
            }
            if (!options.enqueueSystemEvent) {
                options.logger?.warn?.("OpenClaw system-event runtime is unavailable for urgent mesh event");
                return false;
            }
            if (!options.runHeartbeatOnce && !options.requestHeartbeat) {
                options.logger?.warn?.("OpenClaw heartbeat runtime is unavailable for urgent mesh event");
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
                }
                else if (options.runHeartbeatOnce) {
                    await options.runHeartbeatOnce({
                        reason: "mesh-urgent-event",
                        sessionKey,
                        heartbeat: { target: "last" },
                    });
                }
                else {
                    return false;
                }
                options.logger?.debug?.(`Requested immediate mesh wake for ${event.kind} in ${sessionKey}`);
                lastWakeAt = timestamp;
                return true;
            }
            catch (err) {
                options.logger?.warn?.(`Could not request urgent mesh wake: ${err}`);
                return false;
            }
        },
    };
}
