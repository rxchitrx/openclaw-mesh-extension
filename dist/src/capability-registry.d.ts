export type CapabilityRegistry = {
    add: (tag: string) => void;
    remove: (tag: string) => void;
    list: () => string[];
    has: (tag: string) => boolean;
};
export declare function createCapabilityRegistry(initialCapabilities?: string[]): CapabilityRegistry;
