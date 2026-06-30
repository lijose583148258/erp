const ROUTES = [
  { id: 'dashboard', hash: '#dashboard', expected: ['AilaoDa Business Cockpit', 'Overview'] },
  { id: 'crm', hash: '#crm', expected: ['Customer Relationship and Credit Files', 'Customers'] },
  { id: 'orders', hash: '#orders', expected: ['Sales Order Center', 'Sales Orders'] },
  { id: 'collections', hash: '#collections', expected: ['Collections and Verification Center', 'Collections'] },
  { id: 'adjustment', hash: '#adjustment', expected: ['Accounts Receivable Adjustment Center', 'AR Adjust'] },
  { id: 'financeAnalytics', hash: '#financeAnalytics', expected: ['Finance Operations Analytics', 'Finance'] },
  { id: 'contracts', hash: '#contracts', expected: ['Contract Management Center', 'Contracts'] },
  { id: 'barter', hash: '#barter', expected: ['Goods Offset Payment / Barter Trade', 'Barter Settle'] },
  { id: 'risk', hash: '#risk', expected: ['Credit and Operations Risk Control', 'Risk'] },
  { id: 'dealerAnalytics', hash: '#dealerAnalytics', expected: ['Direct and Channel Sales Analytics', 'Channels'] },
  { id: 'samples', hash: '#samples', expected: ['Sample Requests and Follow-up', 'Samples'] },
  { id: 'shipping', hash: '#shipping', expected: ['Shipping, Logistics, and POD', 'Shipping'] },
  { id: 'discrepancies', hash: '#discrepancies', expected: ['Receiving and Shipping Discrepancy Workbench', 'Discrepancy'] },
  { id: 'rma', hash: '#rma', expected: ['After-sales Returns and Compensation', 'After-sales'] },
  { id: 'team', hash: '#team', expected: ['Users, Roles, and Permissions', 'Org & Roles'] },
  { id: 'assets', hash: '#assets', expected: ['Asset and Equipment Ledger', 'Assets'] },
  { id: 'production', hash: '#production', expected: ['Production Formulas and Work Orders', 'Production'] },
  { id: 'warehouse', hash: '#warehouse', expected: ['Warehouse, Locations, and Inventory', 'Warehouse'] },
  { id: 'procurement', hash: '#procurement', expected: ['Procurement, Suppliers, and Receiving', 'Procurement'] },
  { id: 'audit', hash: '#audit', expected: ['System Audit and Operation Logs', 'Audit Logs'] },
];

module.exports = { ROUTES };
