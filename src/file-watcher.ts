import * as fs from "fs";
import * as path from "path";
import type { CRDTService } from "./crdt.js";

export type FileWatcherConfig = {
  workspaceDir: string;
  crdt: CRDTService;
  logger: any;
};

export type FileWatcherService = {
  start: () => Promise<void>;
  stop: () => Promise<void>;
  getWatchedFiles: () => string[];
  syncAllFiles: () => Promise<void>;
};

const IGNORE_PATTERNS = [/node_modules/, /\.git/, /dist/, /\.DS_Store/, /Thumbs\.db/];

const TEXT_EXTENSIONS = [
  ".md", ".txt", ".json", ".ts", ".js", ".tsx", ".jsx",
  ".yml", ".yaml", ".toml", ".ini", ".env",
  ".html", ".css", ".scss", ".xml", ".sh", ".bash", ".zsh",
];

export function createFileWatcher(config: FileWatcherConfig): FileWatcherService {
  const { workspaceDir, crdt, logger } = config;

  const watchedFiles = new Set<string>();
  const fileContents = new Map<string, string>();
  let watcher: fs.FSWatcher | null = null;

  const shouldWatch = (filePath: string): boolean => {
    for (const pattern of IGNORE_PATTERNS) {
      if (pattern.test(filePath)) {
        return false;
      }
    }

    const ext = path.extname(filePath).toLowerCase();
    return TEXT_EXTENSIONS.includes(ext);
  };

  const readFile = async (filePath: string): Promise<string | null> => {
    try {
      const content = await fs.promises.readFile(filePath, "utf-8");
      return content;
    } catch (err) {
      logger.error(`Failed to read ${filePath}: ${err}`);
      return null;
    }
  };

  const handleFileChange = async (filePath: string) => {
    if (!shouldWatch(filePath)) return;

    const relativePath = path.relative(workspaceDir, filePath);
    const content = await readFile(filePath);

    if (content === null) return;

    const prevContent = fileContents.get(relativePath);
    if (prevContent === content) return;

    const delta = await crdt.applyLocalChange(relativePath, content);

    if (delta) {
      fileContents.set(relativePath, content);
      watchedFiles.add(relativePath);
      logger.info(`File synced: ${relativePath} (${content.length} chars, ${watchedFiles.size} files watched)`);
    }
  };

  return {
    async start() {
      logger.info(`Mesh file watcher starting: ${workspaceDir}`);

      await this.syncAllFiles();

      watcher = fs.watch(workspaceDir, { recursive: true }, async (event, filename) => {
        if (!filename) return;

        const filePath = path.join(workspaceDir, filename);

        if (event === "change" || event === "rename") {
          await handleFileChange(filePath);
        }
      });

      watcher.on("error", (err) => {
        logger.error(`File watcher error: ${err}`);
      });

      logger.info(`File watcher started: ${watchedFiles.size} files`);
    },

    async stop() {
      if (watcher) {
        watcher.close();
        watcher = null;
        logger.info("File watcher stopped");
      }
    },

    getWatchedFiles() {
      return Array.from(watchedFiles);
    },

    async syncAllFiles() {
      const scanDir = async (dir: string) => {
        const entries = await fs.promises.readdir(dir, { withFileTypes: true });

        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);

          if (entry.isDirectory()) {
            if (!IGNORE_PATTERNS.some((p) => p.test(entry.name))) {
              await scanDir(fullPath);
            }
          } else if (entry.isFile()) {
            if (shouldWatch(fullPath)) {
              await handleFileChange(fullPath);
            }
          }
        }
      };

      try {
        await scanDir(workspaceDir);
        logger.info(`Synced all files: ${watchedFiles.size} files`);
      } catch (err) {
        logger.error(`Failed to sync files: ${err}`);
      }
    },
  };
}
