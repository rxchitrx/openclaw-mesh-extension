import assert from "node:assert/strict";

import { createCapabilityRegistry } from "../dist/src/capability-registry.js";
import { createMeshAdvertiseTool } from "../dist/src/tools/advertise.js";

const registry = createCapabilityRegistry(["has:node"]);
let broadcasts = 0;
const tool = createMeshAdvertiseTool({
  capabilityRegistry: registry,
  transport: {
    broadcastNodeInfo() {
      broadcasts += 1;
    },
  },
}, {});

const listInitial = await tool.execute("call-1", { action: "list" }, undefined, undefined);
assert.equal(listInitial.details.ok, true);
assert.deepEqual(listInitial.details.capabilities, ["has:node"]);
assert.equal(broadcasts, 0);

const addResult = await tool.execute("call-2", { action: "add", tag: " can:docker " }, undefined, undefined);
assert.equal(addResult.details.ok, true);
assert.equal(registry.has("can:docker"), true);
assert.equal(broadcasts, 1);
assert.deepEqual(addResult.details.capabilities, ["can:docker", "has:node"]);

const removeResult = await tool.execute("call-3", { action: "remove", tag: "has:node" }, undefined, undefined);
assert.equal(removeResult.details.ok, true);
assert.equal(registry.has("has:node"), false);
assert.equal(broadcasts, 2);
assert.deepEqual(removeResult.details.capabilities, ["can:docker"]);

const missingTag = await tool.execute("call-4", { action: "add" }, undefined, undefined);
assert.equal(missingTag.details.ok, false);
assert.equal(missingTag.details.error, "missing_tag");
assert.equal(broadcasts, 2);

const invalidAction = await tool.execute("call-5", { action: "toggle", tag: "has:xcode" }, undefined, undefined);
assert.equal(invalidAction.details.ok, false);
assert.equal(invalidAction.details.error, "invalid_action");
assert.equal(broadcasts, 2);

console.log("advertise-tool tests passed");
