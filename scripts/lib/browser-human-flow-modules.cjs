const { createCommercialHumanFlowModules } = require('./browser-human-flow-commercial-modules.cjs');
const { createOperationsHumanFlowModules } = require('./browser-human-flow-operations-modules.cjs');
const { createProductionSmokeModule } = require('./browser-human-flow-production-module.cjs');

function createBrowserHumanFlowModules(context) {
  const {
    moduleCRM,
    moduleOrdersAndCollections,
    moduleShipping,
  } = createCommercialHumanFlowModules(context);
  const {
    moduleProcurementAndWarehouse,
    moduleFinanceCollectionsAndAdjustment,
  } = createOperationsHumanFlowModules(context);
  const moduleProductionSmoke = createProductionSmokeModule({
    getBodyText: context.getBodyText,
    openHash: context.openHash,
    safeScreenshot: context.safeScreenshot,
    withTimeout: context.withTimeout,
  });

  const moduleDefinitions = [
    {
      name: 'crm',
      role: 'admin',
      dependencies: [],
      purpose: 'Create and read back customer master data with multiple names, addresses, and contacts.',
      run: moduleCRM,
    },
    {
      name: 'orders',
      role: 'admin',
      dependencies: ['crm'],
      purpose: 'Create a sales order, record payment, and read back payment promise state.',
      run: moduleOrdersAndCollections,
    },
    {
      name: 'shipping',
      role: 'admin',
      dependencies: ['crm', 'orders'],
      purpose: 'Open shipment receipt drawer and submit a receipt batch.',
      run: moduleShipping,
    },
    {
      name: 'procurement-warehouse',
      role: 'admin',
      dependencies: [],
      purpose: 'Create supplier and purchase order, then switch to warehouse inbound readback.',
      run: moduleProcurementAndWarehouse,
    },
    {
      name: 'collections-adjustment',
      role: 'finance',
      dependencies: ['crm', 'orders'],
      purpose: 'Read collection center and run adjustment create/apply/reverse flow.',
      run: moduleFinanceCollectionsAndAdjustment,
    },
    {
      name: 'production',
      role: 'admin',
      dependencies: [],
      purpose: 'Run production route smoke plus deep browser proof for chemical formula lines, work order, QC, completion, and batch readback.',
      run: moduleProductionSmoke,
    },
  ];

  return { moduleDefinitions };
}

module.exports = {
  createBrowserHumanFlowModules,
};