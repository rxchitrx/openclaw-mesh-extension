import * as path from "path";

const WINDOWS_DRIVE_PATH = /^[a-zA-Z]:/;

export function normalizeRelativePath(input: unknown): string | null {
  if (typeof input !== "string") return null;
  if (input.includes("\0")) return null;

  const raw = input.trim();
  if (!raw) return null;
  if (WINDOWS_DRIVE_PATH.test(raw)) return null;

  const slashPath = raw.replace(/\\/g, "/");
  if (slashPath.startsWith("/")) return null;

  const normalized = path.posix.normalize(slashPath);
  if (!normalized || normalized === ".") return null;

  const parts = normalized.split("/");
  if (parts.includes("..")) return null;

  return normalized;
}

export function resolveInsideRoot(rootDir: string, relativePath: string): string | null {
  const safeRelativePath = normalizeRelativePath(relativePath);
  if (!safeRelativePath) return null;

  const root = path.resolve(rootDir);
  const target = path.resolve(root, safeRelativePath);
  const relativeToRoot = path.relative(root, target);

  if (!relativeToRoot || relativeToRoot.startsWith("..") || path.isAbsolute(relativeToRoot)) {
    return null;
  }

  return target;
}
