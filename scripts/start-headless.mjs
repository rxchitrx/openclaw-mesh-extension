import * as fs from "fs";
import * as path from "path";
import { createDiscovery } from "../dist/src/discovery.js";
import { createTransport } from "../dist/src/transport.js";
import { createSyncState } from "../dist/src/sync-state.js";
import { createFileWatcher } from "../dist/src/file-watcher.js";

const nodeName = process.env.MESH_NODE_NAME || "headless-node";
const serverUrl = process.env.SIGNAL_URL;
const trackDir = process.argv[2] ? path.resolve(process.argv[2]) : process.cwd();

if (!serverUrl) {
  console.error("Missing SIGNAL_URL in environment.");
  process.exit(1);
}

const logger = {
  info: (msg) => console.log(msg),
  warn: (msg) => console.warn(msg),
  error: (msg) => console.error(msg),
  debug: () => {},
};

async function run() {
  console.log(`Starting headless mesh node '${nodeName}' tracking directory: ${trackDir}`);

  const discovery = createDiscovery({ nodeName, port: 18790, logger });
  const syncState = createSyncState({ nodeName, logger });
  const transport = createTransport({ nodeName, port: 18790, syncState, logger });

  transport.setWebRTCDialer(async (peerName) => {
    return await discovery.initiateWebRTCConnection(peerName);
  });
  discovery.onWebRTCConnection = (peerName, webrtcTransport, direction) => {
    transport.registerExternalTransport(peerName, webrtcTransport, direction, "signaling");
  };

  const fileWatcher = createFileWatcher({ workspaceDir: trackDir, syncState, logger, ignorePatterns: [".git", "node_modules"] });

  transport.setNodeInfoProvider(() => ({
    nodeName,
    trackingDir: trackDir,
    trackingFileCount: fileWatcher.getManifest().length,
    trackingFiles: fileWatcher.getManifest().map(f => f.relativePath),
    capabilities: [],
  }));

  transport.setFileContentProvider(async (relativePath) => fileWatcher.getFileContent(relativePath));
  transport.setManifestProvider(() => fileWatcher.getManifest());
  transport.setFileWriter(async (relativePath, contentOrTempPath, isBinary, isTempFile) => {
    const filePath = path.join(trackDir, relativePath);
    await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
    if (isTempFile) {
      await fs.promises.rename(contentOrTempPath, filePath);
    } else if (isBinary) {
      await fs.promises.writeFile(filePath, Buffer.from(contentOrTempPath, "base64"));
    } else {
      await fs.promises.writeFile(filePath, contentOrTempPath, "utf-8");
    }
    console.log(`Wrote received file: ${relativePath}`);
  });
  transport.setIgnoreNextChange((relativePath) => fileWatcher.ignoreNextChange(relativePath));

  transport.setNotificationHandler((notif) => {
    console.log(`[EVENT] ${notif.type}: ${notif.message}`);
    if (notif.type === "peer_pending") {
      console.log(`\n\n>>> ACTION REQUIRED: Run 'approve' to accept connection from ${notif.peerName} <<<\n`);
    }
  });

  await discovery.start();
  await transport.start();
  await discovery.connectSignaling(serverUrl);
  await fileWatcher.start();

  console.log("Headless node started successfully. Listening for signaling messages...");

  // Minimal CLI for approval/connections
  process.stdin.on("data", async (data) => {
    const input = data.toString().trim();
    if (input === "approve") {
      const pending = transport.getPendingConnections();
      if (pending.length > 0) {
        transport.approveConnection(pending[0].peerName);
        console.log(`Approved ${pending[0].peerName}`);
      } else {
        console.log("No pending connections.");
      }
    } else if (input.startsWith("connect ")) {
      const peer = input.split(" ")[1];
      const peers = discovery.getPeers();
      const p = peers.find(x => x.name === peer);
      if (p) transport.connectToPeer(p);
      else console.log(`Peer ${peer} not found in discovery.`);
    } else if (input === "peers") {
      console.log("Discovered peers:", discovery.getPeers().map(p => `${p.name} (${p.source})`));
    } else if (input === "sync") {
      const pending = syncState.getPendingChanges();
      console.log(`[DEBUG] Found ${pending.length} pending changes.`);
      if (pending.length === 0) {
        console.log("No pending changes to sync.");
        return;
      }
      const peers = transport.getConnections();
      console.log(`[DEBUG] Found ${peers.length} active peer connections:`, peers);
      
      console.log(`Syncing ${pending.length} files...`);
      for (const change of pending) {
        console.log(`[DEBUG] Reading file: ${change.relativePath}`);
        const file = await fileWatcher.getFileContent(change.relativePath);
        if (file) {
          console.log(`[DEBUG] File read successfully (${file.content.length} chars). Sending to peers...`);
          for (const peer of peers) {
            console.log(`[DEBUG] Sending to peer: ${peer}`);
            await transport.sendFileContent(peer, change.relativePath, file.content, file.isBinary);
          }
        } else {
          console.log(`[DEBUG] ERROR: Could not read file content for ${change.relativePath}!`);
        }
      }
      syncState.clearPendingChanges();
      console.log("Sync complete!");
    }
  });
}

run().catch(console.error);
