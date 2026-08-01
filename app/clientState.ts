import { create } from 'zustand';
import type { CurrentUser, Currency, Language, Notification, Theme } from '../types';

type ClientStateSetter<T> = T | ((current: T) => T);

export const MAX_VISIBLE_NOTIFICATIONS = 3;

export const enqueueNotification = (
  notifications: Notification[],
  incoming: Notification,
): Notification[] => {
  const withoutDuplicate = notifications.filter(
    (notification) => notification.type !== incoming.type || notification.message !== incoming.message,
  );
  return [...withoutDuplicate, incoming].slice(-MAX_VISIBLE_NOTIFICATIONS);
};

type ClientState = {
  isBootstrappingSession: boolean;
  isLoggedIn: boolean;
  language: Language;
  theme: Theme;
  currency: Currency;
  notifications: Notification[];
  isCommandPaletteOpen: boolean;
  currentUser: CurrentUser;
  setIsBootstrappingSession: (value: boolean) => void;
  setIsLoggedIn: (value: boolean) => void;
  setLanguage: (value: Language) => void;
  setTheme: (value: ClientStateSetter<Theme>) => void;
  toggleTheme: () => void;
  setCurrency: (value: Currency) => void;
  addNotification: (notification: Notification) => void;
  dismissNotification: (id: string) => void;
  setIsCommandPaletteOpen: (value: ClientStateSetter<boolean>) => void;
  setCurrentUser: (value: ClientStateSetter<CurrentUser>) => void;
};

const readStoredLanguage = (): Language => {
  try {
    const stored = window.localStorage.getItem('ailao.language');
    if (stored === 'zh' || stored === 'en' || stored === 'vi') return stored;
  } catch {
    // ignore storage errors (private mode / disabled storage)
  }
  return 'zh';
};

const readStoredTheme = (): Theme => {
  try {
    const stored = window.localStorage.getItem('ailao.theme');
    if (stored === 'light' || stored === 'dark') return stored;
  } catch {
    // ignore storage errors (private mode / disabled storage)
  }
  return 'light';
};

const initialCurrentUser: CurrentUser = {
  id: 'U-001',
  name: 'Admin User',
  role: 'manager',
  segment: 'direct',
  avatar: '',
};

export const useClientStateStore = create<ClientState>((set) => ({
  isBootstrappingSession: true,
  isLoggedIn: false,
  language: readStoredLanguage(),
  theme: readStoredTheme(),
  currency: 'CNY',
  notifications: [],
  isCommandPaletteOpen: false,
  currentUser: initialCurrentUser,
  setIsBootstrappingSession: (value) => set({ isBootstrappingSession: value }),
  setIsLoggedIn: (value) => set({ isLoggedIn: value }),
  setLanguage: (value) => set({ language: value }),
  setTheme: (value) => set((state) => ({
    theme: typeof value === 'function' ? value(state.theme) : value,
  })),
  toggleTheme: () => set((state) => ({
    theme: state.theme === 'light' ? 'dark' : 'light',
  })),
  setCurrency: (value) => set({ currency: value }),
  addNotification: (notification) => set((state) => ({
    notifications: enqueueNotification(state.notifications, notification),
  })),
  dismissNotification: (id) => set((state) => ({
    notifications: state.notifications.filter((notification) => notification.id !== id),
  })),
  setIsCommandPaletteOpen: (value) => set((state) => ({
    isCommandPaletteOpen: typeof value === 'function' ? value(state.isCommandPaletteOpen) : value,
  })),
  setCurrentUser: (value) => set((state) => ({
    currentUser: typeof value === 'function' ? value(state.currentUser) : value,
  })),
}));
