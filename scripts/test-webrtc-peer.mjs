import { createDiscovery } from "../dist/src/discovery.js";

const nodeName = process.argv[2];
const serverUrl = process.argv[3];
const targetPeer = process.argv[4];

if (!nodeName || !serverUrl) {
  console.error("Usage: node scripts/test-webrtc-peer.mjs <your-node-name> <signaling-server-url> [target-peer-to-ping]");
  process.exit(1);
}

const logger = {
  info: (msg) => console.log(msg),
  warn: (msg) => console.warn(msg),
  error: (msg) => console.error(msg),
};

async function run() {
  const discovery = createDiscovery({ nodeName, port: 9999, logger });
  
  await discovery.connectSignaling(serverUrl);
  
  if (targetPeer) {
    console.log(`\n⏳ Waiting 2 seconds for signaling registration before initiating WebRTC test to ${targetPeer}...`);
    setTimeout(() => {
      discovery.initiateWebRTCTest(targetPeer).catch(e => console.error(e));
    }, 2000);
  } else {
    console.log(`\n🎧 Listening for incoming WebRTC connections as '${nodeName}'...`);
  }
}

run();
