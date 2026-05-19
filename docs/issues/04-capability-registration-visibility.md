# Capability registration and auto-exchange

## What to build

A new `src/capability-registry.ts` module that holds the node's declared capabilities as an in-memory set. Capabilities are flat tags (`has:xcode`, `os:macos`, `can:ios-build`).

The registry is initialized from a `capabilities` array in the plugin config. On connect, capabilities are automatically included in the `node_info` manifest so every peer sees what every other peer can do without extra round-trips.

`mesh_status` is updated to show local and per-peer capabilities alongside the existing peer info.

## Interface (from PRD prototype)

```ts
interface CapabilityRegistry {
  add(tag: string): void
  remove(tag: string): void
  list(): string[]
  has(tag: string): boolean
}
```

## Acceptance criteria

- [ ] `src/capability-registry.ts` exists with the full interface
- [ ] Plugin config schema (`openclaw.plugin.json`) accepts `capabilities` as an array of strings
- [ ] `MeshConfig` type includes `capabilities`
- [ ] Registry is initialized from config on startup
- [ ] `NodeInfo` type, its validator, and provider chain include `capabilities: string[]`
- [ ] Capabilities are auto-exchanged in `node_info` on every connect/reconnect
- [ ] `mesh_status` shows local capabilities and each peer's capabilities
- [ ] A test script (`scripts/test-capability-registry.mjs`) tests add, remove, list, has in isolation
- [ ] Protocol validation test covers the new `capabilities` field in `node_info`

## Blocked by

None — can start immediately.
