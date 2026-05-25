export function createMeshDiscoverTool(services, _ctx) {
    return {
        label: "Mesh Discover",
        name: "mesh_discover",
        description: "List mesh peers or manually connect to a peer by IP. Say 'discover' to scan, or 'connect to 192.168.1.5:18790' to manually connect when mDNS doesn't work.",
        parameters: {
            type: "object",
            properties: {
                connect: {
                    type: "string",
                    description: "IP:port of a peer to manually connect to (e.g. '192.168.1.5:18790'). Use when mDNS auto-discovery doesn't work.",
                },
            },
            required: [],
        },
        execute: async (_toolCallId, toolParams, _signal, _onUpdate) => {
            const { discovery, transport } = services;
            const connectTarget = toolParams?.connect?.trim();
            if (connectTarget) {
                const parts = connectTarget.split(":");
                const peerHost = parts[0];
                const peerPort = parseInt(parts[1] || "18790", 10);
                if (!peerHost || /^\d+\.\d+\.\d+\.\d+$/.test(peerHost) === false) {
                    return {
                        content: [{ type: "text", text: "Invalid address. Use format: IP:port (e.g. 192.168.1.5:18790)" }],
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
            message += `  Primary LAN IP: ${localNode.primaryAddress}\n`;
            const additional = localNode.addresses.filter((address) => address !== localNode.primaryAddress);
            message += `  Other local IPv4s: ${additional.length > 0 ? additional.join(", ") : "none"}\n`;
            message += `  Port: ${localNode.port}\n\n`;
            if (peers.length === 0 && connections.length === 0 && pending.length === 0) {
                message += `PEERS: None found\n`;
                message += `  mDNS and subnet scan found no peers.\n`;
                message += `  Connect manually: say 'connect to 192.168.29.106:18790'\n`;
            }
            else {
                if (peers.length > 0) {
                    message += `DISCOVERED: ${peers.length}\n`;
                    for (const peer of peers) {
                        const ago = Math.floor((Date.now() - peer.lastSeen) / 1000);
                        const source = peer.source ? ` source=${peer.source}` : "";
                        message += `  ${peer.name} at ${peer.host}:${peer.port} (${ago}s ago${source})\n`;
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
