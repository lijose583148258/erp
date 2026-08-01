const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const root = path.resolve(__dirname, '..');
const rootLock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
const backendLock = JSON.parse(fs.readFileSync(path.join(root, 'backend', 'package-lock.json'), 'utf8'));
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const backendPkg = JSON.parse(fs.readFileSync(path.join(root, 'backend', 'package.json'), 'utf8'));
const outputDir = path.join(root, 'artifacts', 'licenses');
const licenseTextDir = path.join(outputDir, 'texts');
fs.mkdirSync(licenseTextDir, { recursive: true });

const allowed = new Set(['MIT', 'Apache-2.0', 'BSD-2-Clause', 'BSD-3-Clause', 'ISC', 'PostgreSQL']);
const manualTokens = ['LGPL', 'MPL', 'EPL', 'GPL', 'AGPL', 'DUAL', 'UNLICENSED'];
const blockedTokens = ['BUSL', 'BSL', 'SSPL', 'COMMONS CLAUSE', 'COMMONS-CLAUSE', 'POLYFORM', 'NON-COMMERCIAL'];
const introduced = new Set(['@revolist/revogrid', 'react-data-grid', 'zod', 'decimal.js']);
const directProduction = new Set([
  ...Object.keys(pkg.dependencies || {}),
  ...Object.keys(backendPkg.dependencies || {}),
]);
const directDevelopment = new Set([
  ...Object.keys(pkg.devDependencies || {}),
  ...Object.keys(backendPkg.devDependencies || {}),
]);

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

const scopePriority = {
  'direct-production': 4,
  'transitive-production': 3,
  'direct-development': 2,
  'transitive-development': 1,
};
const collectRecords = (lock, tree, installRoot) => Object.entries(lock.packages || {})
  .filter(([packagePath, metadata]) => (
    packagePath
    && !metadata.link
    && (
      packagePath.includes('node_modules/')
      || (metadata.name && fs.existsSync(path.join(installRoot, packagePath)))
    )
  ))
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
      sourceTrees: [tree],
      installPaths: [path.join(installRoot, packagePath)],
    };
  });
const mergedRecords = new Map();
for (const record of [
  ...collectRecords(rootLock, 'frontend-root', root),
  ...collectRecords(backendLock, 'backend', path.join(root, 'backend')),
]) {
  const key = `${record.name}@${record.version}`;
  const existing = mergedRecords.get(key);
  if (!existing) {
    mergedRecords.set(key, record);
    continue;
  }
  existing.sourceTrees = Array.from(new Set([...existing.sourceTrees, ...record.sourceTrees])).sort();
  existing.installPaths = Array.from(new Set([...existing.installPaths, ...record.installPaths]));
  existing.optional = existing.optional && record.optional;
  existing.introducedByBomGridPoc ||= record.introducedByBomGridPoc;
  if (scopePriority[record.scope] > scopePriority[existing.scope]) existing.scope = record.scope;
}
const records = Array.from(mergedRecords.values())
  .sort((left, right) => `${left.name}@${left.version}`.localeCompare(`${right.name}@${right.version}`));

const copyLicense = (record) => {
  const packageDir = record.installPaths.find((candidate) => fs.existsSync(candidate));
  if (!packageDir) return null;
  const licenseFile = fs.readdirSync(packageDir).find((name) => /^licen[cs]e(?:\.|$)/i.test(name));
  if (!licenseFile) return null;
  const source = path.join(packageDir, licenseFile);
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
  delete record.installPaths;
  record.licenseSource = 'package-manifest';
  if (record.classification === 'blocked' && record.license === 'Unknown' && record.licenseText) {
    const licenseText = fs.readFileSync(path.join(root, record.licenseText), 'utf8');
    const isMitText = (
      licenseText.includes('Permission is hereby granted, free of charge, to any person obtaining a copy')
      && licenseText.includes('THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND')
    );
    if (isMitText) {
      record.declaredLicense = record.license;
      record.license = 'MIT';
      record.classification = 'allowed';
      record.licenseSource = 'package-license-text';
    }
  }
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
