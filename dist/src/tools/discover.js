export function createMeshDiscoverTool(services, _ctx) {
    return {
        label: "Mesh Discover",
        name: "mesh_discover",
        description: "List mesh peers or manually connect to a peer by IP or relay name. Say 'discover', 'connect to 192.168.1.5:18790', or 'connect to relay:friend-laptop'.",
        parameters: {
            type: "object",
            properties: {
                connect: {
                    type: "string",
                    description: "IP:port or relay:<peerName> of a peer to manually connect to.",
                },
            },
            required: [],
        },
        execute: async (_toolCallId, toolParams, _signal, _onUpdate) => {
            const { discovery, transport } = services;
            const connectTarget = toolParams?.connect?.trim();
            if (connectTarget) {
                if (connectTarget.startsWith("relay:")) {
                    const peerName = connectTarget.slice("relay:".length).trim();
                    if (!peerName) {
                        return {
                            content: [{ type: "text", text: "Invalid relay address. Use format: relay:<peerName> (e.g. relay:friend-laptop)" }],
                            details: { ok: false, error: "invalid_relay_address" },
                        };
                    }
                    const peer = {
                        name: peerName,
                        host: "relay",
                        port: 0,
                        lastSeen: Date.now(),
                        source: "relay",
                    };
                    const success = await transport.connectToPeer(peer);
                    if (success) {
                        const pending = transport.getPendingConnections().find((p) => p.peerName === peerName);
                        const status = pending
                            ? `Relay connection request sent to ${peerName}. Waiting for identity verification and approval.`
                            : `Connected to relay peer '${peerName}'.`;
                        return {
                            content: [{ type: "text", text: status }],
                            details: { ok: true, action: "relay_connect", peerName },
                        };
                    }
                    return {
                        content: [{ type: "text", text: `Could not connect to relay peer '${peerName}'. Make sure relay mode is configured and the peer is online in the same room.` }],
                        details: { ok: false, error: "relay_connection_failed", peerName },
                    };
                }
                const parts = connectTarget.split(":");
                const peerHost = parts[0];
                const peerPort = parseInt(parts[1] || "18790", 10);
                if (!peerHost || /^\d+\.\d+\.\d+\.\d+$/.test(peerHost) === false) {
                    return {
                        content: [{ type: "text", text: "Invalid address. Use format: IP:port (e.g. 192.168.1.5:18790) or relay:<peerName>" }],
                        details: { ok: false, error: "invalid_address" },
                    };
                }
                const peer = {
                    name: `manual-${peerHost}`,
                    host: peerHost,
                    port: peerPort,
                    lastSeen: Date.now(),
                    source: "transport",
                };
                const success = await transport.connectToPeer(peer);
                if (success) {
                    const pending = transport.getPendingConnections();
                    const found = pending.find((p) => p.host === peerHost);
                    if (found) {
                        const status = found.direction === "outgoing"
                            ? `Connection request sent to ${peerHost}:${peerPort}. Waiting for that peer to approve.`
                            : `Connected to ${peerHost}:${peerPort}. Peer '${found.peerName}' is asking this node for approval.`;
                        return {
                            content: [{ type: "text", text: status }],
                            details: { ok: true, action: "manual_connect", host: peerHost, port: peerPort, peerName: found.peerName, direction: found.direction },
                        };
                    }
                    const connections = transport.getConnections();
                    return {
                        content: [{ type: "text", text: `Connected to ${peerHost}:${peerPort}. Already approved and connected.` }],
                        details: { ok: true, action: "manual_connect", host: peerHost, port: peerPort },
                    };
                }
                return {
                    content: [{ type: "text", text: `Could not connect to ${peerHost}:${peerPort}. Make sure the peer is running OpenClaw with the mesh extension and the port is correct.` }],
                    details: { ok: false, error: "connection_failed", host: peerHost, port: peerPort },
                };
            }
            await discovery.scan();
            const localNode = discovery.getLocalNode();
            const peers = discovery.getPeers();
            const connections = transport.getConnections();
            const pending = transport.getPendingConnections();
            const now = new Date().toISOString();
            let message = `MESH DISCOVERY REPORT\n`;
            message += `Timestamp: ${now}\n\n`;
            message += `LOCAL NODE\n`;
            message += `  Name: ${localNode.name}\n`;
            message += `  Host: ${localNode.host}\n`;
            message += `  Port: ${localNode.port}\n\n`;
            if (peers.length === 0 && connections.length === 0 && pending.length === 0) {
                message += `PEERS: None found\n`;
                message += `  mDNS and subnet scan found no peers.\n`;
                message += `  Connect manually: say 'connect to 192.168.29.106:18790' or 'connect to relay:friend-laptop'\n`;
            }
            else {
                if (peers.length > 0) {
                    message += `DISCOVERED: ${peers.length}\n`;
                    for (const peer of peers) {
                        const ago = Math.floor((Date.now() - peer.lastSeen) / 1000);
                        const source = peer.source ? ` source=${peer.source}` : "";
                        const endpoint = peer.source === "relay" ? "relay" : `${peer.host}:${peer.port}`;
                        message += `  ${peer.name} at ${endpoint} (${ago}s ago${source})\n`;
                    }
                    message += `\n`;
                }
                if (pending.length > 0) {
                    message += `PENDING CONNECTIONS: ${pending.length}\n`;
                    for (const p of pending) {
                        const label = p.direction === "incoming" ? "incoming approval needed" : "outgoing waiting for remote approval";
                        message += `  ${p.peerName} from ${p.host} (${label})\n`;
                    }
                    message += `\n`;
                }
                if (connections.length > 0) {
                    message += `CONNECTED: ${connections.length}\n`;
                    for (const name of connections) {
                        const info = transport.getNodeInfo(name);
                        message += `  ${name}`;
                        if (info) {
                            const dirStr = info.trackingDir || "not tracking";
                            message += ` | tracking: ${dirStr} (${info.trackingFileCount} files)`;
                        }
                        message += `\n`;
                    }
                }
            }
            return {
                content: [{ type: "text", text: message }],
                details: {
                    ok: true,
                    localNode,
                    peers,
                    connections,
                    pending,
                    timestamp: now,
                },
            };
        },
    };
}
