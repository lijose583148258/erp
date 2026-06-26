import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { authService } from '../services/auth.service';
import { translations } from '../translations';
import type { AppContextType, CurrentUser, Currency, Language, Notification, Theme, UserRole } from '../types';
import { renderAppContent } from './appContent';

// Canonical app shell hook entry. App.tsx imports this file explicitly (`useAppShell.tsx`).
type AppShellResult = {
    isBootstrappingSession: boolean;
    isLoggedIn: boolean;
    activeTab: string;
    setActiveTab: (tab: string) => boolean;
    language: Language;
    setLanguage: ReturnType<typeof useState<Language>>[1];
    theme: Theme;
    toggleTheme: () => void;
    currency: Currency;
    setCurrency: ReturnType<typeof useState<Currency>>[1];
    notifications: Notification[];
    dismissNotification: (id: string) => void;
    isCommandPaletteOpen: boolean;
    setIsCommandPaletteOpen: ReturnType<typeof useState<boolean>>[1];
    currentUser: CurrentUser;
    handleLogin: (username: string, password: string) => Promise<void>;
    handleLogout: () => void;
    handlePasswordChanged: (oldPassword: string, newPassword: string) => Promise<void>;
    switchUser: (role: UserRole, segment?: 'direct' | 'channel' | 'mixed') => void;
    formatPrice: (amount: number, fromCurrency?: Currency) => string;
    t: Record<string, string>;
    contextValue: AppContextType;
    content: ReactNode;
};

const rates = { USD: 1 / 7.2, VND: 3500, CNY: 1 };
const currencySymbols = { CNY: '¥', USD: '$', VND: '₫' };

export const useAppShell = (): AppShellResult => {
    const [isBootstrappingSession, setIsBootstrappingSession] = useState(true);
    const [isLoggedIn, setIsLoggedIn] = useState(false);
    const normalizeActiveTab = useCallback((tab: string) => (tab === 'timber' ? 'barter' : tab), []);
    const readTabFromLocation = useCallback(() => {
        const hash = normalizeActiveTab(window.location.hash.replace(/^#/, '').trim());
        if (hash) return hash;
        try {
            return normalizeActiveTab(window.localStorage.getItem('ailao.activeTab') || 'dashboard');
        } catch {
            return 'dashboard';
        }
    }, [normalizeActiveTab]);
    const [activeTab, setActiveTabState] = useState(readTabFromLocation);
    const [unsavedChanges, setUnsavedChanges] = useState<Record<string, string>>({});
    const [language, setLanguage] = useState<Language>(() => {
        try {
            const stored = window.localStorage.getItem('ailao.language');
            if (stored === 'zh' || stored === 'en' || stored === 'vi') return stored;
        } catch {
            // ignore storage errors (private mode / disabled storage)
        }
        return 'zh';
    });
    const [theme, setTheme] = useState<Theme>(() => {
        try {
            const stored = window.localStorage.getItem('ailao.theme');
            if (stored === 'light' || stored === 'dark') return stored;
        } catch {
            // ignore storage errors (private mode / disabled storage)
        }
        return 'light';
    });
    const [currency, setCurrency] = useState<Currency>('CNY');
    const [notifications, setNotifications] = useState<Notification[]>([]);
    const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);
    const [currentUser, setCurrentUser] = useState<CurrentUser>({
        id: 'U-001',
        name: 'Admin User',
        role: 'manager',
        segment: 'direct',
        avatar: '',
    });

    const dismissNotification = useCallback((id: string) => {
        setNotifications(prev => prev.filter(notification => notification.id !== id));
    }, []);

    const notify = useCallback((type: 'success' | 'error' | 'info' | 'warning', message: string) => {
        const id = Date.now().toString();
        setNotifications(prev => [...prev, { id, type, message }]);
        window.setTimeout(() => {
            setNotifications(prev => prev.filter(notification => notification.id !== id));
        }, 4000);
    }, []);

    const registerUnsavedChanges = useCallback((sourceId: string, label: string, dirty: boolean) => {
        setUnsavedChanges(prev => {
            if (dirty) {
                if (prev[sourceId] === label) return prev;
                return { ...prev, [sourceId]: label };
            }
            if (!(sourceId in prev)) return prev;
            const next = { ...prev };
            delete next[sourceId];
            return next;
        });
    }, []);

    const confirmDiscardChanges = useCallback(() => {
        const labels = Object.values(unsavedChanges);
        if (!labels.length) return true;
        const message = `${labels.join('\u3001')} \u6709\u672a\u4fdd\u5b58\u7684\u66f4\u6539\uff0c\u786e\u5b9a\u79bb\u5f00\u5f53\u524d\u9875\u9762\u5417\uff1f`;
        return window.confirm(message);
    }, [unsavedChanges]);

    useEffect(() => {
        const debugWindow = window as typeof window & {
            __AILAODA_UNSAVED_STATE__?: {
                dirtySourceIds: string[];
                dirtyLabels: string[];
                count: number;
            };
        };
        const dirtySourceIds = Object.keys(unsavedChanges);
        debugWindow.__AILAODA_UNSAVED_STATE__ = {
            dirtySourceIds,
            dirtyLabels: Object.values(unsavedChanges),
            count: dirtySourceIds.length,
        };
    }, [unsavedChanges]);

    const setActiveTab = useCallback((tab: string) => {
        const normalizedTab = normalizeActiveTab(tab);
        if (normalizedTab === activeTab) return true;
        if (!confirmDiscardChanges()) return false;
        setUnsavedChanges({});
        setActiveTabState(normalizedTab);
        return true;
    }, [activeTab, confirmDiscardChanges, normalizeActiveTab]);

    useEffect(() => {
        let cancelled = false;
        const bootstrapSession = async () => {
            const cachedUser = authService.getCurrentUser();
            if (!cachedUser || !authService.hasToken()) {
                if (!cancelled) setIsBootstrappingSession(false);
                return;
            }

            try {
                const user = await authService.me();
                if (cancelled) return;
                setCurrentUser(user);
                setIsLoggedIn(true);
            } catch {
                if (cancelled) return;
                authService.logout();
                setIsLoggedIn(false);
            } finally {
                if (!cancelled) setIsBootstrappingSession(false);
            }
        };

        void bootstrapSession();
        return () => {
            cancelled = true;
        };
    }, []);

    useEffect(() => {
        const handleAuthExpired = (event: Event) => {
            const message = event instanceof CustomEvent && typeof event.detail?.message === 'string'
                ? event.detail.message
                : '登录状态已失效，请重新登录';
            authService.logout();
            setIsLoggedIn(false);
            setCurrentUser({
                id: '',
                name: '',
                role: 'sales',
                segment: 'direct',
                avatar: '',
            });
            notify('warning', message);
        };

        window.addEventListener('ailaoda:auth-expired', handleAuthExpired);
        return () => window.removeEventListener('ailaoda:auth-expired', handleAuthExpired);
    }, [notify]);

    useEffect(() => {
        try {
            window.localStorage.setItem('ailao.language', language);
        } catch {
            // ignore
        }
    }, [language]);

    useEffect(() => {
        try {
            window.localStorage.setItem('ailao.theme', theme);
        } catch {
            // ignore
        }
    }, [theme]);

    useEffect(() => {
        const syncFromHash = () => {
            const nextTab = readTabFromLocation();
            if (nextTab === activeTab) return;
            if (!confirmDiscardChanges()) {
                window.history.replaceState(null, '', `#${activeTab}`);
                return;
            }
            setUnsavedChanges({});
            setActiveTabState(nextTab);
        };
        window.addEventListener('hashchange', syncFromHash);
        return () => window.removeEventListener('hashchange', syncFromHash);
    }, [activeTab, confirmDiscardChanges, readTabFromLocation]);

    useEffect(() => {
        if (!Object.keys(unsavedChanges).length) return;
        const handleBeforeUnload = (event: BeforeUnloadEvent) => {
            event.preventDefault();
            event.returnValue = '';
        };
        window.addEventListener('beforeunload', handleBeforeUnload);
        return () => window.removeEventListener('beforeunload', handleBeforeUnload);
    }, [unsavedChanges]);

    useEffect(() => {
        try {
            window.localStorage.setItem('ailao.activeTab', activeTab);
        } catch {
            // ignore
        }
        const nextHash = `#${activeTab}`;
        if (window.location.hash !== nextHash) {
            window.history.replaceState(null, '', nextHash);
        }
    }, [activeTab]);

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
                e.preventDefault();
                setIsCommandPaletteOpen(prev => !prev);
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, []);

    const t = useMemo(() => ({
        ...(translations['zh'] || {}),
        ...(translations[language] || {}),
    }), [language]);

    const handleLogin = async (username: string, password: string) => {
        try {
            const user = await authService.login(username, password);
            setCurrentUser(user);
            setIsLoggedIn(true);
            notify('success', `${t.loginSuccess}${user.name}`);
        } catch (error) {
            const message = error instanceof Error && error.message
                ? error.message
                : t.loginFail;
            notify('error', message);
            throw error;
        }
    };

    const handleLogout = () => {
        if (!confirmDiscardChanges()) return;
        setUnsavedChanges({});
        authService.logout();
        setIsLoggedIn(false);
        setCurrentUser({
            id: '',
            name: '',
            role: 'sales',
            segment: 'direct',
            avatar: '',
        });
        notify('info', t.logoutSuccess);
    };

    const handlePasswordChanged = async (oldPassword: string, newPassword: string) => {
        await authService.changePassword(oldPassword, newPassword);
        setCurrentUser(prev => {
            const next = { ...prev, mustChangePassword: false };
            localStorage.setItem('user', JSON.stringify(next));
            return next;
        });
        notify('success', '密码已更新');
    };

    const switchUser = useCallback((role: UserRole, segment: 'direct' | 'channel' | 'mixed' = 'mixed') => {
        const rolesData: Record<string, Partial<CurrentUser>> = {
            admin: { name: '超级管理员', avatar: '' },
            manager_direct: { name: '直营经理', avatar: '', segment: 'direct' },
            manager_channel: { name: '渠道经理', avatar: '', segment: 'channel' },
            sales: { name: '销售员', avatar: '' },
            warehouse: { name: '仓库员', avatar: '' },
            finance: { name: '财务员', avatar: '' },
        };

        let lookupKey: string = role;
        if (role === 'manager' && segment !== 'mixed') {
            lookupKey = `manager_${segment}`;
        }

        const userData = rolesData[lookupKey] || rolesData[role];
        setCurrentUser(prev => ({ ...prev, role, segment, ...userData }));

        const roleLabel: Record<UserRole, string> = {
            admin: '超级管理员',
            manager: '经理',
            sales: '销售员',
            warehouse: '仓库员',
            finance: '财务员',
        };
        const segmentLabel = segment === 'direct' ? '直营' : segment === 'channel' ? '渠道' : '';
        notify('info', `已切换到${roleLabel[role]}${segmentLabel ? `（${segmentLabel}）` : ''}`);
    }, [notify]);

    const formatPrice = useCallback((amount: number, fromCurrency: Currency = 'CNY'): string => {
        const amountInCNY = fromCurrency === 'CNY' ? amount : amount / rates[fromCurrency];
        const convertedAmount = amountInCNY * rates[currency];
        const symbol = currencySymbols[currency];
        const decimals = currency === 'VND' ? 0 : 2;
        const locale = language === 'vi' ? 'vi-VN' : language === 'en' ? 'en-US' : 'zh-CN';
        return `${symbol} ${convertedAmount.toLocaleString(locale, { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}`;
    }, [currency, language]);

    useEffect(() => {
        (window as typeof window & { __SYS_VERSION__?: string }).__SYS_VERSION__ = '2.2.0-FINAL-G3F';
        if (import.meta.env.DEV) {
            console.log(`%c[CORE-SYSTEM] Version 2.2.0-FINAL Charged. Language: ${language}`, 'color: #2563eb; font-weight: 800; font-size: 14px;');
            console.log('%c[i18n] Resource Mapping Status: OK', 'color: #059669; font-weight: bold;');
        }
    }, [language]);

    const toggleTheme = useCallback(() => setTheme(prev => prev === 'light' ? 'dark' : 'light'), []);

    useEffect(() => {
        const root = window.document.documentElement;
        if (theme === 'dark') {
            root.classList.add('dark');
        } else {
            root.classList.remove('dark');
        }
    }, [theme]);

    useEffect(() => {
        const handleOffline = () => notify('warning', '网络连接已断开，请检查网络或等待后端重启');
        const handleOnline = () => notify('success', '网络连接已恢复');
        
        window.addEventListener('offline', handleOffline);
        window.addEventListener('online', handleOnline);
        
        return () => {
            window.removeEventListener('offline', handleOffline);
            window.removeEventListener('online', handleOnline);
        };
    }, [notify]);

    const contextValue = useMemo<AppContextType>(() => ({
        language,
        setLanguage,
        theme,
        toggleTheme,
        currency,
        setCurrency,
        currentUser,
        switchUser,
        formatPrice,
        notify,
        t,
        setIsCommandPaletteOpen,
        registerUnsavedChanges,
        confirmDiscardChanges,
    }), [language, setLanguage, theme, toggleTheme, currency, setCurrency, currentUser, switchUser, formatPrice, notify, t, registerUnsavedChanges, confirmDiscardChanges]);

    const content = useMemo(() => renderAppContent(activeTab), [activeTab]);

    return {
        isBootstrappingSession,
        isLoggedIn,
        activeTab,
        setActiveTab,
        language,
        setLanguage,
        theme,
        toggleTheme,
        currency,
        setCurrency,
        notifications,
        dismissNotification,
        isCommandPaletteOpen,
        setIsCommandPaletteOpen,
        currentUser,
        handleLogin,
        handleLogout,
        handlePasswordChanged,
        switchUser,
        formatPrice,
        t,
        contextValue,
        content,
    };
};
