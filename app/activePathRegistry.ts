type PageModule = { default: unknown };
type PageImporter = () => Promise<PageModule>;

const stablePageImports = {
  dashboard: () => import('../pages/Dashboard'),
  crm: () => import('../pages/CRM'),
  risk: () => import('../pages/RiskControl'),
  shipping: () => import('../pages/Shipping'),
  rma: () => import('../pages/RMA'),
  samples: () => import('../pages/Samples'),
  orders: () => import('../pages/SalesOrders'),
  team: () => import('../pages/TeamManagement'),
  audit: () => import('../pages/AuditLogs'),
  settings: () => import('../pages/Settings'),
  assets: () => import('../pages/Assets'),
  production: () => import('../pages/ProductionWorkspace'),
  dealerAnalytics: () => import('../pages/DealerAnalytics'),
  procurement: () => import('../pages/Procurement'),
  barter: () => import('../pages/BarterWorkspaceView'),
  contracts: () => import('../pages/Contracts'),
  financeAnalytics: () => import('../pages/FinanceAnalyticsWorkspaceV2'),
  adjustment: () => import('../pages/adjustment/AdjustmentCenterView'),
  collections: () => import('../pages/collections/CollectionCenterView'),
  warehouse: () => import('../pages/WarehouseWorkspace'),
  discrepancies: () => import('../pages/ReceiptDiscrepancyWorkbench'),
} satisfies Record<string, PageImporter>;

// Keep candidate grids and golden fixtures out of the formal production
// artifact. Vite replaces this flag at build time, so Rollup can eliminate the
// entire branch unless the isolated lab build opts in explicitly.
const labPageImports: Record<string, PageImporter> = import.meta.env.VITE_BOM_GRID_LAB_ENABLED === 'true'
  ? {
      'production/bom-grid-lab/revogrid': () => import('../pages/BomGridLabRevo'),
      'production/bom-grid-lab/react-data-grid': () => import('../pages/BomGridLabReactDataGrid'),
    }
  : {};

export const activePageImports: Record<string, PageImporter> = {
  ...stablePageImports,
  ...labPageImports,
};
