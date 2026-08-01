import React, { Suspense } from 'react';
import Layout from './components/Layout';
import Login from './components/Login';
import ForcePasswordChange from './components/ForcePasswordChange';
import ToastStack from './components/app/ToastStack';
import ClickSpark from './components/app/ClickSpark';
import CommandPalette from './components/CommandPalette';
import { MaterialReadinessRepairPanel } from './components/materials/MaterialReadinessRepairPanel';
import { AppContext } from './app/AppContext';
// Canonical app shell entry: keep explicit .tsx to avoid accidental resolution to legacy `.ts` files.
import { useAppShell } from './app/useAppShell.tsx';

const BootScreen: React.FC = () => (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950 text-slate-700 dark:text-slate-200">
        <div className="text-center space-y-4">
            <div className="mx-auto w-12 h-12 rounded-2xl border-4 border-blue-200 border-t-blue-600 animate-spin" />
            <div>
                <p className="text-sm font-black">正在校验登录状态...</p>
                <p className="text-xs font-bold text-slate-500 mt-1">系统主功能不会被 AI 服务阻塞</p>
            </div>
        </div>
    </div>
);

const App: React.FC = () => {
    const shell = useAppShell();

    return (
        <AppContext.Provider value={shell.contextValue}>
            {shell.isBootstrappingSession ? (
                <BootScreen />
            ) : !shell.isLoggedIn ? (
                <Login
                    onLogin={shell.handleLogin}
                    language={shell.language}
                    onLanguageChange={shell.setLanguage}
                />
            ) : shell.currentUser.mustChangePassword ? (
                <>
                    <ToastStack notifications={shell.notifications} onDismiss={shell.dismissNotification} />
                    <MaterialReadinessRepairPanel />
                    <ForcePasswordChange
                        language={shell.language}
                        username={shell.currentUser.name}
                        onSubmit={shell.handlePasswordChanged}
                        onLogout={shell.handleLogout}
                    />
                </>
            ) : (
                <>
                    <ClickSpark />
                    <ToastStack notifications={shell.notifications} onDismiss={shell.dismissNotification} />
                    <MaterialReadinessRepairPanel />
                    <CommandPalette
                        isOpen={shell.isCommandPaletteOpen}
                        onClose={() => shell.setIsCommandPaletteOpen(false)}
                        setActiveTab={shell.setActiveTab}
                    />
                    <Layout activeTab={shell.activeTab} setActiveTab={shell.setActiveTab} onLogout={shell.handleLogout}>
                        <Suspense fallback={<div className="min-h-[50vh] flex items-center justify-center text-slate-600 font-black">正在加载...</div>}>
                            <div className="animate-in fade-in zoom-in-95 duration-500 min-h-full pb-32 lg:pb-0">
                                {shell.content}
                            </div>
                        </Suspense>
                    </Layout>
                </>
            )}
        </AppContext.Provider>
    );
};

export default App;
