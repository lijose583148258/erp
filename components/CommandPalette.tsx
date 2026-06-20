import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
    Search,
    Command,
    BarChart3,
    Moon,
    Sun,
    Database,
    Plus,
    Zap,
} from 'lucide-react';
import { useAppContext } from '../app/AppContext';
import { canOpenModule } from '../app/permissions';
import { getModuleAliases, getModuleDescription, getModuleLabel, getNavigationModules } from './navigation/moduleRegistry';
import api from '../utils/api';

interface CommandItem {
    id: string;
    title: string;
    description: string;
    icon: React.ReactNode;
    category: 'navigation' | 'actions' | 'system';
    action: () => void;
    shortcut?: string;
    aliases?: readonly string[];
}

const CommandPalette: React.FC<{ isOpen: boolean; onClose: () => void; setActiveTab: (tab: string) => boolean }> = ({
    isOpen,
    onClose,
    setActiveTab
}) => {
    const { t, theme, toggleTheme, notify, language, currentUser } = useAppContext();
    const [query, setQuery] = useState('');
    const [selectedIndex, setSelectedIndex] = useState(0);
    const inputRef = useRef<HTMLInputElement>(null);

    // Define commands
    const navigationCommands = useMemo<CommandItem[]>(() => getNavigationModules()
        .filter(module => canOpenModule(currentUser, module.id))
        .map(module => {
            const Icon = module.icon;
            return {
                id: `nav-${module.id}`,
                title: getModuleLabel(module.id, language),
                description: getModuleDescription(module.id, language),
                icon: <Icon className="w-5 h-5" />,
                category: 'navigation' as const,
                action: () => setActiveTab(module.id),
                aliases: getModuleAliases(module.id, language),
            };
        }), [currentUser, language, setActiveTab]);

    const commands = useMemo<CommandItem[]>(() => [
        // --- Navigation ---
        ...navigationCommands,

        // --- Actions ---
        { id: 'act-new-order', title: t.actNewOrder, description: t.actNewOrderDesc, icon: <Plus className="w-5 h-5 text-blue-500" />, category: 'actions', action: () => { if (setActiveTab('orders')) window.dispatchEvent(new CustomEvent('command:create-order')); } },
        { id: 'act-ocr-invoice', title: t.actOcrInvoice, description: t.actOcrInvoiceDesc, icon: <Zap className="w-5 h-5 text-amber-500" />, category: 'actions', action: () => { if (setActiveTab('orders')) window.dispatchEvent(new CustomEvent('command:ocr-invoice')); } },
        { id: 'act-analyst', title: t.actAiAnalyst, description: t.actAiAnalystDesc, icon: <BarChart3 className="w-5 h-5 text-emerald-500" />, category: 'actions', action: () => { if (setActiveTab('dashboard')) notify('info', 'AI 正在准备深度分析报告...'); } },

        // --- System ---
        { id: 'sys-theme', title: t.sysThemeSwitch, description: t.sysThemeSwitch, icon: theme === 'light' ? <Moon className="w-5 h-5" /> : <Sun className="w-5 h-5" />, category: 'system', action: toggleTheme },
        {
            id: 'sys-backup', title: t.sysBackupNow, description: t.sysBackupDesc, icon: <Database className="w-5 h-5" />, category: 'system', action: async () => {
                try {
                    // This will be handled by the server
                    notify('info', '备份请求已发起，请稍后查看结果');
                    await api.post('/system/backups');
                    notify('success', '数据库备份成功！');
                } catch {
                    notify('error', '备份失败，请检查网络或权限');
                }
            }
        },
    ], [t, theme, toggleTheme, setActiveTab, notify, navigationCommands]);

    // Fuzzy filter
    const filteredCommands = useMemo(() => {
        if (!query) return commands;
        const lowerQuery = query.toLowerCase();
        return commands.filter(cmd =>
            cmd.title.toLowerCase().includes(lowerQuery) ||
            cmd.description.toLowerCase().includes(lowerQuery) ||
            cmd.category.toLowerCase().includes(lowerQuery) ||
            Boolean(cmd.aliases?.some(alias => alias.toLowerCase().includes(lowerQuery)))
        );
    }, [commands, query]);

    // Reset selection on query change
    useEffect(() => {
        setSelectedIndex(0);
    }, [query]);

    // Focus input on open
    useEffect(() => {
        if (isOpen) {
            setTimeout(() => inputRef.current?.focus(), 100);
            setQuery('');
        }
    }, [isOpen]);

    // Keyboard navigation
    const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            setSelectedIndex(prev => (prev + 1) % filteredCommands.length);
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setSelectedIndex(prev => (prev - 1 + filteredCommands.length) % filteredCommands.length);
        } else if (e.key === 'Enter') {
            e.preventDefault();
            if (filteredCommands[selectedIndex]) {
                filteredCommands[selectedIndex].action();
                onClose();
            }
        } else if (e.key === 'Escape') {
            onClose();
        }
    }, [filteredCommands, selectedIndex, onClose]);

    return (
        <AnimatePresence>
            {isOpen && (
                <div className="fixed inset-0 z-[200] flex items-start justify-center pt-[15vh] px-4">
                    {/* Backdrop */}
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        onClick={onClose}
                        className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
                    />

                    {/* Palette Container */}
                    <motion.div
                        initial={{ opacity: 0, scale: 0.95, y: -20 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.95, y: -20 }}
                        className="relative w-full max-w-2xl bg-white dark:bg-slate-900 rounded-[32px] shadow-2xl border border-slate-100 dark:border-slate-800 overflow-hidden"
                    >
                        {/* Search Input */}
                        <div className="flex items-center px-6 py-5 border-b border-slate-50 dark:border-slate-800">
                            <Search className="w-5 h-5 text-slate-400 mr-4" />
                            <input
                                ref={inputRef}
                                type="text"
                                placeholder={t.commandSearch}
                                className="flex-1 bg-transparent border-none outline-none text-lg font-bold text-slate-900 dark:text-white placeholder-slate-300 dark:placeholder-slate-600"
                                value={query}
                                onChange={(e) => setQuery(e.target.value)}
                                onKeyDown={handleKeyDown}
                            />
                            <div className="flex items-center gap-1 px-2 py-1 bg-slate-100 dark:bg-slate-800 rounded-lg">
                                <span className="text-[10px] font-black text-slate-400">ESC</span>
                            </div>
                        </div>

                        {/* Results List */}
                        <div className="max-h-[60vh] overflow-y-auto no-scrollbar py-2">
                            {filteredCommands.length > 0 ? (
                                <div className="space-y-4 px-3">
                                    {/* Categorized rendering could go here, but for simplicity we list all */}
                                    {['navigation', 'actions', 'system'].map((cat) => {
                                        const catCmds = filteredCommands.filter(c => c.category === cat);
                                        if (catCmds.length === 0) return null;
                                        return (
                                            <div key={cat} className="space-y-1">
                                                <div className="px-3 py-2 text-[10px] font-black uppercase tracking-widest text-slate-400 opacity-50">
                                                    {cat === 'navigation' ? t.navQuickJump : cat === 'actions' ? t.navBusinessOps : t.navSysMgmt}
                                                </div>
                                                {catCmds.map((cmd) => {
                                                    const realIdx = filteredCommands.indexOf(cmd);
                                                    const isSelected = realIdx === selectedIndex;
                                                    return (
                                                        <button
                                                            key={cmd.id}
                                                            onClick={() => { cmd.action(); onClose(); }}
                                                            onMouseEnter={() => setSelectedIndex(realIdx)}
                                                            className={`w-full flex items-center px-4 py-3.5 rounded-2xl transition-all text-left ${isSelected
                                                                ? 'bg-blue-600 shadow-lg shadow-blue-200 dark:shadow-none'
                                                                : 'hover:bg-slate-50 dark:hover:bg-slate-800/50'
                                                                }`}
                                                        >
                                                            <div className={`p-2 rounded-xl mr-4 ${isSelected ? 'bg-white/20 text-white' : 'bg-slate-100 dark:bg-slate-800 text-slate-500'}`}>
                                                                {cmd.icon}
                                                            </div>
                                                            <div className="flex-1 min-w-0">
                                                                <div className={`text-sm font-black ${isSelected ? 'text-white' : 'text-slate-900 dark:text-white'}`}>
                                                                    {cmd.title}
                                                                </div>
                                                                <div className={`text-xs truncate ${isSelected ? 'text-white/70' : 'text-slate-400 font-bold'}`}>
                                                                    {cmd.description}
                                                                </div>
                                                            </div>
                                                            {isSelected && (
                                                                <div className="text-white opacity-40">
                                                                    <Command size={14} />
                                                                </div>
                                                            )}
                                                        </button>
                                                    );
                                                })}
                                            </div>
                                        );
                                    })}
                                </div>
                            ) : (
                                <div className="py-20 text-center">
                                    <div className="bg-slate-50 dark:bg-slate-800/50 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4">
                                        <Search className="text-slate-200" size={32} />
                                    </div>
                                    <p className="text-slate-400 font-bold uppercase text-xs tracking-widest">{t.commandEmpty}</p>
                                </div>
                            )}
                        </div>

                        {/* Footer */}
                        <div className="px-6 py-4 bg-slate-50/50 dark:bg-slate-800/10 border-t border-slate-50 dark:border-slate-800 flex items-center justify-between">
                            <div className="flex items-center gap-4">
                                <div className="flex items-center gap-1.5 text-[10px] font-bold text-slate-400">
                                    <kbd className="px-1.5 py-0.5 bg-white dark:bg-slate-800 border rounded-md shadow-sm">Enter</kbd>
                                    <span>{t.ctrlSelect}</span>
                                </div>
                                <div className="flex items-center gap-1.5 text-[10px] font-bold text-slate-400">
                                    <kbd className="px-1.5 py-0.5 bg-white dark:bg-slate-800 border rounded-md shadow-sm">Enter</kbd>
                                    <span>{t.ctrlConfirm}</span>
                                </div>
                            </div>
                            <div className="text-[10px] font-black italic text-blue-500 uppercase tracking-tighter">
                                Opus 5.0 Core
                            </div>
                        </div>
                    </motion.div>
                </div>
            )}
        </AnimatePresence>
    );
};

export default CommandPalette;



