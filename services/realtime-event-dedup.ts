// Bounded, session-local de-duplication of at-least-once notification hints.
// Legacy frames without an id are intentionally not suppressed.
export const createRealtimeEventDeduplicator = (limit = 512) => {
    const seen = new Set<string>();
    return {
        accept(id: unknown) {
            if (typeof id !== 'string' || !id) return true;
            if (seen.has(id)) return false;
            seen.add(id);
            if (seen.size > limit) seen.delete(seen.values().next().value!);
            return true;
        },
        clear() { seen.clear(); },
    };
};
