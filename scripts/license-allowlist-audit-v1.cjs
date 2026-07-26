const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const root = path.resolve(__dirname, '..');
const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const outputDir = path.join(root, 'artifacts', 'licenses');
const licenseTextDir = path.join(outputDir, 'texts');
fs.mkdirSync(licenseTextDir, { recursive: true });

const allowed = new Set(['MIT', 'Apache-2.0', 'BSD-2-Clause', 'BSD-3-Clause', 'ISC', 'PostgreSQL']);
const manualTokens = ['LGPL', 'MPL', 'EPL', 'GPL', 'AGPL', 'DUAL', 'UNLICENSED'];
const blockedTokens = ['BUSL', 'BSL', 'SSPL', 'COMMONS CLAUSE', 'COMMONS-CLAUSE', 'POLYFORM', 'NON-COMMERCIAL'];
const introduced = new Set(['@revolist/revogrid', 'react-data-grid', 'zod', 'decimal.js']);
const directProduction = new Set(Object.keys(pkg.dependencies || {}));
const directDevelopment = new Set(Object.keys(pkg.devDependencies || {}));

const packageNameFromPath = (packagePath, metadata) => {
  if (metadata?.name) return metadata.name;
  const marker = 'node_modules/';
  const normalized = packagePath.replace(/\\/g, '/');
  const index = normalized.lastIndexOf(marker);
  return index >= 0 ? normalized.slice(index + marker.length) : normalized;
};
const classify = (license) => {
  const normalized = String(license || 'Unknown').trim();
  const upper = normalized.toUpperCase();
  if (!normalized || upper === 'UNKNOWN') return 'blocked';
  if (blockedTokens.some((token) => upper.includes(token))) return 'blocked';
  if (allowed.has(normalized)) return 'allowed';
  if (manualTokens.some((token) => upper.includes(token))) return 'manual-review';
  if (/^\(?\s*(MIT|ISC|BSD-2-CLAUSE|BSD-3-CLAUSE|APACHE-2\.0)(\s+(OR|AND)\s+(MIT|ISC|BSD-2-CLAUSE|BSD-3-CLAUSE|APACHE-2\.0))*\s*\)?$/i.test(normalized)) {
    return 'allowed';
  }
  return 'manual-review';
};

const records = Object.entries(lock.packages || {})
  .filter(([packagePath]) => packagePath.includes('node_modules/'))
  .map(([packagePath, metadata]) => {
    const name = packageNameFromPath(packagePath, metadata);
    const scope = directProduction.has(name) ? 'direct-production'
      : directDevelopment.has(name) ? 'direct-development'
        : metadata.dev ? 'transitive-development' : 'transitive-production';
    return {
      name,
      version: metadata.version || 'unknown',
      license: metadata.license || 'Unknown',
      classification: classify(metadata.license),
      scope,
      optional: Boolean(metadata.optional),
      resolved: metadata.resolved || null,
      integrity: metadata.integrity || null,
      introducedByBomGridPoc: introduced.has(name),
    };
  })
  .sort((left, right) => `${left.name}@${left.version}`.localeCompare(`${right.name}@${right.version}`));

const copyLicense = (record) => {
  const packageDir = path.join(root, 'node_modules', ...record.name.split('/'));
  if (!fs.existsSync(packageDir)) return null;
  const file = fs.readdirSync(packageDir).find((name) => /^licen[cs]e(?:\.|$)/i.test(name));
  if (!file) return null;
  const source = path.join(packageDir, file);
  const safeName = `${record.name.replace(/^@/, '').replace(/[\\/]/g, '__')}@${record.version}.LICENSE.txt`;
  const target = path.join(licenseTextDir, safeName);
  const normalizedLicenseText = `${fs.readFileSync(source, 'utf8')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+$/gm, '')
    .trimEnd()}\n`;
  fs.writeFileSync(target, normalizedLicenseText, 'utf8');
  return path.relative(root, target).replace(/\\/g, '/');
};
records.forEach((record) => {
  record.licenseText = copyLicense(record);
});

let frontendInventory = { generated: false, packages: [], chunks: [] };
const bundledInventoryPath = path.join(root, 'dist', 'frontend-bundle-inventory.json');
if (fs.existsSync(bundledInventoryPath)) {
  frontendInventory = JSON.parse(fs.readFileSync(bundledInventoryPath, 'utf8'));
}
const recordByName = new Map(records.map((record) => [record.name, record]));
frontendInventory.packagesDetailed = (frontendInventory.packages || []).map((name) => {
  const record = recordByName.get(name);
  return record ? {
    name,
    version: record.version,
    license: record.license,
    classification: record.classification,
  } : { name, version: 'unknown', license: 'Unknown', classification: 'blocked' };
});
const bomGridCandidatePackageNames = Array.from(new Set(
  (frontendInventory.chunks || [])
    .filter((chunk) => /BomGridLab|revo-grid|revogr-/i.test(chunk.fileName))
    .flatMap((chunk) => chunk.packages || []),
)).sort();
frontendInventory.bomGridCandidatePackages = bomGridCandidatePackageNames.map((name) => (
  frontendInventory.packagesDetailed.find((record) => record.name === name)
  || { name, version: 'unknown', license: 'Unknown', classification: 'blocked' }
));

const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  policy: {
    allowed: [...allowed],
    manualTokens,
    blockedTokens,
  },
  summary: {
    total: records.length,
    production: records.filter((record) => record.scope.includes('production')).length,
    allowed: records.filter((record) => record.classification === 'allowed').length,
    manualReview: records.filter((record) => record.classification === 'manual-review').length,
    blocked: records.filter((record) => record.classification === 'blocked').length,
  },
  packages: records,
};
fs.writeFileSync(path.join(outputDir, 'production-license-report.json'), `${JSON.stringify(report, null, 2)}\n`);
fs.writeFileSync(path.join(outputDir, 'frontend-bundle-inventory.json'), `${JSON.stringify(frontendInventory, null, 2)}\n`);

const components = records.map((record) => ({
  type: 'library',
  'bom-ref': `pkg:npm/${encodeURIComponent(record.name)}@${record.version}`,
  name: record.name,
  version: record.version,
  licenses: [{ license: { id: record.license } }],
  purl: `pkg:npm/${encodeURIComponent(record.name)}@${record.version}`,
  hashes: record.integrity ? [{ alg: 'SHA-512', content: record.integrity.replace(/^sha512-/, '') }] : undefined,
  properties: [
    { name: 'ailaoda:scope', value: record.scope },
    { name: 'ailaoda:classification', value: record.classification },
  ],
}));
const sbom = {
  bomFormat: 'CycloneDX',
  specVersion: '1.5',
  serialNumber: `urn:uuid:${crypto.randomUUID()}`,
  version: 1,
  metadata: {
    timestamp: new Date().toISOString(),
    component: { type: 'application', name: pkg.name, version: pkg.version },
  },
  components,
};
fs.writeFileSync(path.join(outputDir, 'sbom.cdx.json'), `${JSON.stringify(sbom, null, 2)}\n`);

const notices = [
  '# Generated Third-Party Notices',
  '',
  `Generated: ${report.generatedAt}`,
  '',
  '| Package | Version | License | Scope | Review |',
  '|---|---:|---|---|---|',
  ...records.map((record) => `| ${record.name} | ${record.version} | ${record.license} | ${record.scope} | ${record.classification} |`),
  '',
  '> This inventory is an engineering control. Entries marked manual-review require repository LICENSE, npm package LICENSE, commercial terms, and bundled-code review.',
  '',
].join('\n');
fs.writeFileSync(path.join(outputDir, 'THIRD_PARTY_NOTICES.generated.md'), notices);

const introducedFailures = records.filter((record) => (
  record.introducedByBomGridPoc && record.classification !== 'allowed'
));
const productionBlocked = records.filter((record) => (
  record.scope.includes('production') && record.classification === 'blocked'
));
const bomGridCandidateFailures = frontendInventory.bomGridCandidatePackages.filter((record) => record.classification !== 'allowed');
console.log(JSON.stringify({
  outputDir,
  summary: report.summary,
  introducedFailures,
  productionBlocked,
  bomGridCandidateFailures,
}, null, 2));
const candidateOnly = process.argv.includes('--candidate-only');
if (
  introducedFailures.length
  || bomGridCandidateFailures.length
  || (!candidateOnly && productionBlocked.length)
) process.exitCode = 1;
