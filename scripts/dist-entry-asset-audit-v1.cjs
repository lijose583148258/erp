const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const DIST_DIR = path.join(ROOT, 'dist');
const ASSET_DIR = path.join(DIST_DIR, 'assets');
const INDEX_HTML = path.join(DIST_DIR, 'index.html');
const OUTPUT_DIR = path.join(ROOT, 'output', 'audit');
const JSON_REPORT = path.join(OUTPUT_DIR, 'dist-entry-asset-audit-v1.json');
const MD_REPORT = path.join(OUTPUT_DIR, 'dist-entry-asset-audit-v1.md');

function toPosix(value) {
  return value.split(path.sep).join('/');
}

function relToDist(fullPath) {
  return toPosix(path.relative(DIST_DIR, fullPath));
}

function listFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  const result = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) result.push(...listFiles(fullPath));
    else if (entry.isFile()) result.push(fullPath);
  }
  return result;
}

function addAssetRef(queue, seen, assetPath, from) {
  const normalized = assetPath
    .replace(/^\/+/, '')
    .replace(/^\.\//, '')
    .replace(/^\.\.\//, '')
    .replace(/^dist\//, '');
  if (!normalized.startsWith('assets/')) return;
  if (seen.has(normalized)) return;
  seen.set(normalized, from);
  queue.push(normalized);
}

function collectRefsFromText(text, currentAsset) {
  const refs = [];
  const patterns = [
    /(?:src|href)=["']([^"']*assets\/[^"']+)["']/g,
    /["'](\.?\/?[^"']+\.(?:js|css|svg|png|jpg|jpeg|webp|gif|woff2?|ttf|ico))["']/g,
    /url\((?:["']?)([^"')]+)(?:["']?)\)/g,
  ];

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(text))) {
      const raw = match[1];
      if (!raw || raw.startsWith('data:') || raw.startsWith('http:') || raw.startsWith('https:')) continue;
      const withoutQuery = raw.split('?')[0].split('#')[0];
      if (withoutQuery.includes('/assets/')) {
        refs.push(withoutQuery.slice(withoutQuery.indexOf('assets/')));
        continue;
      }
      if (currentAsset && withoutQuery.startsWith('./')) {
        refs.push(`assets/${withoutQuery.slice(2)}`);
        continue;
      }
      if (currentAsset && !withoutQuery.includes('/') && /\.[a-z0-9]+$/i.test(withoutQuery)) {
        refs.push(`assets/${withoutQuery}`);
      }
    }
  }

  return refs;
}

function buildReachableAssetSet() {
  const seen = new Map();
  const queue = [];
  const indexText = fs.existsSync(INDEX_HTML) ? fs.readFileSync(INDEX_HTML, 'utf8') : '';
  for (const ref of collectRefsFromText(indexText, null)) {
    addAssetRef(queue, seen, ref, 'index.html');
  }

  while (queue.length > 0) {
    const current = queue.shift();
    const fullPath = path.join(DIST_DIR, current);
    if (!fs.existsSync(fullPath)) continue;
    const ext = path.extname(fullPath).toLowerCase();
    if (ext !== '.js' && ext !== '.css') continue;
    const text = fs.readFileSync(fullPath, 'utf8');
    for (const ref of collectRefsFromText(text, current)) {
      addAssetRef(queue, seen, ref, current);
    }
  }

  return seen;
}

function main() {
  const allAssets = listFiles(ASSET_DIR).map(relToDist).sort();
  const reachable = buildReachableAssetSet();
  const missing = [...reachable.keys()].filter(asset => !fs.existsSync(path.join(DIST_DIR, asset))).sort();
  const stale = allAssets.filter(asset => !reachable.has(asset)).sort();
  const referenced = [...reachable.entries()].map(([asset, from]) => ({ asset, from })).sort((a, b) => a.asset.localeCompare(b.asset));

  const report = {
    meta: {
      generatedAt: new Date().toISOString(),
      purpose: 'Identify dist assets required by the current index.html closure so EXE packaging does not include stale build noise.',
      root: ROOT,
    },
    status: missing.length > 0 || stale.length > 0 ? 'failed' : 'passed',
    summary: {
      allAssets: allAssets.length,
      referencedAssets: referenced.length,
      staleAssets: stale.length,
      missingAssets: missing.length,
    },
    referenced,
    stale,
    missing,
  };

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  fs.writeFileSync(JSON_REPORT, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  const md = [];
  md.push('# Dist Entry Asset Audit v1');
  md.push('');
  md.push(`- status: ${report.status}`);
  md.push(`- generated: ${report.meta.generatedAt}`);
  md.push(`- all assets: ${report.summary.allAssets}`);
  md.push(`- referenced assets: ${report.summary.referencedAssets}`);
  md.push(`- stale assets: ${report.summary.staleAssets}`);
  md.push(`- missing assets: ${report.summary.missingAssets}`);
  md.push('');
  md.push('## Missing Assets');
  if (missing.length === 0) md.push('- none');
  for (const item of missing) md.push(`- ${item}`);
  md.push('');
  md.push('## Stale Assets');
  if (stale.length === 0) md.push('- none');
  for (const item of stale.slice(0, 200)) md.push(`- ${item}`);
  if (stale.length > 200) md.push(`- ... ${stale.length - 200} more`);
  fs.writeFileSync(MD_REPORT, `${md.join('\n')}\n`, 'utf8');

  console.log(JSON.stringify({
    status: report.status,
    summary: report.summary,
    jsonReport: JSON_REPORT,
    markdownReport: MD_REPORT,
  }, null, 2));

  if (missing.length > 0 || stale.length > 0) process.exitCode = 1;
}

main();
