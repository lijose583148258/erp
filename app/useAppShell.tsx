import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { authService } from '../services/auth.service';
import { translations } from '../translations';
import type { AppContextType, CurrentUser, Currency, Language, Notification, Theme, UserRole } from '../types';
import { renderAppContent } from './appContent';

// Canonical app shell hook entry. App.tsx imports this file explicitly (`useAppShell.tsx`).
type AppShellResult = {
    isLoggedIn: boolean;
    activeTab: string;
    setActiveTab: ReturnType<typeof useState<string>>[1];
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
    switchUser: (role: UserRole, segment?: 'direct' | 'channel' | 'mixed') => void;
    formatPrice: (amount: number, fromCurrency?: Currency) => string;
    t: Record<string, string>;
    contextValue: AppContextType;
    content: ReactNode;
};

const rates = { USD: 1 / 7.2, VND: 3500, CNY: 1 };
const currencySymbols = { CNY: '¥', USD: '$', VND: '₫' };

export const useAppShell = (): AppShellResult => {
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
    const [activeTab, setActiveTab] = useState(readTabFromLocation);
    const [language, setLanguage] = useState<Language>(() => {
        try {
            const stored = window.localStorage.getItem('ailao.language');
            if (stored === 'zh' || stored === 'en' || stored === 'vi') return stored;
        } catch {
            // ignore storage errors (private mode / disabled storage)
        }
        return 'zh';
    });
    const [theme, setTheme] = useState<Theme>('light');
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

    useEffect(() => {
        const user = authService.getCurrentUser();
        if (user) {
            setCurrentUser(user);
            setIsLoggedIn(true);
        }
    }, []);

    useEffect(() => {
        try {
            window.localStorage.setItem('ailao.language', language);
        } catch {
            // ignore
        }
    }, [language]);

    useEffect(() => {
        const syncFromHash = () => {
            const nextTab = readTabFromLocation();
            setActiveTab(prev => (prev === nextTab ? prev : nextTab));
        };
        window.addEventListener('hashchange', syncFromHash);
        return () => window.removeEventListener('hashchange', syncFromHash);
    }, [readTabFromLocation]);

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
        ...(translations['en'] || {}),
        ...(translations[language] || {}),
    }), [language]);

    const handleLogin = async (username: string, password: string) => {
        try {
            const user = await authService.login(username, password);
            setCurrentUser(user);
            setIsLoggedIn(true);
            notify('success', `${t.loginSuccess}${user.name}`);
        } catch (error) {
            notify('error', t.loginFail);
            console.error(error);
            throw error;
        }
    };

    const handleLogout = () => {
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

    const switchUser = useCallback((role: UserRole, segment: 'direct' | 'channel' | 'mixed' = 'mixed') => {
        const rolesData: Record<string, Partial<CurrentUser>> = {
            admin: { name: 'Super Admin', avatar: '' },
            manager_direct: { name: 'Alice (Direct Mgr)', avatar: '', segment: 'direct' },
            manager_channel: { name: 'Bob (Channel Mgr)', avatar: '', segment: 'channel' },
            sales: { name: 'John Sales', avatar: '' },
            warehouse: { name: 'Mike Warehouse', avatar: '' },
            finance: { name: 'Emma Finance', avatar: '' },
        };

        let lookupKey: string = role;
        if (role === 'manager' && segment !== 'mixed') {
            lookupKey = `manager_${segment}`;
        }

        const userData = rolesData[lookupKey] || rolesData[role];
        setCurrentUser(prev => ({ ...prev, role, segment, ...userData }));

        const segmentLabel = segment === 'direct' ? 'Direct Sales' : segment === 'channel' ? 'Channel Dist.' : '';
        notify('info', `Switched to ${role.toUpperCase()} ${segmentLabel ? `(${segmentLabel})` : ''}`);
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
        console.log(`%c[CORE-SYSTEM] Version 2.2.0-FINAL Charged. Language: ${language}`, 'color: #2563eb; font-weight: 800; font-size: 14px;');
        console.log('%c[i18n] Resource Mapping Status: OK', 'color: #059669; font-weight: bold;');
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
    }), [language, setLanguage, theme, toggleTheme, currency, setCurrency, currentUser, switchUser, formatPrice, notify, t]);

    const content = useMemo(() => renderAppContent(activeTab), [activeTab]);

    return {
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
        switchUser,
        formatPrice,
        t,
        contextValue,
        content,
    };
};
