const memoryStore = new Map<string, string>();

const canUseLocalStorage = (): boolean => {
    if (typeof window === 'undefined' || !window.localStorage) return false;
    const probeKey = '__ailaoda_storage_probe__';
    try {
        window.localStorage.setItem(probeKey, '1');
        window.localStorage.removeItem(probeKey);
        return true;
    } catch {
        return false;
    }
};

const storageAvailable = canUseLocalStorage();

export const safeStorage = {
    getItem(key: string): string | null {
        if (storageAvailable) {
            try {
                const value = window.localStorage.getItem(key);
                if (value !== null) return value;
            } catch {
                // Keep the current tab usable when browser storage is blocked.
            }
        }
        return memoryStore.get(key) ?? null;
    },

    setItem(key: string, value: string): void {
        memoryStore.set(key, value);
        if (!storageAvailable) return;
        try {
            window.localStorage.setItem(key, value);
        } catch {
            // Memory fallback already has the value.
        }
    },

    removeItem(key: string): void {
        memoryStore.delete(key);
        if (!storageAvailable) return;
        try {
            window.localStorage.removeItem(key);
        } catch {
            // ignore
        }
    },

    getJson<T>(key: string): T | null {
        const raw = this.getItem(key);
        if (!raw) return null;
        try {
            return JSON.parse(raw) as T;
        } catch {
            this.removeItem(key);
            return null;
        }
    },

    setJson<T>(key: string, value: T): void {
        this.setItem(key, JSON.stringify(value));
    },
};

export const clearAuthStorage = () => {
    safeStorage.removeItem('token');
    safeStorage.removeItem('refreshToken');
    safeStorage.removeItem('user');
};

export default safeStorage;
