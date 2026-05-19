import assert from "node:assert/strict";

import { createCapabilityRegistry } from "../dist/src/capability-registry.js";

const registry = createCapabilityRegistry(["has:xcode", " os:macos ", "", "has:xcode"]);

assert.equal(registry.has("has:xcode"), true);
assert.equal(registry.has("os:macos"), true);
assert.equal(registry.has(""), false);
assert.deepEqual(registry.list(), ["has:xcode", "os:macos"]);

registry.add("can:ios-build");
registry.add(" can:simulator ");
assert.equal(registry.has("can:ios-build"), true);
assert.equal(registry.has("can:simulator"), true);
assert.deepEqual(registry.list(), ["can:ios-build", "can:simulator", "has:xcode", "os:macos"]);

registry.remove(" has:xcode ");
registry.remove("");
assert.equal(registry.has("has:xcode"), false);
assert.deepEqual(registry.list(), ["can:ios-build", "can:simulator", "os:macos"]);

console.log("capability-registry tests passed");
