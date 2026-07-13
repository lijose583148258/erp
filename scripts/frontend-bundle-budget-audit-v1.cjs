const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const root = process.cwd();
const assetsDir = path.join(root, 'dist', 'assets');
const findings = [];

const KiB = 1024;
const budgets = {
  entryJs: { raw: 430 * KiB, gzip: 140 * KiB },
  appCss: { raw: 160 * KiB, gzip: 26 * KiB },
  routeJs: { raw: 150 * KiB, gzip: 48 * KiB },
  sharedJs: { raw: 420 * KiB, gzip: 130 * KiB },
  spreadsheetJs: { raw: 1000 * KiB, gzip: 285 * KiB },
  totalAssets: { raw: 3300 * KiB, gzip: 950 * KiB },
};

function add(severity, file, message) {
  findings.push({ severity, file, message });
}

function fmt(bytes) {
  return `${(bytes / KiB).toFixed(1)} KiB`;
}

function gzipSize(filePath) {
  return zlib.gzipSync(fs.readFileSync(filePath)).length;
}

function assertBudget(file, category, actual, budget) {
  if (actual.raw > budget.raw) {
    add('P1', file, `${category} raw size ${fmt(actual.raw)} exceeds budget ${fmt(budget.raw)}.`);
  }
  if (actual.gzip > budget.gzip) {
    add('P1', file, `${category} gzip size ${fmt(actual.gzip)} exceeds budget ${fmt(budget.gzip)}.`);
  }
}

function classify(name) {
  if (/^index-[\w-]+\.js$/.test(name)) return { category: 'entry JS', budget: budgets.entryJs };
  if (/^index-[\w-]+\.css$/.test(name)) return { category: 'app CSS', budget: budgets.appCss };
  if (/^spreadsheet-[\w-]+\.js$/.test(name)) return { category: 'spreadsheet JS', budget: budgets.spreadsheetJs };
  if (/^(charts|icons|motion|http)-[\w-]+\.js$/.test(name)) return { category: 'shared vendor JS', budget: budgets.sharedJs };
  if (/\.js$/.test(name)) return { category: 'route/module JS', budget: budgets.routeJs };
  return null;
}

if (!fs.existsSync(assetsDir)) {
  add('P1', 'dist/assets', 'Build assets are missing. Run npm run build before bundle budget audit.');
} else {
  const files = fs.readdirSync(assetsDir)
    .filter((name) => /\.(js|css)$/.test(name))
    .sort();

  if (!files.length) {
    add('P1', 'dist/assets', 'No JS/CSS assets found in dist/assets.');
  }

  let totalRaw = 0;
  let totalGzip = 0;
  let entryCount = 0;
  let spreadsheetCount = 0;
  const largest = [];

  for (const name of files) {
    const filePath = path.join(assetsDir, name);
    const raw = fs.statSync(filePath).size;
    const gzip = gzipSize(filePath);
    totalRaw += raw;
    totalGzip += gzip;
    largest.push({ name, raw, gzip });

    if (/^index-[\w-]+\.js$/.test(name)) entryCount += 1;
    if (/^spreadsheet-[\w-]+\.js$/.test(name)) spreadsheetCount += 1;

    const classification = classify(name);
    if (classification) {
      assertBudget(`dist/assets/${name}`, classification.category, { raw, gzip }, classification.budget);
    }
  }

  assertBudget('dist/assets', 'total JS/CSS assets', { raw: totalRaw, gzip: totalGzip }, budgets.totalAssets);

  if (entryCount !== 1) {
    add('P1', 'dist/assets', `Expected exactly one entry index JS chunk, found ${entryCount}.`);
  }
  if (spreadsheetCount !== 1) {
    add('P2', 'dist/assets', `Expected one isolated spreadsheet chunk, found ${spreadsheetCount}.`);
  }

  largest.sort((a, b) => b.raw - a.raw);
  globalThis.__AILAODA_BUNDLE_BUDGET_SUMMARY__ = {
    files: files.length,
    totalRaw,
    totalGzip,
    largest: largest.slice(0, 6),
  };
}

const viteConfig = fs.existsSync(path.join(root, 'vite.config.ts'))
  ? fs.readFileSync(path.join(root, 'vite.config.ts'), 'utf8')
  : '';
for (const token of ['manualChunks', "spreadsheet: ['exceljs']", "charts: ['recharts']", "icons: ['lucide-react']"]) {
  if (!viteConfig.includes(token)) {
    add('P2', 'vite.config.ts', `Vite config should keep the manual chunk boundary token: ${token}`);
  }
}

if (!fs.existsSync(path.join(root, 'docs', 'adr', '0021-frontend-bundle-performance-budget.md'))) {
  add('P2', 'docs/adr/0021-frontend-bundle-performance-budget.md', 'Frontend bundle performance budget ADR is missing.');
}

if (findings.length) {
  console.error('Frontend Bundle Budget Audit: FAIL');
  for (const finding of findings) {
    console.error(`[${finding.severity}] ${finding.file}: ${finding.message}`);
  }
  process.exit(1);
}

const summary = globalThis.__AILAODA_BUNDLE_BUDGET_SUMMARY__;
console.log('Frontend Bundle Budget Audit: PASS');
console.log(`- Checked ${summary.files} JS/CSS assets: raw ${fmt(summary.totalRaw)}, gzip ${fmt(summary.totalGzip)}.`);
console.log('- Entry, route/module, shared vendor, spreadsheet, CSS, and total bundle budgets are within limits.');
console.log('- Largest assets:');
for (const asset of summary.largest) {
  console.log(`  - ${asset.name}: raw ${fmt(asset.raw)}, gzip ${fmt(asset.gzip)}`);
}
