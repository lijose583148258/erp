export type ServerStateKey = readonly unknown[];

type QueryStatus = 'idle' | 'loading' | 'success' | 'error';

export type ServerStateSnapshot<T> = {
    status: QueryStatus;
    data?: T;
    error?: unknown;
    updatedAt: number;
    stale: boolean;
};

type CacheEntry<T> = {
    status: QueryStatus;
    data?: T;
    error?: unknown;
    updatedAt: number;
    promise?: Promise<T>;
};

type FetchQueryOptions<T> = {
    key: ServerStateKey;
    queryFn: (context: { signal?: AbortSignal }) => Promise<T>;
    ttlMs?: number;
    force?: boolean;
    signal?: AbortSignal;
};

const DEFAULT_TTL_MS = 30_000;

const stableKeyPart = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(stableKeyPart);
    if (value && typeof value === 'object') {
        return Object.keys(value as Record<string, unknown>)
            .sort()
            .reduce<Record<string, unknown>>((result, key) => {
                result[key] = stableKeyPart((value as Record<string, unknown>)[key]);
                return result;
            }, {});
    }
    return value;
};

export const serializeServerStateKey = (key: ServerStateKey): string => JSON.stringify(key.map(stableKeyPart));

class ServerStateClient {
    private cache = new Map<string, CacheEntry<unknown>>();
    private listeners = new Set<() => void>();

    getSnapshot<T>(key: ServerStateKey, ttlMs = DEFAULT_TTL_MS): ServerStateSnapshot<T> {
        const entry = this.cache.get(serializeServerStateKey(key)) as CacheEntry<T> | undefined;
        if (!entry) return { status: 'idle', updatedAt: 0, stale: true };
        return {
            status: entry.status,
            data: entry.data,
            error: entry.error,
            updatedAt: entry.updatedAt,
            stale: entry.updatedAt === 0 || Date.now() - entry.updatedAt > ttlMs,
        };
    }

    async fetchQuery<T>({ key, queryFn, ttlMs = DEFAULT_TTL_MS, force = false, signal }: FetchQueryOptions<T>): Promise<T> {
        const cacheKey = serializeServerStateKey(key);
        const existing = this.cache.get(cacheKey) as CacheEntry<T> | undefined;
        const isFresh = existing?.status === 'success' && Date.now() - existing.updatedAt <= ttlMs;
        if (!force && isFresh && existing.data !== undefined) return existing.data;
        if (!force && existing?.promise) return existing.promise;

        const promise = queryFn({ signal })
            .then((data) => {
                this.cache.set(cacheKey, { status: 'success', data, updatedAt: Date.now() });
                this.emit();
                return data;
            })
            .catch((error) => {
                const previous = this.cache.get(cacheKey) as CacheEntry<T> | undefined;
                this.cache.set(cacheKey, {
                    status: 'error',
                    data: previous?.data,
                    error,
                    updatedAt: previous?.updatedAt || 0,
                });
                this.emit();
                throw error;
            });

        this.cache.set(cacheKey, {
            status: 'loading',
            data: existing?.data,
            updatedAt: existing?.updatedAt || 0,
            promise,
        });
        this.emit();
        return promise;
    }

    setQueryData<T>(key: ServerStateKey, updater: T | ((previous: T | undefined) => T)): T {
        const cacheKey = serializeServerStateKey(key);
        const previous = this.cache.get(cacheKey) as CacheEntry<T> | undefined;
        const data = typeof updater === 'function'
            ? (updater as (previous: T | undefined) => T)(previous?.data)
            : updater;
        this.cache.set(cacheKey, { status: 'success', data, updatedAt: Date.now() });
        this.emit();
        return data;
    }

    invalidateQueries(prefix: ServerStateKey): number {
        const prefixText = serializeServerStateKey(prefix).slice(0, -1);
        let invalidated = 0;
        for (const [cacheKey, entry] of this.cache.entries()) {
            if (cacheKey.startsWith(prefixText)) {
                this.cache.set(cacheKey, { ...entry, updatedAt: 0 });
                invalidated += 1;
            }
        }
        if (invalidated) this.emit();
        return invalidated;
    }

    clear(): void {
        this.cache.clear();
        this.emit();
    }

    subscribe(listener: () => void): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    private emit(): void {
        for (const listener of this.listeners) listener();
    }
}

export const serverStateClient = new ServerStateClient();
