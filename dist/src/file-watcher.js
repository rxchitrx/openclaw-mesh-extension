import * as fs from "fs";
import * as path from "path";
const IGNORE_PATTERNS = [/node_modules/, /\.git/, /dist/, /\.DS_Store/, /Thumbs\.db/];
const TEXT_EXTENSIONS = [
    ".md", ".txt", ".json", ".ts", ".js", ".tsx", ".jsx",
    ".yml", ".yaml", ".toml", ".ini", ".env",
    ".html", ".css", ".scss", ".xml", ".sh", ".bash", ".zsh",
];
export function createFileWatcher(config) {
    const { workspaceDir, crdt, logger } = config;
    const watchedFiles = new Set();
    const fileContents = new Map();
    let watcher = null;
    const shouldWatch = (filePath) => {
        for (const pattern of IGNORE_PATTERNS) {
            if (pattern.test(filePath)) {
                return false;
            }
        }
        const ext = path.extname(filePath).toLowerCase();
        return TEXT_EXTENSIONS.includes(ext);
    };
    const readFile = async (filePath) => {
        try {
            const content = await fs.promises.readFile(filePath, "utf-8");
            return content;
        }
        catch (err) {
            logger.error(`Failed to read ${filePath}: ${err}`);
            return null;
        }
    };
    const handleFileChange = async (filePath) => {
        if (!shouldWatch(filePath))
            return;
        const relativePath = path.relative(workspaceDir, filePath);
        const content = await readFile(filePath);
        if (content === null)
            return;
        const prevContent = fileContents.get(relativePath);
        if (prevContent === content)
            return;
        // Always track the file even if CRDT has no diff (e.g. empty file on first scan)
        fileContents.set(relativePath, content);
        watchedFiles.add(relativePath);
        const delta = await crdt.applyLocalChange(relativePath, content);
        if (delta) {
            logger.info(`File synced: ${relativePath} (${content.length} chars, ${watchedFiles.size} files watched)`);
        }
    };
    return {
        async start() {
            logger.info(`Mesh file watcher starting: ${workspaceDir}`);
            await this.syncAllFiles();
            watcher = fs.watch(workspaceDir, { recursive: true }, async (event, filename) => {
                if (!filename)
                    return;
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
            const scanDir = async (dir) => {
                const entries = await fs.promises.readdir(dir, { withFileTypes: true });
                for (const entry of entries) {
                    const fullPath = path.join(dir, entry.name);
                    if (entry.isDirectory()) {
                        if (!IGNORE_PATTERNS.some((p) => p.test(entry.name))) {
                            await scanDir(fullPath);
                        }
                    }
                    else if (entry.isFile()) {
                        if (shouldWatch(fullPath)) {
                            await handleFileChange(fullPath);
                        }
                    }
                }
            };
            try {
                await scanDir(workspaceDir);
                logger.info(`Synced all files: ${watchedFiles.size} files`);
            }
            catch (err) {
                logger.error(`Failed to sync files: ${err}`);
            }
        },
    };
}
