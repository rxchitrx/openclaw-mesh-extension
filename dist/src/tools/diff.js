export function createMeshDiffTool(services, _ctx) {
    return {
        label: "Mesh Diff",
        name: "mesh_diff",
        description: "Compare local files against a remote peer's manifest. Shows which files are local-only, remote-only, or modified.",
        parameters: {
            type: "object",
            properties: {
                peerName: {
                    type: "string",
                    description: "Name of the peer to compare with. Omit to see all peers with manifests.",
                },
            },
            required: [],
        },
        execute: async (_toolCallId, toolParams, _signal, _onUpdate) => {
            const { transport, getLocalManifest } = services;
            const peerName = toolParams?.peerName;
            const connections = transport.getConnections();
            if (connections.length === 0) {
                return {
                    content: [{ type: "text", text: "No connected peers to compare with. Approve a peer connection first." }],
                    details: { ok: false, error: "no_peers" },
                };
            }
            if (!peerName) {
                const peersWithManifests = connections.filter((name) => transport.getRemoteManifest(name) !== null);
                let message = `PEER MANIFESTS\n`;
                if (peersWithManifests.length === 0) {
                    message += `No manifests received yet. Manifests are exchanged automatically after approval.\n`;
                    message += `Connected peers: ${connections.join(", ")}`;
                }
                else {
                    for (const name of peersWithManifests) {
                        const manifest = transport.getRemoteManifest(name);
                        message += `  ${name}: ${manifest.length} files\n`;
                    }
                    message += `\nSay 'diff with <peerName>' to compare files.`;
                }
                return {
                    content: [{ type: "text", text: message }],
                    details: { ok: true, peersWithManifests },
                };
            }
            const remoteManifest = transport.getRemoteManifest(peerName);
            if (!remoteManifest) {
                return {
                    content: [{ type: "text", text: `No manifest from '${peerName}'. Request one with 'sync with ${peerName}'.` }],
                    details: { ok: false, error: "no_manifest" },
                };
            }
            const localManifest = getLocalManifest();
            const localMap = new Map(localManifest.map((f) => [f.relativePath, f]));
            const remoteMap = new Map(remoteManifest.map((f) => [f.relativePath, f]));
            const localOnly = [];
            const remoteOnly = [];
            const modified = [];
            const inSync = [];
            for (const [path, file] of localMap) {
                if (!remoteMap.has(path)) {
                    localOnly.push(file);
                }
                else {
                    const remote = remoteMap.get(path);
                    if (file.hash !== remote.hash) {
                        modified.push(file);
                    }
                    else {
                        inSync.push(file);
                    }
                }
            }
            for (const [path, file] of remoteMap) {
                if (!localMap.has(path)) {
                    remoteOnly.push(file);
                }
            }
            let message = `DIFF: local vs ${peerName}\n\n`;
            if (localOnly.length > 0) {
                message += `LOCAL ONLY (you have, they don't):\n`;
                for (const f of localOnly) {
                    message += `  ${f.relativePath} ${f.isBinary ? "[binary]" : ""} (${f.size} bytes)\n`;
                }
                message += `\n`;
            }
            if (remoteOnly.length > 0) {
                message += `REMOTE ONLY (they have, you don't):\n`;
                for (const f of remoteOnly) {
                    message += `  ${f.relativePath} ${f.isBinary ? "[binary]" : ""} (${f.size} bytes)\n`;
                }
                message += `\n`;
            }
            if (modified.length > 0) {
                message += `MODIFIED (both have, different content):\n`;
                for (const f of modified) {
                    const remote = remoteMap.get(f.relativePath);
                    message += `  ${f.relativePath} ${f.isBinary ? "[binary]" : ""} (local: ${f.size}b, remote: ${remote.size}b)\n`;
                }
                message += `\n`;
            }
            message += `IN SYNC: ${inSync.length} files\n\n`;
            message += `SUMMARY: ${localOnly.length} local-only | ${remoteOnly.length} remote-only | ${modified.length} modified | ${inSync.length} in sync\n`;
            message += `Use 'push <file>' or 'pull <file>' to sync specific files, or 'sync all with ${peerName}' to sync everything.`;
            return {
                content: [{ type: "text", text: message }],
                details: {
                    ok: true,
                    peerName,
                    localOnly: localOnly.map((f) => f.relativePath),
                    remoteOnly: remoteOnly.map((f) => f.relativePath),
                    modified: modified.map((f) => f.relativePath),
                    inSyncCount: inSync.length,
                },
            };
        },
    };
}
