import React, { Suspense, lazy, useEffect, useState } from 'react';
import {
  Settings, Search, Command, Languages, Sun, Moon,
  DollarSign, Menu, X, UserCircle, LogOut, Briefcase, Network, Type,
} from 'lucide-react';
import { useAppContext } from '../app/AppContext';
import { canOpenModule } from '../app/permissions';
import { Language, Currency, UserRole } from '../types';
import { Brain } from 'lucide-react';
import {
  getModuleDefinition,
  getModuleDescription,
  getModuleLabel,
  getModuleTitle,
  getNavigationModules,
  type ModuleGroup,
} from './navigation/moduleRegistry';

const AIAssistant = lazy(() => import('./AIAssistant'));
const AISettings = lazy(() => import('./AISettings'));
const APP_BRAND = '爱劳达 ERP+CRM';

const MODULE_GROUP_ORDER: ModuleGroup[] = ['overview', 'sales', 'supply', 'production', 'governance'];

const MODULE_GROUP_LABELS: Record<ModuleGroup, Record<Language, string>> = {
  overview: { zh: '经营总览', en: 'Overview', vi: 'Tổng quan' },
  sales: { zh: '客户与销售', en: 'Sales', vi: 'Bán hàng' },
  supply: { zh: '采购仓储', en: 'Supply', vi: 'Cung ứng' },
  production: { zh: '生产与售后', en: 'Production', vi: 'Sản xuất' },
  governance: { zh: '治理与权限', en: 'Governance', vi: 'Quản trị' },
};

const ROLE_SWITCH_COPY: Record<Language, { title: string; hint: string; button: string }> = {
  zh: {
    title: '权限视角',
    hint: '仅用于管理员验收和权限核对，日常业务不需要切换。',
    button: '切换视角',
  },
  en: {
    title: 'Permission view',
    hint: 'For admin verification only. Daily users should not switch roles.',
    button: 'Switch view',
  },
  vi: {
    title: 'Góc nhìn quyền',
    hint: 'Chỉ dùng cho quản trị viên kiểm tra quyền, người dùng hằng ngày không cần đổi.',
    button: 'Đổi góc nhìn',
  },
};

const ModuleBadge: React.FC<{ id: string; active?: boolean; size?: 'sm' | 'md' | 'lg' }> = ({ id, active = false, size = 'md' }) => {
  const tone = getModuleDefinition(id);
  const Icon = tone.icon;

  const sizeClass = size === 'lg'
    ? 'h-16 w-16 rounded-[24px]'
    : size === 'sm'
      ? 'h-10 w-10 rounded-[18px]'
      : 'h-12 w-12 rounded-[20px]';

  const iconSize = size === 'lg' ? 28 : size === 'sm' ? 18 : 20;

  return (
    <span className={`relative isolate inline-flex shrink-0 items-center justify-center overflow-hidden ${sizeClass} transition-transform duration-300 group-hover:scale-[1.04] ${active
      ? 'shadow-[0_18px_30px_-18px_rgba(15,23,42,0.55)]'
      : 'shadow-[0_14px_24px_-16px_rgba(15,23,42,0.35)]'
      }`}>
      <span className={`absolute inset-0 rounded-[inherit] ${active ? 'bg-white/20' : `bg-gradient-to-br ${tone.gradient}`}`} />
      <span className={`absolute inset-[1px] rounded-[inherit] ${active ? 'bg-white/15 dark:bg-slate-950/10' : 'bg-white/10 dark:bg-slate-950/10'} backdrop-blur-sm`} />
      <span className={`absolute inset-[1px] rounded-[inherit] border ${active ? 'border-white/20' : 'border-white/10'}`} />
      <span className={`absolute left-1.5 top-1.5 h-1.5 w-3 rounded-full ${active ? 'bg-white/50' : 'bg-white/30'}`} />
      {tone.ornament === 'dot' && (
        <span className={`absolute -right-0.5 -top-0.5 h-3.5 w-3.5 rounded-full ${tone.accent} shadow-[0_0_0_3px_rgba(255,255,255,0.18)]`} />
      )}
      {tone.ornament === 'bar' && (
        <span className={`absolute left-1.5 bottom-1.5 h-1.5 w-4 rounded-full ${tone.accent}`} />
      )}
      {tone.ornament === 'ring' && (
        <span className={`absolute right-1.5 top-1.5 h-4 w-4 rounded-full border border-white/60 ${tone.accent} opacity-90`} />
      )}
      {tone.ornament === 'spark' && (
        <span className={`absolute right-1.5 bottom-1.5 h-2.5 w-2.5 rotate-45 rounded-[4px] ${tone.accent} shadow-[0_0_0_3px_rgba(255,255,255,0.14)]`} />
      )}
      <Icon size={iconSize} className={`relative z-10 ${active ? 'text-white' : 'text-white/95'} stroke-[2.2px]`} />
    </span>
  );
};

interface LayoutProps {
  children: React.ReactNode;
  activeTab: string;
  setActiveTab: (tab: string) => boolean;
  onLogout?: () => void;
}

const Layout: React.FC<LayoutProps> = ({ children, activeTab, setActiveTab, onLogout }) => {
  const [showPicker, setShowPicker] = useState<'lang' | 'curr' | 'role' | null>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [showAISettings, setShowAISettings] = useState(false);
  const [compactMode, setCompactMode] = useState(() => {
    try {
      return window.localStorage.getItem('ailao.compactMode') === 'on';
    } catch {
      return false;
    }
  });
  const [textScale, setTextScale] = useState(() => {
    try {
      const stored = Number(window.localStorage.getItem('ailao.textScale') || 100);
      return [100, 110, 120].includes(stored) ? stored : 100;
    } catch {
      return 100;
    }
  });
  const { language, setLanguage, theme, toggleTheme, currency, setCurrency, currentUser, switchUser, t, setIsCommandPaletteOpen } = useAppContext();

  const activeModule = getModuleDefinition(activeTab);
  const activeModuleTitle = getModuleTitle(activeTab, language);
  const activeModuleDescription = getModuleDescription(activeTab, language);
  const roleSwitchCopy = ROLE_SWITCH_COPY[language] || ROLE_SWITCH_COPY.zh;
  const allMenuItems = getNavigationModules().map(item => ({
    id: item.id,
    group: item.group,
    label: getModuleLabel(item.id, language),
    title: getModuleTitle(item.id, language),
    description: getModuleDescription(item.id, language),
  }));

  const menuItems = allMenuItems.filter(item => canOpenModule(currentUser, item.id));
  const groupedMenuItems = MODULE_GROUP_ORDER.map(group => ({
    group,
    label: MODULE_GROUP_LABELS[group][language] || MODULE_GROUP_LABELS[group].zh,
    items: menuItems.filter(item => item.group === group),
  })).filter(section => section.items.length > 0);

  const getRoleLabel = (role: UserRole, segment?: string) => {
    if (role === 'manager' && segment === 'direct') return t.roleManagerDirect;
    if (role === 'manager' && segment === 'channel') return t.roleManagerChannel;
    return t[`role${role.charAt(0).toUpperCase() + role.slice(1)}`] || role;
  };

  const roleColors: Partial<Record<string, string>> = {
    admin: 'bg-rose-500',
    manager: 'bg-blue-600',
    sales: 'bg-emerald-500',
    warehouse: 'bg-amber-500',
    finance: 'bg-purple-600'
  };
  const getRoleColor = (role: UserRole) => roleColors[role] || 'bg-slate-600';

  useEffect(() => {
    const root = window.document.documentElement;
    root.classList.toggle('app-compact', compactMode);
    try {
      window.localStorage.setItem('ailao.compactMode', compactMode ? 'on' : 'off');
    } catch {
      // ignore storage errors
    }
  }, [compactMode]);

  useEffect(() => {
    const root = window.document.documentElement;
    root.style.setProperty('--app-text-zoom', `${textScale}%`);
    try {
      window.localStorage.setItem('ailao.textScale', String(textScale));
    } catch {
      // ignore storage errors
    }
  }, [textScale]);

  const cycleTextScale = () => {
    setTextScale(current => (current === 100 ? 110 : current === 110 ? 120 : 100));
  };

  return (
    <div className="flex h-screen bg-[#F8FAFC] dark:bg-slate-950 text-slate-800 dark:text-slate-100 overflow-hidden font-sans selection:bg-blue-200 dark:selection:bg-blue-900">

      <aside className={`hidden lg:flex w-72 bg-white/60 dark:bg-slate-900/60 backdrop-blur-[24px] border-r border-white/40 dark:border-slate-800/50 flex-col z-30 transition-all duration-500 ${compactMode ? 'm-2 rounded-2xl' : 'm-5 rounded-[44px]'} shadow-[0_32px_64px_-16px_rgba(0,0,0,0.08)] dark:shadow-none hover:shadow-blue-500/5`}>
        <div className="p-10">
          <div className="flex items-center space-x-4 mb-2 group">
            <div className="w-12 h-12 bg-gradient-to-br from-blue-600 to-indigo-700 rounded-[22px] flex items-center justify-center text-white shadow-xl shadow-blue-500/30 group-hover:rotate-6 transition-transform duration-500">
              <Command size={24} />
            </div>
            <div>
              <h1 className="text-2xl font-black tracking-tighter italic bg-gradient-to-br from-slate-900 to-slate-500 dark:from-white dark:to-slate-400 bg-clip-text text-transparent">{APP_BRAND}</h1>
              <span className="text-xs font-black uppercase text-blue-600 dark:text-blue-400 opacity-60">{t.brandEdition}</span>
            </div>
          </div>
        </div>

        <nav className="flex-1 px-6 overflow-y-auto no-scrollbar pb-6 mt-2 space-y-5">
          {groupedMenuItems.map(section => (
            <section key={section.group} className="space-y-2">
              <div className="px-3 flex items-center justify-between">
                <p className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-400 dark:text-slate-500">{section.label}</p>
                {activeModule.group === section.group && <span className="h-1.5 w-1.5 rounded-full bg-blue-500 shadow-[0_0_0_4px_rgba(37,99,235,0.12)]" />}
              </div>
              {section.items.map((item) => (
                <button
                  key={item.id}
                  onClick={() => setActiveTab(item.id)}
                  title={item.description}
                  className={`group w-full flex items-center px-4 py-3 rounded-[24px] transition-all duration-300 bouncy active-shrink ${activeTab === item.id
                    ? 'bg-gradient-to-br from-blue-600 to-blue-700 text-white shadow-2xl shadow-blue-500/40 scale-100 z-10'
                    : 'text-slate-500 dark:text-slate-400 hover:bg-white/80 dark:hover:bg-slate-800/80 hover:scale-[1.02] hover:shadow-lg hover:shadow-slate-200/40 dark:hover:shadow-none'
                    }`}
                >
                  <ModuleBadge id={item.id} active={activeTab === item.id} size="sm" />
                  <span className={`ml-3 text-sm tracking-wide ${activeTab === item.id ? 'font-black' : 'font-bold'}`}>{item.label}</span>
                  {activeTab === item.id && <div className="ml-auto w-1.5 h-1.5 bg-white rounded-full animate-pulse shadow-sm" />}
                </button>
              ))}
            </section>
          ))}
        </nav>

        {/* User Hub */}
        <div className="p-6 space-y-4">
          <div className="bg-slate-50/50 dark:bg-slate-800/30 rounded-[30px] p-4 flex items-center space-x-3 relative group border border-white/20">
            <div className={`w-10 h-10 rounded-2xl ${getRoleColor(currentUser.role)} flex items-center justify-center text-white shadow-lg shadow-inner`}>
              {(typeof currentUser.avatar === 'string' && currentUser.avatar.includes('http')) ? <img src={currentUser.avatar} className="w-full h-full object-cover rounded-2xl" /> : <UserCircle size={20} />}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-black truncate text-slate-900 dark:text-white">{currentUser.name}</p>
              <p className="text-xs font-bold text-slate-400 uppercase tracking-tighter truncate">{getRoleLabel(currentUser.role, currentUser.segment)}</p>
            </div>
            <button
              onClick={() => setShowPicker(showPicker === 'role' ? null : 'role')}
              className="p-2 text-slate-300 hover:text-blue-500 transition-all hover:rotate-90 duration-500"
              title={roleSwitchCopy.button}
            >
              <Settings size={16} />
            </button>

            {showPicker === 'role' && (
              <div className="absolute bottom-full left-0 mb-4 w-72 bg-white/95 dark:bg-slate-900/95 backdrop-blur-2xl rounded-2xl shadow-[0_20px_50px_rgba(0,0,0,0.15)] border border-white/40 dark:border-slate-800 p-4 z-[110] animate-in slide-in-from-bottom-4 zoom-in-95 duration-300">
                <div className="flex justify-between items-start mb-4 px-1 gap-3">
                  <div>
                    <p className="text-xs font-black uppercase text-blue-600 tracking-wider">{roleSwitchCopy.title}</p>
                    <p className="mt-1 text-[11px] leading-4 font-bold text-slate-400">{roleSwitchCopy.hint}</p>
                  </div>
                  <button onClick={() => setShowPicker(null)} className="text-slate-300 hover:text-slate-500 px-1"><X size={14} /></button>
                </div>

                <div className="grid grid-cols-1 gap-2">
                  <button onClick={() => { if (!setActiveTab('dashboard')) return; switchUser('manager', 'direct'); setShowPicker(null); }} className="group relative w-full text-left p-3 rounded-2xl text-sm font-black border border-slate-50 dark:border-slate-800 hover:border-blue-200 dark:hover:border-blue-800 hover:bg-blue-50/30 dark:hover:bg-blue-900/20 transition-all flex items-center">
                    <div className="p-2 bg-blue-100 dark:bg-blue-900/50 text-blue-600 rounded-xl mr-3 group-hover:scale-110 transition-transform"><Briefcase size={14} /></div>
                    <div>
                      <span>{t.roleManagerDirect}</span>
                      <p className="text-xs text-slate-400 font-bold opacity-0 group-hover:opacity-100 transition-opacity">{t.directSalesDept}</p>
                    </div>
                  </button>
                  <button onClick={() => { if (!setActiveTab('dashboard')) return; switchUser('manager', 'channel'); setShowPicker(null); }} className="group relative w-full text-left p-3 rounded-2xl text-sm font-black border border-slate-50 dark:border-slate-800 hover:border-blue-200 dark:hover:border-blue-800 hover:bg-blue-50/30 dark:hover:bg-blue-900/20 transition-all flex items-center">
                    <div className="p-2 bg-indigo-100 dark:bg-indigo-900/50 text-indigo-600 rounded-xl mr-3 group-hover:scale-110 transition-transform"><Network size={14} /></div>
                    <div>
                      <span>{t.roleManagerChannel}</span>
                      <p className="text-xs text-slate-400 font-bold opacity-0 group-hover:opacity-100 transition-opacity">{t.distributionNetwork}</p>
                    </div>
                  </button>
                </div>

                <div className="my-3 border-t border-slate-100 dark:border-slate-800 opacity-50"></div>

                <div className="grid grid-cols-2 gap-2">
                  {(['admin', 'sales', 'warehouse', 'finance'] as UserRole[]).map(r => (
                    <button
                      key={r}
                      onClick={() => { if (!setActiveTab('dashboard')) return; switchUser(r); setShowPicker(null); }}
                      className={`text-left p-3 rounded-2xl text-xs font-black transition-all ${currentUser.role === r ? 'bg-blue-600 text-white shadow-lg' : 'bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700'}`}
                    >
                      <div className={`w-1.5 h-1.5 rounded-full mb-2 ${currentUser.role === r ? 'bg-white' : getRoleColor(r)}`}></div>
                      {getRoleLabel(r)}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {onLogout && (
            <button
              onClick={onLogout}
              className="w-full flex items-center justify-center px-6 py-4 rounded-[28px] bg-red-50 dark:bg-red-950/30 text-red-600 dark:text-red-400 hover:bg-red-500 hover:text-white transition-all font-black text-xs uppercase tracking-wider gap-2 shadow-sm hover:shadow-red-200 active-shrink group"
            >
              <LogOut size={16} className="group-hover:-translate-x-1 transition-transform" />
              <span>{t.logout}</span>
            </button>
          )}
        </div>
      </aside>

      {mobileMenuOpen && (
        <div className="lg:hidden fixed inset-0 z-[110] bg-slate-950/60 backdrop-blur-md" onClick={() => setMobileMenuOpen(false)}>
          <div className="absolute bottom-0 left-0 right-0 max-h-[90vh] bg-white/95 dark:bg-slate-900/95 backdrop-blur-2xl rounded-t-[48px] p-10 flex flex-col animate-in slide-in-from-bottom-[50%] duration-700 shadow-[0_-20px_60px_-15px_rgba(0,0,0,0.3)]" onClick={e => e.stopPropagation()}>
            <div className="w-16 h-1.5 bg-slate-200 dark:bg-slate-800 rounded-full mx-auto mb-10 opacity-50"></div>
            <div className="flex items-center justify-between mb-10">
              <h2 className="text-3xl font-black italic tracking-tighter uppercase text-slate-900 dark:text-white">{t.navQuickJump}</h2>
              <button onClick={() => setMobileMenuOpen(false)} className="p-4 bg-slate-100 dark:bg-slate-800 rounded-full text-slate-500 active-shrink"><X size={24} /></button>
            </div>
            <button
              type="button"
              onClick={cycleTextScale}
              data-testid="mobile-text-scale-toggle"
              aria-label={`文字缩放 ${textScale}%`}
              className="mb-5 flex min-h-12 w-full items-center justify-between rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-left text-sm font-black text-slate-700 active-shrink dark:border-slate-800 dark:bg-slate-800 dark:text-slate-100"
            >
              <span className="flex items-center gap-2">
                <Type size={18} />
                文字缩放
              </span>
              <span className="rounded-lg bg-white px-2.5 py-1 text-xs tabular-nums text-blue-700 dark:bg-slate-900 dark:text-blue-300">{textScale}%</span>
            </button>
            <div className="grid grid-cols-2 gap-4 overflow-y-auto pb-12 px-1">
              {menuItems.map((item) => (
                <button
                  key={item.id}
                  onClick={() => { setActiveTab(item.id); setMobileMenuOpen(false); }}
                  className={`group flex flex-col items-center justify-center p-8 rounded-2xl transition-all duration-300 active-shrink ${activeTab === item.id
                    ? 'bg-gradient-to-br from-blue-600 to-indigo-700 text-white shadow-2xl shadow-blue-500/40 border-none'
                    : 'bg-white dark:bg-slate-800/50 text-slate-500 border border-slate-100 dark:border-slate-800'
                    }`}
                >
                  <ModuleBadge id={item.id} active={activeTab === item.id} size="lg" />
                  <span className="font-black text-xs uppercase tracking-wider">{item.label}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      <main className="flex-1 flex flex-col overflow-hidden relative">
        <header className={`${compactMode ? 'h-14 lg:h-16' : 'h-24 lg:h-28'} flex items-center justify-between px-6 lg:px-12 z-20 transition-all`}>
          <div className="flex items-center w-full max-w-5xl">
            <div className="hidden xl:flex items-center min-w-[300px] max-w-[360px] mr-5">
              <ModuleBadge id={activeTab} active size="sm" />
              <div className="ml-3 min-w-0">
                <p className="text-[10px] font-black uppercase tracking-[0.22em] text-blue-500">
                  {MODULE_GROUP_LABELS[activeModule.group][language] || MODULE_GROUP_LABELS[activeModule.group].zh}
                </p>
                <h2 className="truncate text-lg font-black tracking-tight text-slate-900 dark:text-white">{activeModuleTitle}</h2>
                <p className="truncate text-xs font-bold text-slate-400">{activeModuleDescription}</p>
              </div>
            </div>
            <div className="hidden lg:flex flex-1 items-center bg-white/60 dark:bg-slate-900/60 backdrop-blur-xl px-7 py-4.5 rounded-2xl shadow-sm border border-white/50 dark:border-slate-800 focus-within:shadow-[0_15px_40px_-5px_rgba(37,99,235,0.12)] focus-within:border-blue-200 dark:focus-within:border-blue-900 focus-within:ring-0 transition-all duration-500 group cursor-pointer" onClick={() => setIsCommandPaletteOpen(true)}>
              <Search size={22} className="text-slate-400 group-focus-within:text-blue-600 transition-colors" />
              <input type="text" placeholder={t.commandPlaceholder} readOnly className="bg-transparent border-none focus:ring-0 text-sm ml-5 w-full font-black text-slate-800 dark:text-white placeholder:text-slate-300 cursor-pointer" />
              <div className="flex items-center text-xs font-black text-slate-300 px-3 py-1 bg-slate-50 dark:bg-slate-800 rounded-lg ml-2">
                <Command size={10} className="mr-1" /> K
              </div>
            </div>
            <div className="lg:hidden flex items-center space-x-4">
              <div className="w-12 h-12 bg-blue-600 rounded-[22px] flex items-center justify-center text-white shadow-xl shadow-blue-500/30">
                <Command size={22} />
              </div>
              <h1 className="text-2xl font-black tracking-tighter italic text-slate-900 dark:text-white">{APP_BRAND}</h1>
            </div>
          </div>

          <div className="hidden lg:flex items-center space-x-3 lg:space-x-5">
            <button
              onClick={() => setCompactMode(prev => !prev)}
              data-testid="compact-mode-toggle"
              aria-label={compactMode ? '关闭紧凑模式' : '开启紧凑模式'}
              title={compactMode ? '关闭紧凑模式' : '开启紧凑模式'}
              className={`p-4 backdrop-blur-xl rounded-[22px] transition-all shadow-sm border active-shrink group ${
                compactMode
                  ? 'border-blue-200 bg-blue-600 text-white dark:border-blue-800 dark:bg-blue-500'
                  : 'border-white/40 bg-white/60 text-slate-500 hover:bg-blue-100 hover:text-blue-600 dark:border-slate-800 dark:bg-slate-900/60 dark:hover:bg-blue-900/30 dark:hover:text-blue-400'
              }`}
            >
              <Settings size={22} className="group-hover:rotate-90 transition-transform duration-500" />
            </button>

            <button
              onClick={cycleTextScale}
              data-testid="text-scale-toggle"
              aria-label={`文字缩放 ${textScale}%`}
              title={`文字缩放 ${textScale}%`}
              className="flex min-w-16 items-center justify-center gap-1 p-4 bg-white/60 dark:bg-slate-900/60 backdrop-blur-xl rounded-[22px] text-slate-500 hover:bg-blue-100 hover:text-blue-600 dark:hover:bg-blue-900/30 dark:hover:text-blue-400 transition-all shadow-sm border border-white/40 dark:border-slate-800 active-shrink"
            >
              <Type size={21} />
              <span className="text-[10px] font-black tabular-nums">{textScale}%</span>
            </button>

            <button
              onClick={toggleTheme}
              data-testid="theme-toggle"
              aria-label={theme === 'light' ? '切换到深色模式' : '切换到浅色模式'}
              title={theme === 'light' ? '切换到深色模式' : '切换到浅色模式'}
              className="p-4 bg-white/60 dark:bg-slate-900/60 backdrop-blur-xl rounded-[22px] text-slate-500 hover:bg-amber-100 dark:hover:bg-indigo-900 hover:text-amber-600 dark:hover:text-indigo-300 transition-all shadow-sm border border-white/40 dark:border-slate-800 active-shrink group"
            >
              {theme === 'light' ? <Moon size={22} className="group-hover:rotate-12 transition-transform duration-500" /> : <Sun size={22} className="group-hover:rotate-45 transition-transform duration-700" />}
            </button>

            <button onClick={() => setShowAISettings(true)} className="p-4 bg-white/60 dark:bg-slate-900/60 backdrop-blur-xl rounded-[22px] text-slate-500 hover:bg-blue-100 dark:hover:bg-blue-900/30 hover:text-blue-600 dark:hover:text-blue-400 transition-all shadow-sm border border-white/40 dark:border-slate-800 active-shrink group" title={t.aiSettings}>
              <Brain size={22} className="group-hover:scale-110 transition-transform duration-300" />
            </button>

            <div className="relative">
              <button onClick={() => setShowPicker(p => p === 'lang' ? null : 'lang')} className="flex items-center space-x-3 px-5 py-4 bg-white/60 dark:bg-slate-900/60 backdrop-blur-xl rounded-[22px] hover:shadow-xl transition-all shadow-sm active-shrink border border-white/40 dark:border-slate-800 group">
                <div className="w-7 h-7 bg-sky-100/80 text-sky-600 rounded-full flex items-center justify-center shadow-inner group-hover:scale-110 transition-transform">
                  <Languages size={16} strokeWidth={2.6} />
                </div>
                <span className="text-xs font-black tracking-tight uppercase">{language}</span>
              </button>
              {showPicker === 'lang' && (
                <div className="absolute right-0 top-full mt-4 w-40 bg-white/95 dark:bg-slate-900/95 backdrop-blur-2xl rounded-[28px] shadow-2xl border border-white/40 dark:border-slate-800 p-2 z-[110] animate-in slide-in-from-top-4 duration-300">
                  {([
                    ['zh', '中文'],
                    ['en', 'English'],
                    ['vi', 'Tiếng Việt'],
                  ] as const).map(([code, label]) => (
                    <button
                      key={code}
                      onClick={() => { setLanguage(code as Language); setShowPicker(null); }}
                      className={`w-full text-left px-5 py-3.5 rounded-2xl text-sm font-black mb-1 transition-all ${language === code ? 'bg-blue-600 text-white shadow-lg' : 'hover:bg-slate-100 dark:hover:bg-slate-800'}`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="relative">
              <button onClick={() => setShowPicker(p => p === 'curr' ? null : 'curr')} className="flex items-center space-x-3 px-5 py-4 bg-white/60 dark:bg-slate-900/60 backdrop-blur-xl rounded-[22px] hover:shadow-xl transition-all shadow-sm active-shrink border border-white/40 dark:border-slate-800 group">
                <div className="w-7 h-7 bg-emerald-100/80 text-emerald-600 rounded-full flex items-center justify-center shadow-inner group-hover:scale-110 transition-transform">
                  <DollarSign size={16} strokeWidth={3} />
                </div>
                <span className="text-xs font-black tracking-tight">{currency}</span>
              </button>
              {showPicker === 'curr' && (
                <div className="absolute right-0 top-full mt-4 w-40 bg-white/95 dark:bg-slate-900/95 backdrop-blur-2xl rounded-[28px] shadow-2xl border border-white/40 dark:border-slate-800 p-2 z-[110] animate-in slide-in-from-top-4 duration-300">
                  {['CNY', 'USD', 'VND'].map(c => (
                    <button key={c} onClick={() => { setCurrency(c as Currency); setShowPicker(null); }} className={`w-full text-left px-5 py-3.5 rounded-2xl text-sm font-black mb-1 transition-all ${currency === c ? 'bg-blue-600 text-white shadow-lg' : 'hover:bg-slate-100 dark:hover:bg-slate-800'}`}>{c}</button>
                  ))}
                </div>
              )}
            </div>

            <div
              title={`${currentUser.name} - ${getRoleLabel(currentUser.role, currentUser.segment)}`}
              className={`w-14 h-14 rounded-[24px] border-4 border-white/80 dark:border-slate-800 shadow-2xl overflow-hidden shrink-0 flex items-center justify-center text-white p-0.5 ${roleColors[currentUser.role]}`}
            >
              <div className="w-full h-full rounded-[20px] overflow-hidden bg-white/10 backdrop-blur-sm flex items-center justify-center">
                {(typeof currentUser.avatar === 'string' && currentUser.avatar.includes('http')) ? <img src={currentUser.avatar} className="w-full h-full object-cover" /> : <UserCircle size={28} />}
              </div>
            </div>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto px-6 pt-4 pb-32 lg:px-12 lg:py-8 no-scrollbar transition-all duration-300">
          <div className="max-w-[1400px] mx-auto">
            {children}
          </div>
        </div>

        <div className="lg:hidden fixed bottom-[calc(1rem+env(safe-area-inset-bottom))] left-4 right-4 h-[88px] bg-white/86 dark:bg-slate-950/86 backdrop-blur-2xl rounded-2xl shadow-[0_30px_60px_-15px_rgba(0,0,0,0.25)] border border-white/50 dark:border-slate-800/50 flex items-center justify-evenly px-3 z-[90] animate-in slide-in-from-bottom-12 duration-700">
          {menuItems.slice(0, 4).map(item => (
            <button key={item.id} onClick={() => setActiveTab(item.id)} className={`relative flex h-14 min-w-14 flex-col items-center justify-center px-3 py-2 rounded-[18px] transition-all duration-300 active-shrink ${activeTab === item.id ? 'bg-blue-600 text-white shadow-xl shadow-blue-500/40 -translate-y-2 border-2 border-slate-50 dark:border-slate-950' : 'text-slate-500'}`}>
              <ModuleBadge id={item.id} active={activeTab === item.id} size="sm" />
              {activeTab === item.id && <span className="absolute -bottom-5 max-w-[72px] truncate text-xs font-black text-blue-600">{item.label}</span>}
            </button>
          ))}
          <button data-testid="mobile-menu-open" className="flex h-14 min-w-14 flex-col items-center justify-center rounded-[18px] text-slate-600 bg-slate-100/90 dark:bg-slate-800/90 dark:text-slate-200 active-shrink" onClick={() => setMobileMenuOpen(true)}>
            <Menu size={26} />
          </button>
        </div>

        <Suspense fallback={null}>
          <AIAssistant context={{ currency, language }} />
          <AISettings isOpen={showAISettings} onClose={() => setShowAISettings(false)} />
        </Suspense>
      </main>
    </div>
  );
};

export default Layout;




