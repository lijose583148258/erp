import type { Application, Router } from 'express';
import authRoutes from './auth.routes';
import customerRoutes from './customer.routes';
import orderRoutes from './order.routes';
import sampleRoutes from './sample.routes';
import shippingRoutes from './shipping.routes';
import rmaRoutes from './rma.routes';
import teamRoutes from './team.routes';
import dashboardRoutes from './dashboard.routes';
import assetRoutes from './asset.routes';
import auditRoutes from './audit.routes';
import procurementRoutes from './procurement.routes';
import collectionRoutes from './collection.routes';
import systemRoutes from './system.routes';
import timberRoutes from './timber.routes';
import contractRoutes from './contract.routes';
import adjustmentRoutes from './adjustment.routes';
import productionRoutes from './production.routes';
import financeRoutes from './finance.routes';
import barterRoutes from './barter.routes';
import currencyRoutes from './currency.routes';
import warehouseRoutes from './warehouse.routes';
import receiptDiscrepancyRoutes from './receipt-discrepancy.routes';
import roleRoutes from './role.routes';
import commercialPlatformRoutes from './commercial-platform.routes';
import aiRoutes from './ai.routes';

export type ApiRouteModule = {
  path: string;
  router: Router;
  tag: string;
  summary: string;
  requiresAuth: boolean;
};

export const API_ROUTE_MODULES: ApiRouteModule[] = [
  { path: '/auth', router: authRoutes, tag: 'Auth', summary: 'Authentication, session, and password endpoints.', requiresAuth: false },
  { path: '/customers', router: customerRoutes, tag: 'Customers', summary: 'CRM customer records, pool governance, import, export, and customer activity.', requiresAuth: true },
  { path: '/orders', router: orderRoutes, tag: 'Orders', summary: 'Sales order workspace, payment, fulfillment, and order lifecycle operations.', requiresAuth: true },
  { path: '/samples', router: sampleRoutes, tag: 'Samples', summary: 'Sample request and sample tracking workflows.', requiresAuth: true },
  { path: '/shipping', router: shippingRoutes, tag: 'Shipping', summary: 'Shipping plans, receipts, logistics, and shipment state transitions.', requiresAuth: true },
  { path: '/rma', router: rmaRoutes, tag: 'RMA', summary: 'Return merchandise authorization and after-sales workflows.', requiresAuth: true },
  { path: '/team', router: teamRoutes, tag: 'Team', summary: 'Team account lifecycle, role assignment, and operator administration.', requiresAuth: true },
  { path: '/dashboard', router: dashboardRoutes, tag: 'Dashboard', summary: 'Executive dashboard and operational summary read models.', requiresAuth: true },
  { path: '/assets', router: assetRoutes, tag: 'Assets', summary: 'Asset records and customer asset movement history.', requiresAuth: true },
  { path: '/audit', router: auditRoutes, tag: 'Audit', summary: 'Audit event query and governance trail endpoints.', requiresAuth: true },
  { path: '/procurement', router: procurementRoutes, tag: 'Procurement', summary: 'Supplier, purchase order, receipt, and procurement lifecycle operations.', requiresAuth: true },
  { path: '/collections', router: collectionRoutes, tag: 'Collections', summary: 'Receivables, overdue collection, promise-to-pay, and credit-hold workflows.', requiresAuth: true },
  { path: '/adjustments', router: adjustmentRoutes, tag: 'Adjustments', summary: 'Inventory and finance adjustment workflows with approval boundaries.', requiresAuth: true },
  { path: '/system', router: systemRoutes, tag: 'System', summary: 'System administration, backup, restore, and runtime governance operations.', requiresAuth: true },
  { path: '/barter', router: barterRoutes, tag: 'Barter', summary: 'Barter agreement, counterparty, stock, and settlement workflows.', requiresAuth: true },
  { path: '/timber', router: timberRoutes, tag: 'Timber', summary: 'Timber-specific legacy-compatible trade workflows.', requiresAuth: true },
  { path: '/contracts', router: contractRoutes, tag: 'Contracts', summary: 'Contract records and contract lifecycle operations.', requiresAuth: true },
  { path: '/production', router: productionRoutes, tag: 'Production', summary: 'Chemical BOM, production order, completion, and cost ledger workflows.', requiresAuth: true },
  { path: '/finance', router: financeRoutes, tag: 'Finance', summary: 'Finance reports, summaries, and account reconciliation endpoints.', requiresAuth: true },
  { path: '/currency', router: currencyRoutes, tag: 'Currency', summary: 'Currency rate lookup and cache-backed exchange-rate operations.', requiresAuth: true },
  { path: '/warehouses', router: warehouseRoutes, tag: 'Warehouses', summary: 'Warehouse, stock ledger, and stock transfer operations.', requiresAuth: true },
  { path: '/receipt-discrepancies', router: receiptDiscrepancyRoutes, tag: 'Receipt Discrepancies', summary: 'Receipt discrepancy review, tolerance, and resolution operations.', requiresAuth: true },
  { path: '/roles', router: roleRoutes, tag: 'Roles', summary: 'Role permissions, role audit diffs, and authorization policy endpoints.', requiresAuth: true },
  { path: '/commercial', router: commercialPlatformRoutes, tag: 'Commercial Platform', summary: 'Commercial platform readiness, workflow, BI, alert, and notification APIs.', requiresAuth: true },
  { path: '/ai', router: aiRoutes, tag: 'AI', summary: 'Governed AI assistant status and safe-context assistance.', requiresAuth: true },
];

export const API_PREFIXES = ['/api', '/api/v1'] as const;

export const mountApiRoutes = (app: Application) => {
  for (const prefix of API_PREFIXES) {
    for (const routeModule of API_ROUTE_MODULES) {
      app.use(`${prefix}${routeModule.path}`, routeModule.router);
    }
  }
};
