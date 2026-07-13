module.exports = [
  {
    id: 'csp-dashboard-runtime',
    hash: '#dashboard',
    title: 'CSP dashboard runtime probe',
    expected: ['AilaoDa Business Cockpit', 'Overview'],
    category: 'security-runtime',
    severity: 'blocker',
    tags: ['csp', 'browser', 'runtime'],
    viewport: { width: 1440, height: 900 },
  },
  {
    id: 'csp-orders-runtime',
    hash: '#orders',
    title: 'CSP data grid runtime probe',
    expected: ['Sales Order Center', 'Sales Orders'],
    category: 'security-runtime',
    severity: 'blocker',
    tags: ['csp', 'browser', 'grid'],
    viewport: { width: 1440, height: 900 },
  },
];

