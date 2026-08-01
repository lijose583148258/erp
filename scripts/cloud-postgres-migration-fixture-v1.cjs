const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const OUTPUT_DIR = path.join(ROOT, 'output', 'audit');
const STATE_PATH = path.join(OUTPUT_DIR, 'cloud-postgres-migration-fixture-state-v1.json');
const reportPathFor = (command) => path.join(OUTPUT_DIR, `cloud-postgres-migration-fixture-${command}-v1.json`);
const MARKER = 'cloud-postgres-cutover-v1';
const PRODUCT = 'Migration Fixture Resin';
const MATERIAL_CODE = 'MIG-MAT-001';
const BATCH_NO = 'MIG-BATCH-001';

function createPrismaClient(target) {
  if (target === 'postgres') {
    const clientPath = String(process.env.AUDIT_PRISMA_CLIENT_PATH || '').trim();
    const databaseUrl = String(process.env.AUDIT_DATABASE_URL || '').trim();
    if (!clientPath || !databaseUrl) {
      throw new Error('AUDIT_PRISMA_CLIENT_PATH and AUDIT_DATABASE_URL are required for target verification.');
    }
    const { PrismaClient } = require(path.resolve(ROOT, clientPath));
    return new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  }

  const databaseUrl = String(process.env.DATABASE_URL || '').trim();
  if (!databaseUrl.startsWith('file:')) {
    throw new Error('SQLite fixture commands require a file: DATABASE_URL.');
  }
  const { PrismaClient } = require('../backend/node_modules/@prisma/client');
  return new PrismaClient({ datasources: { db: { url: databaseUrl } } });
}

function stableHash(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

async function collectFixture(prisma) {
  const user = await prisma.user.findUnique({ where: { username: 'migration_fixture_admin' } });
  const customer = await prisma.customer.findFirst({ where: { licenseNumber: 'MIG-CUSTOMER-001' } });
  const order = await prisma.order.findUnique({ where: { orderNo: 'MIG-ORDER-001' } });
  const warehouse = await prisma.warehouse.findUnique({ where: { code: 'MIG-WH' } });
  const location = await prisma.location.findUnique({ where: { code: 'MIG-WH-A01' } });
  const batch = await prisma.productBatch.findUnique({ where: { batchNo: BATCH_NO } });
  const supplier = await prisma.supplier.findFirst({ where: { name: 'Migration Fixture Supplier' } });
  const shipment = await prisma.shipment.findUnique({ where: { shipmentNo: 'MIG-SHIP-001' } });
  const material = await prisma.material.findUnique({ where: { code: MATERIAL_CODE } });

  const [orderItem, payment, purchaseOrder, stockBalance, stockEntry, stockMovement, costLedger] = await Promise.all([
    order ? prisma.orderItem.findFirst({ where: { orderId: order.id, productName: PRODUCT } }) : null,
    order ? prisma.paymentRecord.findFirst({ where: { orderId: order.id, note: MARKER } }) : null,
    supplier ? prisma.purchaseOrder.findFirst({ where: { supplierId: supplier.id, item: PRODUCT } }) : null,
    location ? prisma.stockBalance.findFirst({ where: { locationId: location.id, productName: PRODUCT, batchNo: BATCH_NO } }) : null,
    prisma.stockEntry.findFirst({ where: { sourceType: 'migration_fixture', sourceRef: MARKER, status: 'posted' } }),
    prisma.stockMovement.findFirst({ where: { productName: PRODUCT, batchNo: BATCH_NO } }),
    prisma.inventoryCostLedger.findUnique({ where: { ledgerNo: 'MIG-LEDGER-001' } }),
  ]);

  const records = {
    user: user && { username: user.username, role: user.role, isActive: user.isActive },
    customer: customer && { name: customer.name, licenseNumber: customer.licenseNumber, status: customer.status },
    order: order && { orderNo: order.orderNo, finalAmount: order.finalAmount, status: order.status },
    material: material && { code: material.code, nameZh: material.nameZh, baseUnit: material.baseUnit, status: material.status, isTemporary: material.isTemporary },
    orderItem: orderItem && { materialId: orderItem.materialId, productName: orderItem.productName, quantity: orderItem.quantity, totalPrice: orderItem.totalPrice },
    payment: payment && { amount: payment.amount, status: payment.status, note: payment.note },
    warehouse: warehouse && { code: warehouse.code, status: warehouse.status },
    location: location && { code: location.code, status: location.status },
    batch: batch && { materialId: batch.materialId, batchNo: batch.batchNo, stockQuantity: batch.stockQuantity, unit: batch.unit },
    stockBalance: stockBalance && { materialId: stockBalance.materialId, productName: stockBalance.productName, batchNo: stockBalance.batchNo, quantity: stockBalance.quantity },
    stockEntry: stockEntry && { entryNo: stockEntry.entryNo, sourceRef: stockEntry.sourceRef, status: stockEntry.status },
    stockMovement: stockMovement && { materialId: stockMovement.materialId, productName: stockMovement.productName, batchNo: stockMovement.batchNo, quantityAfter: stockMovement.quantityAfter },
    costLedger: costLedger && { ledgerNo: costLedger.ledgerNo, quantityAfter: costLedger.quantityAfter, costAfter: costLedger.costAfter },
    supplier: supplier && { name: supplier.name, status: supplier.status },
    purchaseOrder: purchaseOrder && { materialId: purchaseOrder.materialId, item: purchaseOrder.item, quantity: purchaseOrder.quantity, status: purchaseOrder.status },
    shipment: shipment && { materialId: shipment.materialId, orderItemId: shipment.orderItemId, productBatchId: shipment.productBatchId, shipmentNo: shipment.shipmentNo, quantity: shipment.quantity, status: shipment.status },
  };
  const missing = Object.entries(records).filter(([, value]) => !value).map(([name]) => name);
  return { records, missing, fingerprintSha256: stableHash(records) };
}

async function seed(prisma) {
  const user = await prisma.user.upsert({
    where: { username: 'migration_fixture_admin' },
    update: { role: 'admin', isActive: true, mustChangePassword: true },
    create: {
      username: 'migration_fixture_admin',
      passwordHash: '$2a$12$KIXQ4D6Zqf6XJGQ9s6j5qOBKw8JXlFt2Y6F4oYjY6.7y8JPnULu6G',
      email: 'migration-fixture@local.test',
      role: 'admin',
      segment: 'mixed',
      isActive: true,
      mustChangePassword: true,
    },
  });
  let customer = await prisma.customer.findFirst({ where: { licenseNumber: 'MIG-CUSTOMER-001' } });
  customer = customer
    ? await prisma.customer.update({ where: { id: customer.id }, data: { name: 'Migration Fixture Customer', status: 'active', salespersonId: user.id } })
    : await prisma.customer.create({ data: { name: 'Migration Fixture Customer', licenseNumber: 'MIG-CUSTOMER-001', status: 'active', salespersonId: user.id, creditLimit: 100000, riskLevel: 'low' } });
  const material = await prisma.material.upsert({
    where: { code: MATERIAL_CODE },
    update: { nameZh: PRODUCT, baseUnit: 'kg', status: 'active', isTemporary: false, shelfLifeDays: 730, updatedBy: user.id },
    create: {
      code: MATERIAL_CODE,
      nameZh: PRODUCT,
      nameEn: PRODUCT,
      category: 'finished_good',
      baseUnit: 'kg',
      status: 'active',
      isTemporary: false,
      shelfLifeDays: 730,
      createdBy: user.id,
      updatedBy: user.id,
    },
  });

  const order = await prisma.order.upsert({
    where: { orderNo: 'MIG-ORDER-001' },
    update: { customerId: customer.id, createdBy: user.id, status: 'approved', totalAmount: 12500, finalAmount: 12500 },
    create: { orderNo: 'MIG-ORDER-001', customerId: customer.id, createdBy: user.id, status: 'approved', totalAmount: 12500, finalAmount: 12500 },
  });
  let orderItem = await prisma.orderItem.findFirst({ where: { orderId: order.id, productName: PRODUCT } });
  orderItem = orderItem
    ? await prisma.orderItem.update({ where: { id: orderItem.id }, data: { materialId: material.id, productName: material.nameZh, unit: material.baseUnit } })
    : await prisma.orderItem.create({ data: { orderId: order.id, materialId: material.id, productName: PRODUCT, quantity: 250, unit: 'kg', unitPrice: 50, totalPrice: 12500 } });
  if (!await prisma.paymentRecord.findFirst({ where: { orderId: order.id, note: MARKER } })) {
    await prisma.paymentRecord.create({ data: { orderId: order.id, amount: 2500, baseAmount: 2500, method: 'bank_transfer', status: 'verified', note: MARKER } });
  }

  const warehouse = await prisma.warehouse.upsert({ where: { code: 'MIG-WH' }, update: { status: 'active' }, create: { code: 'MIG-WH', name: 'Migration Warehouse' } });
  const location = await prisma.location.upsert({ where: { code: 'MIG-WH-A01' }, update: { warehouseId: warehouse.id, status: 'active' }, create: { warehouseId: warehouse.id, code: 'MIG-WH-A01', name: 'Migration Location A01' } });
  const batch = await prisma.productBatch.upsert({
    where: { batchNo: BATCH_NO },
    update: { materialId: material.id, productName: material.nameZh, stockQuantity: 250, unit: material.baseUnit },
    create: { materialId: material.id, batchNo: BATCH_NO, productName: PRODUCT, productionDate: new Date('2026-01-01T00:00:00.000Z'), expiryDate: new Date('2028-01-01T00:00:00.000Z'), stockQuantity: 250, unit: 'kg' },
  });
  let balance = await prisma.stockBalance.findFirst({ where: { locationId: location.id, productName: PRODUCT, batchNo: BATCH_NO } });
  balance = balance
    ? await prisma.stockBalance.update({ where: { id: balance.id }, data: { materialId: material.id, productName: material.nameZh, quantity: 250, unit: material.baseUnit } })
    : await prisma.stockBalance.create({ data: { locationId: location.id, materialId: material.id, productName: PRODUCT, batchNo: BATCH_NO, quantity: 250, unit: 'kg' } });
  let entry = await prisma.stockEntry.findFirst({ where: { sourceType: 'migration_fixture', sourceRef: MARKER, status: 'posted' } });
  entry = entry || await prisma.stockEntry.create({ data: { entryNo: 'MIG-STOCK-001', sourceType: 'migration_fixture', sourceRef: MARKER, direction: 'inbound', status: 'posted', warehouseId: warehouse.id, locationId: location.id, createdBy: user.id } });
  if (!await prisma.stockMovement.findFirst({ where: { entryId: entry.id, productName: PRODUCT, batchNo: BATCH_NO } })) {
    await prisma.stockMovement.create({ data: { entryId: entry.id, stockBalanceId: balance.id, locationId: location.id, materialId: material.id, productName: PRODUCT, batchNo: BATCH_NO, quantityBefore: 0, quantityDelta: 250, quantityAfter: 250 } });
  } else {
    await prisma.stockMovement.updateMany({ where: { entryId: entry.id, productName: PRODUCT, batchNo: BATCH_NO }, data: { materialId: material.id } });
  }
  await prisma.inventoryCostLedger.upsert({
    where: { ledgerNo: 'MIG-LEDGER-001' },
    update: { batchId: batch.id, quantityAfter: 250, costAfter: 12500, createdBy: user.id },
    create: { ledgerNo: 'MIG-LEDGER-001', batchId: batch.id, sourceType: 'migration_fixture', sourceRef: MARKER, quantityBefore: 0, quantityDelta: 250, quantityAfter: 250, costBefore: 0, costAmountDelta: 12500, costAfter: 12500, unitCost: 50, createdBy: user.id },
  });

  let supplier = await prisma.supplier.findFirst({ where: { name: 'Migration Fixture Supplier' } });
  supplier = supplier || await prisma.supplier.create({ data: { name: 'Migration Fixture Supplier', category: 'chemical', contact: 'fixture@local.test', status: 'active' } });
  if (!await prisma.purchaseOrder.findFirst({ where: { supplierId: supplier.id, item: PRODUCT } })) {
    await prisma.purchaseOrder.create({ data: { supplierId: supplier.id, materialId: material.id, item: PRODUCT, quantity: 250, unit: 'kg', price: 40, eta: new Date('2026-12-31T00:00:00.000Z'), status: 'approved', salesOrderId: order.id, salesOrderRef: order.orderNo } });
  } else {
    await prisma.purchaseOrder.updateMany({ where: { supplierId: supplier.id, item: PRODUCT }, data: { materialId: material.id } });
  }
  await prisma.shipment.upsert({
    where: { shipmentNo: 'MIG-SHIP-001' },
    update: { orderId: order.id, orderItemId: orderItem.id, materialId: material.id, productBatchId: batch.id, customerId: customer.id, createdBy: user.id, status: 'shipped' },
    create: { shipmentNo: 'MIG-SHIP-001', orderId: order.id, orderItemId: orderItem.id, materialId: material.id, productBatchId: batch.id, customerId: customer.id, productName: PRODUCT, quantity: 50, unit: 'kg', status: 'shipped', createdBy: user.id, batchNo: BATCH_NO },
  });
}

async function mutate(prisma) {
  const customer = await prisma.customer.findFirst({ where: { licenseNumber: 'MIG-CUSTOMER-001' } });
  if (!customer) throw new Error('Fixture customer is missing before rollback mutation.');
  await prisma.customer.update({ where: { id: customer.id }, data: { name: 'ROLLBACK-MUTATION-MUST-DISAPPEAR' } });
}

async function main() {
  const command = String(process.argv[2] || 'verify-source').toLowerCase();
  const target = command === 'verify-target' ? 'postgres' : 'sqlite';
  const prisma = createPrismaClient(target);
  const startedAt = new Date().toISOString();
  try {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    if (command === 'seed') await seed(prisma);
    if (command === 'mutate') await mutate(prisma);
    const collected = await collectFixture(prisma);

    let expectedFingerprint = null;
    if (command === 'seed') {
      if (collected.missing.length) throw new Error(`Seeded fixture is incomplete: ${collected.missing.join(', ')}`);
      expectedFingerprint = collected.fingerprintSha256;
      fs.writeFileSync(STATE_PATH, `${JSON.stringify({ marker: MARKER, expectedFingerprint, records: collected.records, seededAt: startedAt, runId: process.env.GITHUB_RUN_ID || null }, null, 2)}\n`, 'utf8');
    } else if (command === 'verify-source' || command === 'verify-target') {
      if (!fs.existsSync(STATE_PATH)) throw new Error('Fixture state report is missing. Run seed first.');
      expectedFingerprint = JSON.parse(fs.readFileSync(STATE_PATH, 'utf8')).expectedFingerprint;
      if (collected.missing.length) throw new Error(`Fixture verification is incomplete: ${collected.missing.join(', ')}`);
      if (collected.fingerprintSha256 !== expectedFingerprint) {
        throw new Error(`Fixture fingerprint mismatch: expected ${expectedFingerprint}, received ${collected.fingerprintSha256}`);
      }
    } else if (command === 'mutate') {
      if (!fs.existsSync(STATE_PATH)) throw new Error('Fixture state report is missing. Run seed first.');
      expectedFingerprint = JSON.parse(fs.readFileSync(STATE_PATH, 'utf8')).expectedFingerprint;
      if (collected.fingerprintSha256 === expectedFingerprint) {
        throw new Error('Rollback mutation did not change the source fixture fingerprint.');
      }
    } else {
      throw new Error(`Unsupported command: ${command}`);
    }

    const report = {
      name: 'Cloud PostgreSQL Migration Fixture', version: 1, status: 'passed', command, target,
      marker: MARKER, startedAt, finishedAt: new Date().toISOString(), runId: process.env.GITHUB_RUN_ID || null,
      expectedFingerprint, actualFingerprint: collected.fingerprintSha256, missing: collected.missing,
    };
    fs.writeFileSync(reportPathFor(command), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    console.log(`Cloud PostgreSQL migration fixture ${command}: PASSED`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  fs.writeFileSync(reportPathFor(String(process.argv[2] || 'unknown').toLowerCase()), `${JSON.stringify({ name: 'Cloud PostgreSQL Migration Fixture', version: 1, status: 'failed', command: process.argv[2] || null, error: String(error?.message || error), finishedAt: new Date().toISOString() }, null, 2)}\n`, 'utf8');
  console.error(error);
  process.exit(1);
});
