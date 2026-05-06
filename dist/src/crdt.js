export function createCRDT(config) {
    const { nodeName, logger } = config;
    const docs = new Map();
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
                const docData = await getOrCreateDoc(file);
                return {
                    file,
                    content: docData.text.toString(),
                    vector: docData.doc.store.clientVectors,
                };
            }
            const state = {};
            for (const [path, docData] of docs) {
                state[path] = {
                    content: docData.text.toString(),
                    vector: docData.doc.store.clientVectors,
                };
            }
            return state;
        },
        async applyLocalChange(file, content) {
            try {
                const docData = await getOrCreateDoc(file);
                const { doc, text } = docData;
                const currentContent = text.toString();
                if (currentContent === content) {
                    return null;
                }
                doc.transact(() => {
                    text.delete(0, text.length);
                    text.insert(0, content);
                });
                const delta = {
                    file,
                    changes: [{ type: "replace", content }],
                    timestamp: Date.now(),
                    author: nodeName,
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
                logger.info(`Remote delta applied: ${file} from ${delta.author}`);
            }
            catch (err) {
                logger.error(`Failed to apply remote delta: ${err}`);
            }
        },
        async mergeState(state, file) {
            try {
                const docData = await getOrCreateDoc(file);
                const { doc, text } = docData;
                if (state.content !== undefined) {
                    doc.transact(() => {
                        text.delete(0, text.length);
                        text.insert(0, state.content);
                    });
                }
                logger.info(`Merged state for ${file}`);
            }
            catch (err) {
                logger.error(`Failed to merge state: ${err}`);
            }
        },
        getFileContent(file) {
            if (!docs.has(file)) {
                return null;
            }
            const docData = docs.get(file);
            return docData.text.toString();
        },
        getFiles() {
            return Array.from(docs.keys());
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
    };
}
