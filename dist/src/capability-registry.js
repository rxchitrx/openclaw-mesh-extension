function normalizeCapabilityTag(tag) {
    const normalized = tag.trim();
    return normalized.length > 0 ? normalized : null;
}
export function createCapabilityRegistry(initialCapabilities = []) {
    const capabilities = new Set();
    const registry = {
        add(tag) {
            const normalized = normalizeCapabilityTag(tag);
            if (normalized) {
                capabilities.add(normalized);
            }
        },
        remove(tag) {
            const normalized = normalizeCapabilityTag(tag);
            if (normalized) {
                capabilities.delete(normalized);
            }
        },
        list() {
            return [...capabilities].sort();
        },
        has(tag) {
            const normalized = normalizeCapabilityTag(tag);
            return normalized ? capabilities.has(normalized) : false;
        },
    };
    for (const tag of initialCapabilities) {
        registry.add(tag);
    }
    return registry;
}
