import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react';

type QueryStatus = 'idle' | 'loading' | 'success' | 'error';

type CacheEntry<T> = {
  data?: T;
  error?: unknown;
  updatedAt: number;
  promise?: Promise<T>;
};

export type ServerStateQueryResult<T> = {
  data: T | undefined;
  error: unknown;
  isError: boolean;
  isFetching: boolean;
  isLoading: boolean;
  isSuccess: boolean;
  refetch: () => Promise<T | undefined>;
  status: QueryStatus;
  updatedAt: number;
};

type ServerStateQueryOptions<T> = {
  enabled?: boolean;
  staleTimeMs?: number;
  initialData?: T;
};

type QuerySnapshot<T> = {
  data: T | undefined;
  error: unknown | undefined;
  status: QueryStatus;
  updatedAt: number;
};

const DEFAULT_STALE_TIME_MS = 30_000;
const serverStateCache = new Map<string, CacheEntry<unknown>>();

const now = () => Date.now();

const isFresh = (entry: CacheEntry<unknown> | undefined, staleTimeMs: number) =>
  Boolean(entry?.data !== undefined && now() - entry.updatedAt <= staleTimeMs);

export const invalidateServerStateQuery = (key: string) => {
  serverStateCache.delete(key);
};

export const clearServerStateQueryCache = () => {
  serverStateCache.clear();
};

export const getServerStateCacheSize = () => serverStateCache.size;

async function fetchServerState<T>(
  key: string,
  queryFn: (signal: AbortSignal) => Promise<T>,
  staleTimeMs: number,
  signal: AbortSignal,
) {
  const cached = serverStateCache.get(key) as CacheEntry<T> | undefined;
  if (isFresh(cached, staleTimeMs)) return cached?.data as T;
  if (cached?.promise) return cached.promise;

  const promise = queryFn(signal)
    .then((data) => {
      serverStateCache.set(key, { data, updatedAt: now() });
      return data;
    })
    .catch((error) => {
      serverStateCache.set(key, { error, updatedAt: now() });
      throw error;
    })
    .finally(() => {
      const current = serverStateCache.get(key);
      if (current?.promise === promise) {
        delete current.promise;
        serverStateCache.set(key, current);
      }
    });

  serverStateCache.set(key, {
    ...(cached || { updatedAt: 0 }),
    promise,
  });
  return promise;
}

const snapshotFromCache = <T,>(key: string, initialData: T | undefined): QuerySnapshot<T> => {
  const cached = serverStateCache.get(key) as CacheEntry<T> | undefined;
  if (cached?.data !== undefined) {
    return {
      data: cached.data,
      error: undefined,
      status: 'success',
      updatedAt: cached.updatedAt,
    };
  }
  if (cached?.error !== undefined) {
    return {
      data: initialData,
      error: cached.error,
      status: 'error',
      updatedAt: cached.updatedAt,
    };
  }
  if (initialData !== undefined) {
    return {
      data: initialData,
      error: undefined,
      status: 'success',
      updatedAt: 0,
    };
  }
  return {
    data: undefined,
    error: undefined,
    status: 'idle',
    updatedAt: 0,
  };
};

export function useServerStateQuery<T>(
  key: string,
  queryFn: (signal: AbortSignal) => Promise<T>,
  options: ServerStateQueryOptions<T> = {},
): ServerStateQueryResult<T> {
  const {
    enabled = true,
    initialData,
    staleTimeMs = DEFAULT_STALE_TIME_MS,
  } = options;
  const [, rerender] = useReducer((count: number) => count + 1, 0);
  const snapshotRef = useRef<QuerySnapshot<T>>(snapshotFromCache(key, initialData));
  const inFlightRef = useRef(false);

  const setSnapshot = useCallback((next: QuerySnapshot<T>) => {
    snapshotRef.current = next;
    rerender();
  }, []);

  const runQuery = useCallback(async () => {
    if (!enabled) return snapshotRef.current.data;

    const controller = new AbortController();
    const cachedBefore = serverStateCache.get(key) as CacheEntry<T> | undefined;
    if (!isFresh(cachedBefore, staleTimeMs)) {
      inFlightRef.current = true;
      setSnapshot({
        data: snapshotRef.current.data,
        error: undefined,
        status: snapshotRef.current.data === undefined ? 'loading' : 'success',
        updatedAt: snapshotRef.current.updatedAt,
      });
    }

    try {
      const data = await fetchServerState(key, queryFn, staleTimeMs, controller.signal);
      if (!controller.signal.aborted) {
        inFlightRef.current = false;
        setSnapshot({ data, error: undefined, status: 'success', updatedAt: now() });
      }
      return data;
    } catch (error) {
      if (!controller.signal.aborted) {
        inFlightRef.current = false;
        setSnapshot({
          data: snapshotRef.current.data,
          error,
          status: 'error',
          updatedAt: now(),
        });
      }
      return undefined;
    }
  }, [enabled, key, queryFn, setSnapshot, staleTimeMs]);

  useEffect(() => {
    if (!enabled) return undefined;
    let active = true;
    const controller = new AbortController();
    const cached = serverStateCache.get(key) as CacheEntry<T> | undefined;
    if (isFresh(cached, staleTimeMs)) {
      setSnapshot({ data: cached?.data, error: undefined, status: 'success', updatedAt: cached?.updatedAt || 0 });
      return () => {
        active = false;
        controller.abort();
      };
    }

    inFlightRef.current = true;
    setSnapshot({
      data: snapshotRef.current.data,
      error: undefined,
      status: snapshotRef.current.data === undefined ? 'loading' : 'success',
      updatedAt: snapshotRef.current.updatedAt,
    });

    fetchServerState(key, queryFn, staleTimeMs, controller.signal)
      .then((data) => {
        if (!active || controller.signal.aborted) return;
        inFlightRef.current = false;
        setSnapshot({ data, error: undefined, status: 'success', updatedAt: now() });
      })
      .catch((error) => {
        if (!active || controller.signal.aborted) return;
        inFlightRef.current = false;
        setSnapshot({
          data: snapshotRef.current.data,
          error,
          status: 'error',
          updatedAt: now(),
        });
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [enabled, key, queryFn, setSnapshot, staleTimeMs]);

  return useMemo(() => {
    const snapshot = snapshotRef.current;
    return {
      data: snapshot.data,
      error: snapshot.error,
      isError: snapshot.status === 'error',
      isFetching: inFlightRef.current,
      isLoading: snapshot.status === 'loading',
      isSuccess: snapshot.status === 'success',
      refetch: runQuery,
      status: snapshot.status,
      updatedAt: snapshot.updatedAt,
    };
  }, [runQuery, snapshotRef.current]);
}
