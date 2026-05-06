export function createCRDT(config) {
    const { nodeName, logger } = config;
    const docs = new Map();
    const docInitialized = new Set();
    const binaryFiles = new Map();
    const pendingDeltas = [];
    const getOrCreateDoc = async (file) => {
        if (!docs.has(file)) {
            const Y = await import("yjs");
            const doc = new Y.Doc();
            const text = doc.getText("content");
            docs.set(file, { doc, text });
            logger.debug(`Created Yjs doc for: ${file}`);
        }
        return docs.get(file);
    };
    return {
        async getState(file) {
            if (file) {
                if (binaryFiles.has(file)) {
                    return {
                        file,
                        content: binaryFiles.get(file),
                        isBinary: true,
                    };
                }
                const docData = await getOrCreateDoc(file);
                return {
                    file,
                    content: docData.text.toString(),
                    isBinary: false,
                    vector: docData.doc.store.clientVectors,
                };
            }
            const state = {};
            for (const [path, docData] of docs) {
                state[path] = {
                    content: docData.text.toString(),
                    isBinary: false,
                    vector: docData.doc.store.clientVectors,
                };
            }
            for (const [path, content] of binaryFiles) {
                state[path] = {
                    content,
                    isBinary: true,
                };
            }
            return state;
        },
        async applyLocalChange(file, content, isBinary = false) {
            try {
                if (isBinary) {
                    const isNew = !binaryFiles.has(file);
                    const prev = binaryFiles.get(file);
                    if (prev === content && !isNew)
                        return null;
                    binaryFiles.set(file, content);
                    docInitialized.add(file);
                    const delta = {
                        file,
                        changes: [{ type: "replace", content }],
                        timestamp: Date.now(),
                        author: nodeName,
                        isBinary: true,
                    };
                    pendingDeltas.push(delta);
                    logger.info(`Local binary change: ${file} (${content.length} chars base64, ${pendingDeltas.length} pending deltas)`);
                    return delta;
                }
                const docData = await getOrCreateDoc(file);
                const { doc, text } = docData;
                const currentContent = text.toString();
                const isNew = !docInitialized.has(file);
                if (currentContent === content && !isNew) {
                    return null;
                }
                doc.transact(() => {
                    text.delete(0, text.length);
                    text.insert(0, content);
                });
                docInitialized.add(file);
                const delta = {
                    file,
                    changes: [{ type: "replace", content }],
                    timestamp: Date.now(),
                    author: nodeName,
                    isBinary: false,
                };
                pendingDeltas.push(delta);
                logger.info(`Local file change: ${file} (${content.length} chars, ${pendingDeltas.length} pending deltas)`);
                return delta;
            }
            catch (err) {
                logger.error(`Failed to apply change to ${file}: ${err}`);
                return null;
            }
        },
        async applyRemoteDelta(delta, file) {
            try {
                if (delta.isBinary) {
                    binaryFiles.set(file, delta.changes[0]?.content || "");
                    logger.info(`Remote binary applied: ${file} from ${delta.author}`);
                    return;
                }
                const docData = await getOrCreateDoc(file);
                const { doc, text } = docData;
                doc.transact(() => {
                    for (const change of delta.changes) {
                        if (change.type === "replace") {
                            text.delete(0, text.length);
                            text.insert(0, change.content);
                        }
                    }
                });
                docInitialized.add(file);
                logger.info(`Remote delta applied: ${file} from ${delta.author}`);
            }
            catch (err) {
                logger.error(`Failed to apply remote delta: ${err}`);
            }
        },
        applyRemoteBinary(file, content) {
            binaryFiles.set(file, content);
            docInitialized.add(file);
            logger.info(`Remote binary stored: ${file}`);
        },
        async mergeState(state, file) {
            try {
                if (state.isBinary) {
                    binaryFiles.set(file, state.content);
                    docInitialized.add(file);
                    logger.info(`Merged binary state for ${file}`);
                    return;
                }
                const docData = await getOrCreateDoc(file);
                const { doc, text } = docData;
                if (state.content !== undefined) {
                    doc.transact(() => {
                        text.delete(0, text.length);
                        text.insert(0, state.content);
                    });
                }
                docInitialized.add(file);
                logger.info(`Merged state for ${file}`);
            }
            catch (err) {
                logger.error(`Failed to merge state: ${err}`);
            }
        },
        getFileContent(file) {
            if (binaryFiles.has(file)) {
                return binaryFiles.get(file);
            }
            if (!docs.has(file)) {
                return null;
            }
            const docData = docs.get(file);
            return docData.text.toString();
        },
        isFileBinary(file) {
            return binaryFiles.has(file);
        },
        getFiles() {
            return [...new Set([...docs.keys(), ...binaryFiles.keys()])];
        },
        async syncPendingDeltas() {
            const now = Date.now();
            const cutoff = 5 * 60 * 1000;
            while (pendingDeltas.length > 0 && now - pendingDeltas[0].timestamp > cutoff) {
                pendingDeltas.shift();
            }
        },
        getPendingDeltas() {
            return [...pendingDeltas];
        },
        getPendingDeltasForFile(file) {
            return pendingDeltas.filter((d) => d.file === file);
        },
    };
}
