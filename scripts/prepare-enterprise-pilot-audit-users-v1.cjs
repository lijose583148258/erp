const { ensureUiAuditUser } = require('./lib/ui-audit-user.cjs');

const accounts = [
  { username: process.env.PILOT_AUDIT_ADMIN_USERNAME || 'enterprise_pilot_admin', password: process.env.PILOT_AUDIT_ADMIN_PASSWORD || 'EnterprisePilotAdmin12345!', role: 'admin' },
  { username: process.env.PILOT_AUDIT_SALES_USERNAME || 'enterprise_pilot_sales', password: process.env.PILOT_AUDIT_SALES_PASSWORD || 'EnterprisePilotSales12345!', role: 'sales' },
];

Promise.all(accounts.map(ensureUiAuditUser))
  .then(() => console.log(`Enterprise pilot audit users ready: ${accounts.map(account => account.role).join(', ')}`))
  .catch(error => {
    console.error(String(error.message || error));
    process.exit(1);
  });
