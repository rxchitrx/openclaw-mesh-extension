import type { PluginLogger } from "openclaw/plugin-sdk";

export type CRDTConfig = {
  nodeName: string;
  logger: PluginLogger;
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
  applyLocalChange: (file: string, content: string) => Delta | null;
  applyRemoteDelta: (delta: Delta, file: string) => void;
  mergeState: (state: any, file: string) => void;
  getFileContent: (file: string) => string | null;
  getFiles: () => string[];
  syncPendingDeltas: () => Promise<void>;
  getPendingDeltas: () => Delta[];
};

export function createCRDT(config: CRDTConfig): CRDTService {
  const { nodeName, logger } = config;

  // Y.Doc for each file
  const docs = new Map<string, any>();
  const pendingDeltas: Delta[] = [];

  const getOrCreateDoc = (file: string): any => {
    if (!docs.has(file)) {
      // Lazy import Yjs
      const Y = require("yjs");
      const doc = new Y.Doc();

      // Get the text type for this document
      const text = doc.getText("content");

      docs.set(file, { doc, text });
      logger.debug(`Created Yjs doc for: ${file}`);
    }

    return docs.get(file);
  };

  return {
    getState(file?: string) {
      if (file) {
        const docData = getOrCreateDoc(file);
        return {
          file,
          content: docData.text.toString(),
          vector: docData.doc.store.clientVectors,
        };
      }

      // Return all files
      const state: Record<string, any> = {};
      for (const [path, docData] of docs) {
        state[path] = {
          content: docData.text.toString(),
          vector: docData.doc.store.clientVectors,
        };
      }
      return state;
    },

    applyLocalChange(file: string, content: string): Delta | null {
      try {
        const docData = getOrCreateDoc(file);
        const { doc, text } = docData;

        // Get current content
        const currentContent = text.toString();

        if (currentContent === content) {
          return null; // No change
        }

        // Simple approach: replace entire content
        // TODO: Use diff algorithm for better delta
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
        logger.debug(`Applied local change to: ${file}`);

        return delta;
      } catch (err) {
        logger.error(`Failed to apply change to ${file}: ${err}`);
        return null;
      }
    },

    applyRemoteDelta(delta: Delta, file: string) {
      try {
        const docData = getOrCreateDoc(file);
        const { doc, text } = docData;

        // Apply the delta
        doc.transact(() => {
          for (const change of delta.changes) {
            if (change.type === "replace") {
              text.delete(0, text.length);
              text.insert(0, change.content);
            }
            // TODO: Handle more granular changes
          }
        });

        logger.info(`Applied remote delta to ${file} from ${delta.author}`);
      } catch (err) {
        logger.error(`Failed to apply remote delta: ${err}`);
      }
    },

    mergeState(state: any, file: string) {
      try {
        const docData = getOrCreateDoc(file);
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
      // This is called on heartbeat
      // The transport service will broadcast these
      // For now, just clean up old deltas (older than 5 min)
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
