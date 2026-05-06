export type CRDTConfig = {
  nodeName: string;
  logger: any;
};

export type FileState = {
  path: string;
  content: string;
  lastModified: number;
  author: string;
};

export type Delta = {
  file: string;
  changes: any[];
  timestamp: number;
  author: string;
};

export type CRDTService = {
  getState: (file?: string) => any;
  applyLocalChange: (file: string, content: string) => Promise<Delta | null>;
  applyRemoteDelta: (delta: Delta, file: string) => void;
  mergeState: (state: any, file: string) => void;
  getFileContent: (file: string) => string | null;
  getFiles: () => string[];
  syncPendingDeltas: () => Promise<void>;
  getPendingDeltas: () => Delta[];
};

export function createCRDT(config: CRDTConfig): CRDTService {
  const { nodeName, logger } = config;

  const docs = new Map<string, any>();
  const pendingDeltas: Delta[] = [];

  const getOrCreateDoc = async (file: string): Promise<any> => {
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
    async getState(file?: string) {
      if (file) {
        const docData = await getOrCreateDoc(file);
        return {
          file,
          content: docData.text.toString(),
          vector: docData.doc.store.clientVectors,
        };
      }

      const state: Record<string, any> = {};
      for (const [path, docData] of docs) {
        state[path] = {
          content: docData.text.toString(),
          vector: docData.doc.store.clientVectors,
        };
      }
      return state;
    },

    async applyLocalChange(file: string, content: string): Promise<Delta | null> {
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

        const delta: Delta = {
          file,
          changes: [{ type: "replace", content }],
          timestamp: Date.now(),
          author: nodeName,
        };

        pendingDeltas.push(delta);
        logger.info(`Local file change: ${file} (${content.length} chars, ${pendingDeltas.length} pending deltas)`);
        return delta;
      } catch (err) {
        logger.error(`Failed to apply change to ${file}: ${err}`);
        return null;
      }
    },

    async applyRemoteDelta(delta: Delta, file: string) {
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
      } catch (err) {
        logger.error(`Failed to apply remote delta: ${err}`);
      }
    },

    async mergeState(state: any, file: string) {
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
      } catch (err) {
        logger.error(`Failed to merge state: ${err}`);
      }
    },

    getFileContent(file: string): string | null {
      if (!docs.has(file)) {
        return null;
      }

      const docData = docs.get(file);
      return docData.text.toString();
    },

    getFiles(): string[] {
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
