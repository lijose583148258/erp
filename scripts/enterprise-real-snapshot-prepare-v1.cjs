const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const root = process.cwd();
const outDir = path.join(root, 'output', 'audit');
const snapshotFile = path.resolve(process.env.ENTERPRISE_REAL_SNAPSHOT_FILE || '');
const manifestFile = path.resolve(process.env.ENTERPRISE_REAL_MANIFEST_FILE || '');
const expectedHash = String(process.env.ENTERPRISE_REAL_SNAPSHOT_SHA256 || '').trim().toLowerCase();
const expectedRows = Number(process.env.ENTERPRISE_TARGET_ROWS || 170911);
const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const sha256 = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const write = (name, value) => fs.writeFileSync(path.join(outDir, name), `${JSON.stringify(value, null, 2)}\n`, 'utf8');
const fail = (message) => { throw new Error(message); };

function main() {
  if (!snapshotFile || !fs.existsSync(snapshotFile)) fail('ENTERPRISE_REAL_SNAPSHOT_FILE must reference a readable snapshot JSON.');
  if (!manifestFile || !fs.existsSync(manifestFile)) fail('ENTERPRISE_REAL_MANIFEST_FILE must reference a readable manifest JSON.');
  if (!/^[a-f0-9]{64}$/.test(expectedHash)) fail('ENTERPRISE_REAL_SNAPSHOT_SHA256 must be a SHA-256 hex digest.');
  const actualHash = sha256(snapshotFile);
  if (actualHash !== expectedHash) fail(`Snapshot checksum mismatch: expected ${expectedHash}, got ${actualHash}.`);
  const snapshot = readJson(snapshotFile);
  const manifest = readJson(manifestFile);
  if (!Array.isArray(snapshot.tables) || snapshot.tables.length === 0) fail('Snapshot has no tables.');
  const names = new Set();
  let totalRows = 0;
  const tableSummary = snapshot.tables.map((table) => {
    const name = String(table?.name || '');
    if (!/^[A-Za-z0-9_]+$/.test(name) || names.has(name)) fail(`Invalid or duplicate snapshot table: ${name}.`);
    names.add(name);
    const rows = Array.isArray(table.rows) ? table.rows : [];
    const rowCount = Number(table.rowCount);
    if (!Number.isInteger(rowCount) || rowCount < 0 || rows.length !== rowCount) fail(`Snapshot row count mismatch for ${name}.`);
    totalRows += rowCount;
    return { name, rowCount };
  });
  if (totalRows !== expectedRows) fail(`Snapshot total rows mismatch: expected ${expectedRows}, got ${totalRows}.`);
  if (manifest?.snapshot?.checksumSha256 !== actualHash) fail('Manifest checksum does not bind to the downloaded snapshot.');
  const manifestTables = [
    ...(manifest.phases || []).flatMap((phase) => phase.tables || []),
    ...(manifest.deferredTables || []),
  ];
  const manifestByName = new Map();
  for (const table of manifestTables) {
    const name = String(table?.name || '');
    if (!names.has(name) || manifestByName.has(name)) fail(`Manifest table coverage is invalid for ${name}.`);
    manifestByName.set(name, Number(table.rowCount));
  }
  if (manifestByName.size !== names.size) fail('Manifest does not cover every snapshot table exactly once.');
  for (const table of tableSummary) {
    if (manifestByName.get(table.name) !== table.rowCount) fail(`Manifest row count mismatch for ${table.name}.`);
  }
  fs.mkdirSync(outDir, { recursive: true });
  const criticalNames = ['users', 'customers', 'orders', 'order_items', 'payment_records', 'product_batches', 'inventory_cost_ledgers', 'stock_balances', 'stock_entries', 'stock_movements', 'purchase_orders', 'shipments'];
  const snapshotReport = {
    name: 'PostgreSQL Migration Snapshot', version: 1, status: 'passed', evidenceClass: 'real-snapshot',
    generatedAt: new Date().toISOString(), snapshotFileName: path.basename(snapshotFile), snapshotPath: snapshotFile,
    checksumSha256: actualHash, tableCount: tableSummary.length, totalRowCount: totalRows,
    source: snapshot.source || null, criticalTables: criticalNames.map((name) => ({ name, present: names.has(name), rowCount: tableSummary.find((table) => table.name === name)?.rowCount ?? null })), tableSummary,
  };
  const localManifest = { ...manifest, generatedAt: new Date().toISOString(), evidenceClass: 'real-snapshot', snapshot: { ...manifest.snapshot, fileName: path.basename(snapshotFile), path: snapshotFile, checksumSha256: actualHash, tableCount: tableSummary.length, totalRowCount: totalRows } };
  write('postgres-migration-snapshot-v1.json', snapshotReport);
  write('postgres-migration-import-manifest-v1.json', localManifest);
  write('enterprise-real-snapshot-preparation-v1.json', { name: 'Enterprise real snapshot preparation', version: 1, status: 'passed', snapshotFile, manifestFile, checksumSha256: actualHash, tableCount: tableSummary.length, totalRows, generatedAt: new Date().toISOString() });
}
try { main(); } catch (error) { fs.mkdirSync(outDir, { recursive: true }); write('enterprise-real-snapshot-preparation-v1.json', { name: 'Enterprise real snapshot preparation', version: 1, status: 'failed', error: error instanceof Error ? error.message : String(error), generatedAt: new Date().toISOString() }); console.error(error); process.exitCode = 1; }
