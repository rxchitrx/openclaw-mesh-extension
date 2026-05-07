export function createMeshSyncTool(services, _ctx) {
    return {
        label: "Mesh Sync",
        name: "mesh_sync",
        description: "Sync files with a connected peer. Exchange manifests, push or pull specific files. Say 'sync with node-123', 'push index.ts to node-123', or 'pull index.ts from node-123'.",
        parameters: {
            type: "object",
            properties: {
                action: {
                    type: "string",
                    description: "One of: 'manifest' (exchange manifests), 'push' (send a file), 'pull' (request a file), 'push-all' (send all changed files), 'pull-all' (request all changed files)",
                },
                peerName: {
                    type: "string",
                    description: "Name of the peer to sync with",
                },
                file: {
                    type: "string",
                    description: "Specific file to push or pull (for push/pull actions)",
                },
                force: {
                    type: "boolean",
                    description: "Force push/pull even if there's a conflict (overwrites local or remote)",
                },
            },
            required: [],
        },
        execute: async (_toolCallId, toolParams, _signal, _onUpdate) => {
            const { syncState, transport, getFileContent, getLocalManifest } = services;
            const { action, peerName, file, force } = toolParams;
            const connections = transport.getConnections();
            const now = new Date().toISOString();
            if (connections.length === 0) {
                return {
                    content: [{ type: "text", text: "No approved peers connected. Approve a peer connection first." }],
                    details: { ok: false, error: "no_peers" },
                };
            }
            if (!action || action === "manifest") {
                const target = peerName || connections[0];
                if (!connections.includes(target)) {
                    return {
                        content: [{ type: "text", text: `Peer '${target}' is not connected. Connected peers: ${connections.join(", ")}` }],
                        details: { ok: false, error: "not_connected" },
                    };
                }
                const localManifest = getLocalManifest();
                transport.sendLocalManifest(target, localManifest);
                transport.requestManifest(target);
                return {
                    content: [{ type: "text", text: `Manifest exchanged with '${target}' (${localManifest.length} local files). Use 'diff with ${target}' to see differences.` }],
                    details: { ok: true, action: "manifest", peerName: target, localFileCount: localManifest.length },
                };
            }
            if (!peerName) {
                return {
                    content: [{ type: "text", text: `Specify a peer name. Connected peers: ${connections.join(", ")}` }],
                    details: { ok: false, error: "no_peer" },
                };
            }
            if (!connections.includes(peerName)) {
                return {
                    content: [{ type: "text", text: `Peer '${peerName}' is not connected. Connected peers: ${connections.join(", ")}` }],
                    details: { ok: false, error: "not_connected" },
                };
            }
            if (action === "push") {
                if (!file) {
                    return {
                        content: [{ type: "text", text: "Specify a file to push. e.g. 'push index.ts to node-123'" }],
                        details: { ok: false, error: "no_file" },
                    };
                }
                const fileData = await getFileContent(file);
                if (!fileData) {
                    return {
                        content: [{ type: "text", text: `File '${file}' not found locally.` }],
                        details: { ok: false, error: "file_not_found" },
                    };
                }
                transport.sendFileContent(peerName, file, fileData.content, fileData.isBinary);
                return {
                    content: [{ type: "text", text: `Pushed '${file}' to '${peerName}' (${fileData.content.length} chars, ${fileData.isBinary ? "binary" : "text"}).` }],
                    details: { ok: true, action: "push", peerName, file },
                };
            }
            if (action === "pull") {
                if (!file) {
                    return {
                        content: [{ type: "text", text: "Specify a file to pull. e.g. 'pull index.ts from node-123'" }],
                        details: { ok: false, error: "no_file" },
                    };
                }
                if (force) {
                    syncState.markForceAllow(file);
                }
                if (!force && syncState.isLocallyModified(file)) {
                    return {
                        content: [{ type: "text", text: `Conflict: '${file}' has local modifications. Pulling would overwrite your changes. Use force=true to override, or review with 'diff with ${peerName}'.` }],
                        details: { ok: false, error: "conflict", file },
                    };
                }
                transport.requestFileContent(peerName, file);
                return {
                    content: [{ type: "text", text: `Requested '${file}' from '${peerName}'. File will be received and written.${force ? " (forced — local changes may be overwritten)" : ""}` }],
                    details: { ok: true, action: "pull", peerName, file, forced: !!force },
                };
            }
            if (action === "push-all") {
                const remoteManifest = transport.getRemoteManifest(peerName);
                const localManifest = getLocalManifest();
                if (!remoteManifest) {
                    return {
                        content: [{ type: "text", text: `No manifest from '${peerName}'. Exchange manifests first with 'sync with ${peerName}'.` }],
                        details: { ok: false, error: "no_manifest" },
                    };
                }
                const remoteMap = new Map(remoteManifest.map((f) => [f.relativePath, f]));
                const toPush = [];
                const conflicts = [];
                for (const local of localManifest) {
                    const remote = remoteMap.get(local.relativePath);
                    if (!remote) {
                        toPush.push(local);
                    }
                    else if (remote.hash !== local.hash) {
                        toPush.push(local);
                    }
                }
                if (toPush.length === 0) {
                    return {
                        content: [{ type: "text", text: `All files are already in sync with '${peerName}'.` }],
                        details: { ok: true, action: "push-all", filesSent: 0 },
                    };
                }
                let sentCount = 0;
                for (const f of toPush) {
                    const fileData = await getFileContent(f.relativePath);
                    if (fileData) {
                        transport.sendFileContent(peerName, f.relativePath, fileData.content, fileData.isBinary);
                        sentCount++;
                    }
                }
                return {
                    content: [{ type: "text", text: `Pushed ${sentCount} file(s) to '${peerName}'.` }],
                    details: { ok: true, action: "push-all", peerName, filesSent: sentCount, files: toPush.map((f) => f.relativePath) },
                };
            }
            if (action === "pull-all") {
                const remoteManifest = transport.getRemoteManifest(peerName);
                if (!remoteManifest) {
                    return {
                        content: [{ type: "text", text: `No manifest from '${peerName}'. Exchange manifests first with 'sync with ${peerName}'.` }],
                        details: { ok: false, error: "no_manifest" },
                    };
                }
                const localMap = new Map(getLocalManifest().map((f) => [f.relativePath, f]));
                const toPull = [];
                const conflicts = [];
                for (const remote of remoteManifest) {
                    const local = localMap.get(remote.relativePath);
                    if (!local) {
                        toPull.push(remote);
                    }
                    else if (local.hash !== remote.hash) {
                        if (!force && syncState.isLocallyModified(remote.relativePath)) {
                            conflicts.push(remote.relativePath);
                        }
                        else {
                            if (force && syncState.isLocallyModified(remote.relativePath)) {
                                syncState.markForceAllow(remote.relativePath);
                            }
                            toPull.push(remote);
                        }
                    }
                }
                if (toPull.length === 0 && conflicts.length === 0) {
                    return {
                        content: [{ type: "text", text: `All files are already in sync with '${peerName}'.` }],
                        details: { ok: true, action: "pull-all", filesRequested: 0 },
                    };
                }
                for (const f of toPull) {
                    transport.requestFileContent(peerName, f.relativePath);
                }
                let message = `Requested ${toPull.length} file(s) from '${peerName}'. They will be received and written.`;
                if (conflicts.length > 0) {
                    message += `\n\nSkipped ${conflicts.length} conflicted file(s) with local modifications: ${conflicts.join(", ")}. Use force=true to override.`;
                }
                return {
                    content: [{ type: "text", text: message }],
                    details: { ok: true, action: "pull-all", peerName, filesRequested: toPull.length, conflicts, files: toPull.map((f) => f.relativePath) },
                };
            }
            return {
                content: [{ type: "text", text: `Unknown action '${action}'. Use: manifest, push, pull, push-all, pull-all` }],
                details: { ok: false, error: "invalid_action" },
            };
        },
    };
}
