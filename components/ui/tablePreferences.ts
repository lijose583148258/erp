const isBrowser = () => typeof window !== 'undefined' && Boolean(window.localStorage);

export const readNumberPreference = (key: string, fallback: number, allowed?: number[]) => {
  if (!isBrowser()) return fallback;
  const value = Number(window.localStorage.getItem(key));
  if (!Number.isFinite(value)) return fallback;
  if (allowed && !allowed.includes(value)) return fallback;
  return value;
};

export const writeNumberPreference = (key: string, value: number) => {
  if (!isBrowser()) return;
  window.localStorage.setItem(key, String(value));
};

export const readStringArrayPreference = (key: string, fallback: string[]) => {
  if (!isBrowser()) return fallback;
  try {
    const parsed = JSON.parse(window.localStorage.getItem(key) || '[]');
    return Array.isArray(parsed) && parsed.every((item) => typeof item === 'string') ? parsed : fallback;
  } catch {
    return fallback;
  }
};

export const writeStringArrayPreference = (key: string, value: string[]) => {
  if (!isBrowser()) return;
  window.localStorage.setItem(key, JSON.stringify(value));
};
