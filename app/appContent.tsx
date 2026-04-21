import React, { lazy } from 'react';
import { activePageImports } from './activePathRegistry';

const Dashboard = lazy(activePageImports.dashboard);
const CRM = lazy(activePageImports.crm);
const RiskControl = lazy(activePageImports.risk);
const Shipping = lazy(activePageImports.shipping);
const RMA = lazy(activePageImports.rma);
const Samples = lazy(activePageImports.samples);
const SalesOrders = lazy(activePageImports.orders);
const TeamManagement = lazy(activePageImports.team);
const AuditLogs = lazy(activePageImports.audit);
const Assets = lazy(activePageImports.assets);
const ProductionWorkspace = lazy(activePageImports.production);
const DealerAnalytics = lazy(activePageImports.dealerAnalytics);
const Procurement = lazy(activePageImports.procurement);
const BarterWorkspace = lazy(activePageImports.barter);
const Contracts = lazy(activePageImports.contracts);
const FinanceAnalyticsWorkspaceV2 = lazy(activePageImports.financeAnalytics);
const AdjustmentCenterView = lazy(activePageImports.adjustment);
const CollectionCenterView = lazy(activePageImports.collections);
const WarehouseWorkspace = lazy(activePageImports.warehouse);
const ReceiptDiscrepancyWorkbench = lazy(activePageImports.discrepancies);

export const renderAppContent = (activeTab: string): React.ReactNode => {
    switch (activeTab) {
        case 'dashboard':
            return <Dashboard />;
        case 'crm':
            return <CRM />;
        case 'orders':
            return <SalesOrders />;
        case 'risk':
            return <RiskControl />;
        case 'samples':
            return <Samples />;
        case 'shipping':
            return <Shipping />;
        case 'rma':
            return <RMA />;
        case 'team':
            return <TeamManagement />;
        case 'audit':
            return <AuditLogs />;
        case 'assets':
            return <Assets />;
        case 'production':
            return <ProductionWorkspace />;
        case 'dealerAnalytics':
            return <DealerAnalytics />;
        case 'procurement':
            return <Procurement />;
        case 'barter':
            return <BarterWorkspace />;
        case 'contracts':
            return <Contracts />;
        case 'financeAnalytics':
            return <FinanceAnalyticsWorkspaceV2 />;
        case 'adjustment':
            return <AdjustmentCenterView />;
        case 'collections':
            return <CollectionCenterView />;
        case 'warehouse':
            return <WarehouseWorkspace />;
        case 'discrepancies':
            return <ReceiptDiscrepancyWorkbench />;
        default:
            return <Dashboard />;
    }
};
