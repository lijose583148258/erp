import React, { lazy } from 'react';
import { activePageImports } from './activePathRegistry';
import PageErrorBoundary from '../components/PageErrorBoundary';

type ActivePageId = keyof typeof activePageImports;
type LazyPage = React.LazyExoticComponent<React.ComponentType>;

const activePages = {} as Record<ActivePageId, LazyPage>;

for (const id of Object.keys(activePageImports) as ActivePageId[]) {
    activePages[id] = lazy(async () => {
        const pageModule = await activePageImports[id]();
        return { default: pageModule.default as React.ComponentType };
    });
}

export const renderAppContent = (activeTab: string): React.ReactNode => {
    const Page = activePages[activeTab as ActivePageId] || activePages.dashboard;
    return (
        <PageErrorBoundary pageId={activeTab} key={activeTab}>
            <Page />
        </PageErrorBoundary>
    );
};
