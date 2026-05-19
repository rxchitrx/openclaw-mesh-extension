export type CapabilityRegistry = {
  add: (tag: string) => void;
  remove: (tag: string) => void;
  list: () => string[];
  has: (tag: string) => boolean;
};

function normalizeCapabilityTag(tag: string): string | null {
  const normalized = tag.trim();
  return normalized.length > 0 ? normalized : null;
}

export function createCapabilityRegistry(initialCapabilities: string[] = []): CapabilityRegistry {
  const capabilities = new Set<string>();

  const registry: CapabilityRegistry = {
    add(tag: string) {
      const normalized = normalizeCapabilityTag(tag);
      if (normalized) {
        capabilities.add(normalized);
      }
    },

    remove(tag: string) {
      const normalized = normalizeCapabilityTag(tag);
      if (normalized) {
        capabilities.delete(normalized);
      }
    },

    list() {
      return [...capabilities].sort();
    },

    has(tag: string) {
      const normalized = normalizeCapabilityTag(tag);
      return normalized ? capabilities.has(normalized) : false;
    },
  };

  for (const tag of initialCapabilities) {
    registry.add(tag);
  }

  return registry;
}
