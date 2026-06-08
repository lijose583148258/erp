import React, { Suspense } from 'react';
import Layout from './components/Layout';
import Login from './components/Login';
import ToastStack from './components/app/ToastStack';
import ClickSpark from './components/app/ClickSpark';
import CommandPalette from './components/CommandPalette';
import { AppContext } from './app/AppContext';
// Canonical app shell entry: keep explicit .tsx to avoid accidental resolution to legacy `.ts` files.
import { useAppShell } from './app/useAppShell.tsx';

const App: React.FC = () => {
    const shell = useAppShell();

    return (
        <AppContext.Provider value={shell.contextValue}>
            {!shell.isLoggedIn ? (
                <Login
                    onLogin={shell.handleLogin}
                    language={shell.language}
                    onLanguageChange={shell.setLanguage}
                />
                ) : (
                <>
                    <ClickSpark />
                    <ToastStack notifications={shell.notifications} onDismiss={shell.dismissNotification} />
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

