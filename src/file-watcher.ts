import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import type { SyncStateService } from "./sync-state.js";
import { normalizeRelativePath, resolveInsideRoot } from "./path-safety.js";

export type FileWatcherConfig = {
  workspaceDir: string;
  syncState: SyncStateService;
  logger: any;
  ignorePatterns?: string[];
};

export type TrackedFile = {
  relativePath: string;
  isBinary: boolean;
  hash: string;
  size: number;
};

export type FileWatcherService = {
  start: () => Promise<void>;
  stop: () => Promise<void>;
  getWatchedFiles: () => string[];
  getManifest: () => TrackedFile[];
  syncAllFiles: () => Promise<void>;
  getFileContent: (relativePath: string) => Promise<{ content: string; isBinary: boolean } | null>;
  ignoreNextChange: (relativePath: string) => void;
  onFileDeleted: ((relativePath: string) => void) | null;
};

const DEFAULT_IGNORE_PATTERNS = [/node_modules/, /\.git/, /dist/, /\.DS_Store/, /Thumbs\.db/];

const TEXT_EXTENSIONS = new Set([
  ".md", ".txt", ".json", ".ts", ".js", ".tsx", ".jsx",
  ".yml", ".yaml", ".toml", ".ini", ".env",
  ".html", ".css", ".scss", ".xml", ".sh", ".bash", ".zsh",
  ".py", ".rb", ".go", ".rs", ".java", ".kt", ".swift", ".c", ".cpp", ".h",
  ".sql", ".graphql", ".vue", ".svelte",
  ".gitignore", ".editorconfig", ".prettierrc", ".eslintrc",
  ".lock", ".log", ".conf", ".cfg",
]);

export function createFileWatcher(config: FileWatcherConfig): FileWatcherService {
  const { workspaceDir, syncState, logger } = config;

  const watchedFiles = new Map<string, TrackedFile>();
  const fileContents = new Map<string, string>();
  const fileRealPaths = new Map<string, string>();
  const ignoreChanges = new Map<string, number>();
  let watcher: fs.FSWatcher | null = null;
  let onFileDeleted: ((relativePath: string) => void) | null = null;
  const IGNORE_WINDOW_MS = 2000;
  const workspaceRealDir = fs.realpathSync(workspaceDir);
  const ignorePatterns = [
    ...DEFAULT_IGNORE_PATTERNS,
    ...(config.ignorePatterns ?? []).flatMap((pattern) => {
      try {
        return [new RegExp(pattern)];
      } catch (err) {
        logger.warn(`Ignoring invalid file watcher ignore pattern '${pattern}': ${err}`);
        return [];
      }
    }),
  ];

  const shouldWatch = (filePath: string): boolean => {
    for (const pattern of ignorePatterns) {
      if (pattern.test(filePath)) return false;
    }
    return true;
  };

  const isInsideWorkspace = (realPath: string): boolean => {
    const relative = path.relative(workspaceRealDir, realPath);
    return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
  };

  const resolveWatchedPath = (filePath: string, action: "change" | "delete"): {
    relativePath: string;
    realPath: string | null;
  } | null => {
    const relativePath = path.relative(workspaceDir, filePath);
    try {
      const realPath = fs.realpathSync(filePath);
      if (!isInsideWorkspace(realPath)) {
        logger.warn(`Skipping ${action} outside tracked workspace via symlink: ${relativePath} -> ${realPath}`);
        return null;
      }
      return { relativePath, realPath };
    } catch (err: any) {
      if (action === "delete" && watchedFiles.has(relativePath)) {
        return { relativePath, realPath: fileRealPaths.get(relativePath) ?? null };
      }
      if (err?.code !== "ENOENT") {
        logger.warn(`Skipping ${action} for unreadable path ${relativePath}: ${err}`);
      }
      return null;
    }
  };

  const isBinaryFile = (filePath: string): boolean => {
    const ext = path.extname(filePath).toLowerCase();
    if (TEXT_EXTENSIONS.has(ext)) return false;
    if (ext === "" || ext === ".example" || ext === ".sample") return false;
    const binaryExts = new Set([
      ".png", ".jpg", ".jpeg", ".gif", ".bmp", ".ico", ".webp", ".svg",
      ".mp3", ".mp4", ".wav", ".avi", ".mov", ".mkv", ".flac", ".ogg",
      ".zip", ".tar", ".gz", ".bz2", ".xz", ".7z", ".rar",
      ".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx",
      ".exe", ".dll", ".so", ".dylib", ".wasm",
      ".sqlite", ".db",
    ]);
    return binaryExts.has(ext);
  };

  const computeHash = (content: string | Buffer): string => {
    return crypto.createHash("sha256").update(content).digest("hex").slice(0, 16);
  };

  const readFileAsText = async (filePath: string): Promise<string | null> => {
    try {
      return await fs.promises.readFile(filePath, "utf-8");
    } catch (err) {
      logger.error(`Failed to read ${filePath}: ${err}`);
      return null;
    }
  };

  const readFileAsBase64 = async (filePath: string): Promise<string | null> => {
    try {
      const content = await fs.promises.readFile(filePath);
      return content.toString("base64");
    } catch (err) {
      logger.error(`Failed to read binary ${filePath}: ${err}`);
      return null;
    }
  };

  const getFileSize = async (filePath: string): Promise<number> => {
    try {
      const stat = await fs.promises.stat(filePath);
      return stat.size;
    } catch {
      return 0;
    }
  };

  const handleFileChange = async (filePath: string) => {
    if (!shouldWatch(filePath)) return;

    const resolved = resolveWatchedPath(filePath, "change");
    if (!resolved) return;
    const { relativePath, realPath } = resolved;
    if (!realPath) return;

    const ignoreUntil = ignoreChanges.get(relativePath);
    if (ignoreUntil && Date.now() < ignoreUntil) {
      const binary = isBinaryFile(filePath);
      let content: string | null;
      if (binary) {
        content = await readFileAsBase64(filePath);
      } else {
        content = await readFileAsText(filePath);
      }
      if (content !== null) {
        const hash = computeHash(content);
        const size = await getFileSize(filePath);
        watchedFiles.set(relativePath, { relativePath, isBinary: binary, hash, size });
        fileContents.set(relativePath, content);
        fileRealPaths.set(relativePath, realPath);
        syncState.recordSyncedHash(relativePath, hash);
        logger.debug(`Updated cache for received file: ${relativePath}`);
      }
      return;
    }

    if (ignoreUntil) {
      ignoreChanges.delete(relativePath);
    }

    const binary = isBinaryFile(filePath);

    let content: string | null;
    if (binary) {
      content = await readFileAsBase64(filePath);
    } else {
      content = await readFileAsText(filePath);
    }

    if (content === null) return;

    const hash = computeHash(content);
    const size = await getFileSize(filePath);

    const prev = watchedFiles.get(relativePath);
    if (prev && prev.hash === hash) return;

    const tracked: TrackedFile = { relativePath, isBinary: binary, hash, size };
    watchedFiles.set(relativePath, tracked);
    fileContents.set(relativePath, content);
    fileRealPaths.set(relativePath, realPath);

    syncState.recordLocalChange(relativePath, hash, binary);
    logger.info(`File change detected: ${relativePath} (${content.length} chars, ${watchedFiles.size} files watched)`);
  };

  const handleFileDeletion = (filePath: string) => {
    if (!shouldWatch(filePath)) return;

    const resolved = resolveWatchedPath(filePath, "delete");
    if (!resolved) return;
    const { relativePath } = resolved;
    if (watchedFiles.has(relativePath)) {
      watchedFiles.delete(relativePath);
      fileContents.delete(relativePath);
      fileRealPaths.delete(relativePath);
      syncState.removeFile(relativePath);
      logger.info(`File deleted: ${relativePath} (${watchedFiles.size} files watched)`);

      if (onFileDeleted) {
        onFileDeleted(relativePath);
      }
    }
  };

  return {
    async start() {
      logger.info(`Mesh file watcher starting: ${workspaceDir}`);

      await this.syncAllFiles();

      syncState.markAllSynced();

      watcher = fs.watch(workspaceDir, { recursive: true }, async (event, filename) => {
        if (!filename) return;

        const filePath = path.join(workspaceDir, filename);

        if (event === "rename") {
          try {
            const stat = await fs.promises.stat(filePath);
            if (stat.isFile()) {
              await handleFileChange(filePath);
            }
          } catch {
            if (watchedFiles.has(path.relative(workspaceDir, filePath))) {
              handleFileDeletion(filePath);
            }
          }
        } else if (event === "change") {
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
      return Array.from(watchedFiles.keys());
    },

    getManifest() {
      return Array.from(watchedFiles.values());
    },

    async syncAllFiles() {
      const scanDir = async (dir: string) => {
        const entries = await fs.promises.readdir(dir, { withFileTypes: true });

        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);

          if (entry.isDirectory()) {
            if (shouldWatch(fullPath)) {
              await scanDir(fullPath);
            }
          } else if (entry.isFile() || entry.isSymbolicLink()) {
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

    async getFileContent(relativePath: string): Promise<{ content: string; isBinary: boolean } | null> {
      const safeRelativePath = normalizeRelativePath(relativePath);
      if (!safeRelativePath) return null;

      const tracked = watchedFiles.get(safeRelativePath);
      if (!tracked) return null;

      const cached = fileContents.get(safeRelativePath);
      if (cached !== undefined) {
        return { content: cached, isBinary: tracked.isBinary };
      }

      const filePath = resolveInsideRoot(workspaceDir, safeRelativePath);
      if (!filePath) return null;
      if (tracked.isBinary) {
        const content = await readFileAsBase64(filePath);
        return content ? { content, isBinary: true } : null;
      } else {
        const content = await readFileAsText(filePath);
        return content !== null ? { content, isBinary: false } : null;
      }
    },

    ignoreNextChange(relativePath: string) {
      ignoreChanges.set(relativePath, Date.now() + IGNORE_WINDOW_MS);
    },

    get onFileDeleted() {
      return onFileDeleted;
    },

    set onFileDeleted(fn: ((relativePath: string) => void) | null) {
      onFileDeleted = fn;
    },
  };
}
