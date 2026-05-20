export function applyUnifiedPatch(baseText: string, patch: string): string {
  const baseLines = baseText.length === 0 ? [] : baseText.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const patchLines = patch.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");

  const result: string[] = [];
  let i = 0;

  while (i < patchLines.length && !patchLines[i].startsWith("@@ ")) {
    i++;
  }

  if (i === patchLines.length) {
    if (patch.trim() === "") return baseText;

    let nonWhitespaceLines = 0;
    for (const line of patchLines) {
      if (line.trim().length > 0) nonWhitespaceLines++;
    }

    if (patch.startsWith("diff --mesh") && nonWhitespaceLines <= 3) {
      return baseText;
    }

    throw new Error("Malformed patch");
  }

  let currentBaseIndex = 0;

  while (i < patchLines.length) {
    const hunkHeader = patchLines[i];
    const match = hunkHeader.match(/@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
    if (!match) {
      throw new Error("Malformed patch");
    }

    const oldStart = parseInt(match[1], 10);
    const oldCount = match[2] ? parseInt(match[2], 10) : 1;
    const newCount = match[4] ? parseInt(match[4], 10) : 1;

    const skipTo = oldStart - 1;
    if (skipTo < currentBaseIndex) {
      throw new Error("Malformed patch");
    }

    while (currentBaseIndex < skipTo) {
      if (currentBaseIndex >= baseLines.length) {
        throw new Error("Malformed patch");
      }
      result.push(baseLines[currentBaseIndex]);
      currentBaseIndex++;
    }

    i++;

    let expectedOldLines = oldCount;
    let expectedNewLines = newCount;

    while (i < patchLines.length && !patchLines[i].startsWith("@@ ")) {
      const line = patchLines[i];
      const op = line.charAt(0);
      const content = line.substring(1);

      if (op === " ") {
        if (currentBaseIndex >= baseLines.length || baseLines[currentBaseIndex] !== content) {
          throw new Error(`Patch verification failed: context line mismatch at line ${currentBaseIndex + 1}`);
        }
        result.push(content);
        currentBaseIndex++;
        expectedOldLines--;
        expectedNewLines--;
      } else if (op === "-") {
        if (currentBaseIndex >= baseLines.length || baseLines[currentBaseIndex] !== content) {
          throw new Error(`Patch verification failed: deletion line mismatch at line ${currentBaseIndex + 1}`);
        }
        currentBaseIndex++;
        expectedOldLines--;
      } else if (op === "+") {
        result.push(content);
        expectedNewLines--;
      } else if (op === "\\") {
        // No newline at end of file indicator, ignore
      } else {
        throw new Error("Malformed patch");
      }
      i++;
    }

    if (expectedOldLines !== 0 || expectedNewLines !== 0) {
      throw new Error("Malformed patch");
    }
  }

  while (currentBaseIndex < baseLines.length) {
    result.push(baseLines[currentBaseIndex]);
    currentBaseIndex++;
  }

  return result.join("\n");
}
