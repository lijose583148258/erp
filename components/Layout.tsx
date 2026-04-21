import React, { Suspense, lazy, useState } from 'react';
import {
  Settings, Search, Command, ArrowRightLeft, FileText, Factory, Warehouse,
  FlaskConical, ShoppingCart, Languages, Sun, Moon, Users2, DollarSign, Menu, X, UserCircle, LogOut, Briefcase, Network, ShieldCheck, HandCoins, BarChart3,
  LayoutDashboard, Users, ShieldAlert, Truck, RotateCcw, ClipboardList
} from 'lucide-react';
import { useAppContext } from '../app/AppContext';
import { canOpenModule } from '../app/permissions';
import { Language, Currency, UserRole } from '../types';
import { Brain } from 'lucide-react';

const AIAssistant = lazy(() => import('./AIAssistant'));
const AISettings = lazy(() => import('./AISettings'));
const APP_BRAND = '爱劳达 ERP+CRM';

type ModuleIconConfig = {
  icon: React.ComponentType<{ size?: number; className?: string }>;
  gradient: string;
  accent: string;
  ornament: 'dot' | 'bar' | 'ring' | 'spark';
};

const moduleIconMap: Record<string, ModuleIconConfig> = {
  dashboard: { icon: LayoutDashboard, gradient: 'from-sky-500 via-blue-600 to-indigo-700', accent: 'bg-cyan-300', ornament: 'ring' },
  crm: { icon: Users, gradient: 'from-fuchsia-500 via-violet-600 to-blue-600', accent: 'bg-fuchsia-200', ornament: 'dot' },
  orders: { icon: ShoppingCart, gradient: 'from-emerald-500 via-teal-500 to-cyan-600', accent: 'bg-lime-200', ornament: 'bar' },
  collections: { icon: HandCoins, gradient: 'from-amber-400 via-orange-500 to-rose-500', accent: 'bg-white/80', ornament: 'dot' },
  financeAnalytics: { icon: BarChart3, gradient: 'from-violet-500 via-purple-600 to-fuchsia-700', accent: 'bg-violet-200', ornament: 'spark' },
  contracts: { icon: FileText, gradient: 'from-slate-700 via-slate-800 to-zinc-900', accent: 'bg-slate-300', ornament: 'bar' },
  barter: { icon: ArrowRightLeft, gradient: 'from-cyan-500 via-sky-600 to-blue-700', accent: 'bg-cyan-200', ornament: 'dot' },
  risk: { icon: ShieldAlert, gradient: 'from-rose-500 via-red-600 to-orange-500', accent: 'bg-rose-200', ornament: 'ring' },
  dealerAnalytics: { icon: DollarSign, gradient: 'from-emerald-500 via-lime-500 to-teal-600', accent: 'bg-emerald-200', ornament: 'spark' },
  samples: { icon: FlaskConical, gradient: 'from-cyan-500 via-blue-600 to-violet-700', accent: 'bg-cyan-200', ornament: 'bar' },
  shipping: { icon: Truck, gradient: 'from-slate-500 via-blue-600 to-cyan-600', accent: 'bg-white/80', ornament: 'dot' },
  discrepancies: { icon: ClipboardList, gradient: 'from-amber-500 via-red-500 to-rose-600', accent: 'bg-amber-100', ornament: 'spark' },
  rma: { icon: RotateCcw, gradient: 'from-amber-500 via-orange-500 to-red-500', accent: 'bg-amber-200', ornament: 'ring' },
  team: { icon: Users2, gradient: 'from-blue-500 via-indigo-500 to-fuchsia-600', accent: 'bg-blue-200', ornament: 'dot' },
  assets: { icon: Briefcase, gradient: 'from-stone-500 via-slate-600 to-zinc-700', accent: 'bg-stone-200', ornament: 'bar' },
  production: { icon: Factory, gradient: 'from-emerald-600 via-teal-600 to-cyan-700', accent: 'bg-emerald-200', ornament: 'spark' },
  procurement: { icon: Network, gradient: 'from-violet-600 via-fuchsia-600 to-pink-600', accent: 'bg-pink-200', ornament: 'ring' },
  warehouse: { icon: Warehouse, gradient: 'from-amber-500 via-orange-500 to-rose-500', accent: 'bg-amber-200', ornament: 'bar' },
  audit: { icon: ShieldCheck, gradient: 'from-slate-700 via-slate-800 to-slate-900', accent: 'bg-slate-300', ornament: 'dot' },
};

const ModuleBadge: React.FC<{ id: string; active?: boolean; size?: 'sm' | 'md' | 'lg' }> = ({ id, active = false, size = 'md' }) => {
  const tone = moduleIconMap[id] ?? moduleIconMap.dashboard;
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
  setActiveTab: (tab: string) => void;
  onLogout?: () => void;
}

const Layout: React.FC<LayoutProps> = ({ children, activeTab, setActiveTab, onLogout }) => {
  const [showPicker, setShowPicker] = useState<'lang' | 'curr' | 'role' | null>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [showAISettings, setShowAISettings] = useState(false);
  const { language, setLanguage, theme, toggleTheme, currency, setCurrency, currentUser, switchUser, t, setIsCommandPaletteOpen } = useAppContext();

  const allMenuItems = [
    { id: 'dashboard', label: t.dashboard, icon: LayoutDashboard, roles: ['admin', 'manager', 'sales', 'warehouse', 'finance'] },
    { id: 'crm', label: t.crm, icon: Users, roles: ['admin', 'manager', 'sales', 'finance'] },
    { id: 'orders', label: t.orders, icon: ShoppingCart, roles: ['admin', 'manager', 'sales', 'finance'] },
    { id: 'collections', label: t.collectionsTitle || '回款中心', icon: HandCoins, roles: ['admin', 'manager', 'sales', 'finance'] },
    { id: 'financeAnalytics', label: t.performanceReport || '财务经营工作台', icon: BarChart3, roles: ['admin', 'manager', 'finance'] },
    { id: 'contracts', label: t.contractsTitle || '合同管理', icon: FileText, roles: ['admin', 'manager', 'sales', 'finance'] },
    { id: 'barter', label: t.barterTitle || '货抵支付 / 换货贸易', icon: ArrowRightLeft, roles: ['admin', 'manager', 'sales', 'warehouse'] },
    { id: 'risk', label: t.risk, icon: ShieldAlert, roles: ['admin', 'manager', 'finance', 'sales'] },
    { id: 'dealerAnalytics', label: t.dealerAnalytics, icon: DollarSign, roles: ['admin', 'manager', 'finance'] },
    { id: 'samples', label: t.samples, icon: FlaskConical, roles: ['admin', 'manager', 'sales', 'warehouse'] },
    { id: 'shipping', label: t.shipping, icon: Truck, roles: ['admin', 'manager', 'sales', 'warehouse'] },
    { id: 'discrepancies', label: t.receiptDiscrepancyWorkbench || '收发货差异', icon: ClipboardList, roles: ['admin', 'manager', 'warehouse', 'finance'] },
    { id: 'rma', label: t.rma, icon: RotateCcw, roles: ['admin', 'manager', 'sales'] },
    { id: 'team', label: t.team, icon: Users2, roles: ['admin', 'manager'] },
    { id: 'assets', label: t.assets, icon: Briefcase, roles: ['admin', 'manager', 'warehouse', 'finance'] },
    { id: 'production', label: t.production || '生产管理', icon: Factory, roles: ['admin', 'manager', 'warehouse', 'finance'] },
    { id: 'warehouse', label: t.warehouse || '仓储管理', icon: Warehouse, roles: ['admin', 'manager', 'warehouse'] },
    { id: 'procurement', label: t.procurement, icon: Network, roles: ['admin', 'manager', 'warehouse', 'finance'] },
    { id: 'audit', label: t.audit, icon: ShieldCheck, roles: ['admin'] },
  ];

  const menuItems = allMenuItems.filter(item => canOpenModule(currentUser, item.id));

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

  return (
    <div className="flex h-screen bg-[#F8FAFC] dark:bg-slate-950 text-slate-800 dark:text-slate-100 overflow-hidden font-sans selection:bg-blue-200 dark:selection:bg-blue-900">

      <aside className="hidden lg:flex w-72 bg-white/60 dark:bg-slate-900/60 backdrop-blur-[24px] border-r border-white/40 dark:border-slate-800/50 flex-col z-30 transition-all duration-500 m-5 rounded-[44px] shadow-[0_32px_64px_-16px_rgba(0,0,0,0.08)] dark:shadow-none hover:shadow-blue-500/5 transition-all">
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

        <nav className="flex-1 px-6 space-y-1.5 overflow-y-auto no-scrollbar pb-6 mt-2">
          {menuItems.map((item) => (
            <button
              key={item.id}
              onClick={() => setActiveTab(item.id)}
              className={`group w-full flex items-center px-6 py-4 rounded-[26px] transition-all duration-300 bouncy active-shrink ${activeTab === item.id
                ? 'bg-gradient-to-br from-blue-600 to-blue-700 text-white shadow-2xl shadow-blue-500/40 scale-100 z-10'
                : 'text-slate-500 dark:text-slate-400 hover:bg-white/80 dark:hover:bg-slate-800/80 hover:scale-[1.03] hover:shadow-lg hover:shadow-slate-200/40 dark:hover:shadow-none'
                }`}
            >
              <ModuleBadge id={item.id} active={activeTab === item.id} />
              <span className={`ml-4 text-sm tracking-wide ${activeTab === item.id ? 'font-black' : 'font-bold'}`}>{item.label}</span>
              {activeTab === item.id && <div className="ml-auto w-1.5 h-1.5 bg-white rounded-full animate-pulse shadow-sm" />}
            </button>
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
            <button onClick={() => setShowPicker(showPicker === 'role' ? null : 'role')} className="p-2 text-slate-300 hover:text-blue-500 transition-all hover:rotate-90 duration-500">
              <Settings size={16} />
            </button>

            {showPicker === 'role' && (
              <div className="absolute bottom-full left-0 mb-4 w-72 bg-white/95 dark:bg-slate-900/95 backdrop-blur-2xl rounded-2xl shadow-[0_20px_50px_rgba(0,0,0,0.15)] border border-white/40 dark:border-slate-800 p-4 z-[110] animate-in slide-in-from-bottom-4 zoom-in-95 duration-300">
                <div className="flex justify-between items-center mb-4 px-1">
                  <p className="text-xs font-black uppercase text-blue-600 tracking-wider">{t.switchRole}</p>
                  <button onClick={() => setShowPicker(null)} className="text-slate-300 hover:text-slate-500 px-1"><X size={14} /></button>
                </div>

                <div className="grid grid-cols-1 gap-2">
                  <button onClick={() => { switchUser('manager', 'direct'); setShowPicker(null); setActiveTab('dashboard'); }} className="group relative w-full text-left p-3 rounded-2xl text-sm font-black border border-slate-50 dark:border-slate-800 hover:border-blue-200 dark:hover:border-blue-800 hover:bg-blue-50/30 dark:hover:bg-blue-900/20 transition-all flex items-center">
                    <div className="p-2 bg-blue-100 dark:bg-blue-900/50 text-blue-600 rounded-xl mr-3 group-hover:scale-110 transition-transform"><Briefcase size={14} /></div>
                    <div>
                      <span>{t.roleManagerDirect}</span>
                      <p className="text-xs text-slate-400 font-bold opacity-0 group-hover:opacity-100 transition-opacity">{t.directSalesDept}</p>
                    </div>
                  </button>
                  <button onClick={() => { switchUser('manager', 'channel'); setShowPicker(null); setActiveTab('dashboard'); }} className="group relative w-full text-left p-3 rounded-2xl text-sm font-black border border-slate-50 dark:border-slate-800 hover:border-blue-200 dark:hover:border-blue-800 hover:bg-blue-50/30 dark:hover:bg-blue-900/20 transition-all flex items-center">
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
                      onClick={() => { switchUser(r); setShowPicker(null); setActiveTab('dashboard'); }}
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
        <header className="h-24 lg:h-28 flex items-center justify-between px-6 lg:px-12 z-20 transition-all">
          <div className="flex items-center w-full max-w-2xl">
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

          <div className="flex items-center space-x-3 lg:space-x-5">
            <button onClick={toggleTheme} className="p-4 bg-white/60 dark:bg-slate-900/60 backdrop-blur-xl rounded-[22px] text-slate-500 hover:bg-amber-100 dark:hover:bg-indigo-900 hover:text-amber-600 dark:hover:text-indigo-300 transition-all shadow-sm border border-white/40 dark:border-slate-800 active-shrink group">
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
              onClick={() => setShowPicker(p => p === 'role' ? null : 'role')}
              className={`w-14 h-14 rounded-[24px] border-4 border-white/80 dark:border-slate-800 shadow-2xl overflow-hidden shrink-0 active-shrink cursor-pointer flex items-center justify-center text-white p-0.5 transition-all hover:scale-105 active:scale-95 ${roleColors[currentUser.role]}`}
            >
              <div className="w-full h-full rounded-[20px] overflow-hidden bg-white/10 backdrop-blur-sm flex items-center justify-center">
                {(typeof currentUser.avatar === 'string' && currentUser.avatar.includes('http')) ? <img src={currentUser.avatar} className="w-full h-full object-cover" /> : <UserCircle size={28} />}
              </div>
            </div>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto px-6 lg:px-12 py-4 lg:py-8 no-scrollbar transition-all duration-300">
          <div className="max-w-[1400px] mx-auto">
            {children}
          </div>
        </div>

        <div className="lg:hidden fixed bottom-8 left-6 right-6 h-22 bg-white/70 dark:bg-slate-950/70 backdrop-blur-2xl rounded-2xl shadow-[0_30px_60px_-15px_rgba(0,0,0,0.25)] border border-white/40 dark:border-slate-800/50 flex items-center justify-evenly px-4 z-[90] animate-in slide-in-from-bottom-12 duration-700">
          {menuItems.slice(0, 4).map(item => (
            <button key={item.id} onClick={() => setActiveTab(item.id)} className={`relative flex flex-col items-center justify-center w-auto h-auto px-4 py-2 flex-wrap rounded-[24px] transition-all duration-500 active-shrink ${activeTab === item.id ? 'bg-blue-600 text-white shadow-xl shadow-blue-500/40 -translate-y-4 border-4 border-slate-50 dark:border-slate-950' : 'text-slate-400'}`}>
              <item.icon size={26} className={activeTab === item.id ? 'stroke-[2.5px]' : ''} />
              {activeTab === item.id && <span className="absolute -bottom-6 text-xs font-black uppercase text-blue-600 tracking-wider">{item.label}</span>}
            </button>
          ))}
          <button className="flex flex-col items-center justify-center w-auto h-auto px-4 py-2 flex-wrap rounded-[24px] text-slate-500 bg-slate-100/80 dark:bg-slate-800/80 active-shrink" onClick={() => setMobileMenuOpen(true)}>
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




