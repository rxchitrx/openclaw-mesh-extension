function byteLength(text) {
    return text ? Buffer.byteLength(text, "utf-8") : 0;
}
function formatLine(prefix, line) {
    return `${prefix}${line}`;
}
function splitLines(text) {
    if (text.length === 0)
        return [];
    return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
}
function buildLcsOps(before, after) {
    const rows = before.length + 1;
    const cols = after.length + 1;
    const dp = Array.from({ length: rows }, () => Array(cols).fill(0));
    for (let i = before.length - 1; i >= 0; i -= 1) {
        for (let j = after.length - 1; j >= 0; j -= 1) {
            dp[i][j] = before[i] === after[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
        }
    }
    const ops = [];
    let i = 0;
    let j = 0;
    while (i < before.length || j < after.length) {
        if (i < before.length && j < after.length && before[i] === after[j]) {
            ops.push({ type: "context", line: before[i], oldLine: i + 1, newLine: j + 1 });
            i += 1;
            j += 1;
        }
        else if (j < after.length && (i === before.length || dp[i][j + 1] >= dp[i + 1][j])) {
            ops.push({ type: "add", line: after[j], newLine: j + 1 });
            j += 1;
        }
        else if (i < before.length) {
            ops.push({ type: "remove", line: before[i], oldLine: i + 1 });
            i += 1;
        }
    }
    return ops;
}
function unifiedPatch(path, beforeText, afterText, contextLines) {
    const before = splitLines(beforeText);
    const after = splitLines(afterText);
    const ops = buildLcsOps(before, after);
    const changed = new Set();
    for (let index = 0; index < ops.length; index += 1) {
        if (ops[index].type !== "context") {
            for (let offset = -contextLines; offset <= contextLines; offset += 1) {
                const target = index + offset;
                if (target >= 0 && target < ops.length)
                    changed.add(target);
            }
        }
    }
    if (changed.size === 0) {
        return `diff --mesh a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n`;
    }
    const selected = [...changed].sort((a, b) => a - b);
    const chunks = [];
    for (const index of selected) {
        const last = chunks[chunks.length - 1];
        if (!last || index > last[last.length - 1] + 1) {
            chunks.push([index]);
        }
        else {
            last.push(index);
        }
    }
    const lines = [`diff --mesh a/${path} b/${path}`, `--- a/${path}`, `+++ b/${path}`];
    for (const chunk of chunks) {
        const firstOp = ops[chunk[0]];
        const lastOp = ops[chunk[chunk.length - 1]];
        const oldStart = firstOp.oldLine ?? firstOp.newLine ?? 1;
        const newStart = firstOp.newLine ?? firstOp.oldLine ?? 1;
        const oldEnd = lastOp.oldLine ?? oldStart;
        const newEnd = lastOp.newLine ?? newStart;
        lines.push(`@@ -${oldStart},${Math.max(1, oldEnd - oldStart + 1)} +${newStart},${Math.max(1, newEnd - newStart + 1)} @@`);
        for (const index of chunk) {
            const op = ops[index];
            if (op.type === "context")
                lines.push(formatLine(" ", op.line));
            if (op.type === "remove")
                lines.push(formatLine("-", op.line));
            if (op.type === "add")
                lines.push(formatLine("+", op.line));
        }
    }
    return lines.join("\n");
}
export function createDiffPreview(options) {
    const contextLines = Math.max(0, Math.min(options.contextLines ?? 3, 20));
    const maxBytes = Math.max(1024, options.maxBytes ?? 200000);
    const local = options.local;
    const remote = options.remote;
    const localFile = local?.file;
    const remoteFile = remote?.file;
    const isBinary = !!(localFile?.isBinary || remoteFile?.isBinary);
    const localSize = localFile?.size;
    const remoteSize = remoteFile?.size;
    const localHash = localFile?.hash;
    const remoteHash = remoteFile?.hash;
    if (isBinary) {
        return {
            path: options.path,
            kind: "binary",
            isBinary: true,
            localHash,
            remoteHash,
            localSize,
            remoteSize,
            summary: `Binary file differs: local ${localSize ?? 0}b ${localHash || "missing"} / remote ${remoteSize ?? 0}b ${remoteHash || "missing"}.`,
        };
    }
    const localContent = local?.content ?? "";
    const remoteContent = remote?.content ?? "";
    const totalBytes = byteLength(localContent) + byteLength(remoteContent);
    const kind = !localFile && remoteFile ? "deleted" : localFile && !remoteFile ? "added" : localHash === remoteHash ? "unchanged" : "modified";
    if (totalBytes > maxBytes) {
        return {
            path: options.path,
            kind: "large",
            isBinary: false,
            localHash,
            remoteHash,
            localSize,
            remoteSize,
            summary: `Text file differs but is too large to preview safely (${totalBytes} bytes > ${maxBytes} byte limit).`,
        };
    }
    const patch = unifiedPatch(options.path, remoteContent, localContent, contextLines);
    return {
        path: options.path,
        kind,
        isBinary: false,
        localHash,
        remoteHash,
        localSize,
        remoteSize,
        patch,
        summary: kind === "added"
            ? `Local file '${options.path}' is not on the peer.`
            : kind === "deleted"
                ? `Remote file '${options.path}' is not local.`
                : kind === "unchanged"
                    ? `File '${options.path}' is in sync.`
                    : `Text file '${options.path}' differs.`,
    };
}
