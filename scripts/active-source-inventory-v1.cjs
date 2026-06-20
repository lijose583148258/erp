const fs = require('fs');
const path = require('path');
const {
  GOVERNED_LEGACY_COMPATIBILITY_PATHS,
  OBSOLETE_ACTIVE_PATHS,
  hasQuarantineSegment,
  isActiveSource,
  isIgnoredTopLevel,
  isSourceLike,
  normalizeRel,
  toPosix,
} = require('./lib/active-source-scope.cjs');

const ROOT = process.cwd();
const OUTPUT_DIR = path.join(ROOT, 'output', 'audit');
const JSON_REPORT = path.join(OUTPUT_DIR, 'active-source-inventory-v1.json');
const MD_REPORT = path.join(OUTPUT_DIR, 'active-source-inventory-v1.md');

function rel(fullPath) {
  return toPosix(path.relative(ROOT, fullPath));
}

function walk(dir, bucket) {
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    const relative = rel(full);

    if (entry.isDirectory()) {
      if (isIgnoredTopLevel(relative)) {
        bucket.ignoredDirs.push(normalizeRel(relative));
        continue;
      }
      walk(full, bucket);
      continue;
    }

    if (!entry.isFile() || !isSourceLike(relative)) continue;

    const stat = fs.statSync(full);
    let lines = 0;
    try {
      lines = fs.readFileSync(full, 'utf8').split(/\r\n|\r|\n/).length;
    } catch {
      lines = 0;
    }
    const item = {
      path: normalizeRel(relative),
      bytes: stat.size,
      lines,
      ext: path.extname(entry.name) || entry.name,
      quarantined: hasQuarantineSegment(relative),
      active: isActiveSource(relative),
    };

    if (item.active) bucket.activeFiles.push(item);
    else if (item.quarantined) bucket.quarantinedFiles.push(item);
    else bucket.nonActiveFiles.push(item);
  }
}

function summarizeByExt(files) {
  const summary = {};
  for (const file of files) {
    summary[file.ext] = (summary[file.ext] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(summary).sort(([a], [b]) => a.localeCompare(b)));
}

function readTextIfExists(relativePath) {
  const fullPath = path.join(ROOT, relativePath);
  if (!fs.existsSync(fullPath)) return null;
  return fs.readFileSync(fullPath, 'utf8');
}

function findPackageReferences() {
  const packageJson = readTextIfExists('package.json');
  if (!packageJson) return [];

  const referenced = [];
  for (const obsoletePath of OBSOLETE_ACTIVE_PATHS.keys()) {
    const basename = path.basename(obsoletePath);
    if (packageJson.includes(obsoletePath) || packageJson.includes(basename)) {
      referenced.push({
        path: obsoletePath,
        basename,
        reason: 'package.json still references an obsolete path or basename',
      });
    }
  }
  return referenced;
}

function main() {
  const bucket = {
    activeFiles: [],
    ignoredDirs: [],
    nonActiveFiles: [],
    quarantinedFiles: [],
  };
  walk(ROOT, bucket);

  const obsoleteStillActive = [];
  for (const [obsoletePath, reason] of OBSOLETE_ACTIVE_PATHS.entries()) {
    if (fs.existsSync(path.join(ROOT, obsoletePath))) {
      obsoleteStillActive.push({ path: obsoletePath, reason });
    }
  }

  const packageReferences = findPackageReferences();
  const governedCompatibility = [];
  for (const [compatPath, reason] of GOVERNED_LEGACY_COMPATIBILITY_PATHS.entries()) {
    governedCompatibility.push({
      path: compatPath,
      exists: fs.existsSync(path.join(ROOT, compatPath)),
      reason,
    });
  }

  const report = {
    meta: {
      generatedAt: new Date().toISOString(),
      root: ROOT,
      purpose: 'Separate active source from quarantined legacy files so audits do not misjudge stale scripts.',
    },
    status: obsoleteStillActive.length === 0 && packageReferences.length === 0 ? 'passed' : 'failed',
    summary: {
      activeFiles: bucket.activeFiles.length,
      quarantinedFiles: bucket.quarantinedFiles.length,
      nonActiveFiles: bucket.nonActiveFiles.length,
      ignoredDirs: bucket.ignoredDirs.length,
      activeByExtension: summarizeByExt(bucket.activeFiles),
      quarantinedByExtension: summarizeByExt(bucket.quarantinedFiles),
    },
    obsoleteStillActive,
    packageReferences,
    governedCompatibility,
    largestActiveFiles: [...bucket.activeFiles].sort((a, b) => b.bytes - a.bytes).slice(0, 25),
    largestActiveFilesByLines: [...bucket.activeFiles].sort((a, b) => b.lines - a.lines).slice(0, 25),
    quarantinedFiles: bucket.quarantinedFiles.sort((a, b) => a.path.localeCompare(b.path)),
  };

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  fs.writeFileSync(JSON_REPORT, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  const md = [];
  md.push('# Active Source Inventory v1');
  md.push('');
  md.push(`- status: ${report.status}`);
  md.push(`- generated: ${report.meta.generatedAt}`);
  md.push(`- active files: ${report.summary.activeFiles}`);
  md.push(`- quarantined files: ${report.summary.quarantinedFiles}`);
  md.push(`- obsolete still active: ${obsoleteStillActive.length}`);
  md.push(`- package references to obsolete entries: ${packageReferences.length}`);
  md.push('');
  md.push('## Obsolete Still Active');
  if (obsoleteStillActive.length === 0) md.push('- none');
  for (const item of obsoleteStillActive) md.push(`- ${item.path}: ${item.reason}`);
  md.push('');
  md.push('## Governed Compatibility');
  for (const item of governedCompatibility) {
    md.push(`- ${item.exists ? 'present' : 'missing'} ${item.path}: ${item.reason}`);
  }
  md.push('');
  md.push('## Largest Active Files');
  for (const item of report.largestActiveFiles) {
    md.push(`- ${item.path} (${item.bytes} bytes, ${item.lines} lines)`);
  }
  md.push('');
  md.push('## Largest Active Files By Lines');
  for (const item of report.largestActiveFilesByLines) {
    md.push(`- ${item.path} (${item.lines} lines, ${item.bytes} bytes)`);
  }
  md.push('');
  md.push('## Quarantined Files');
  for (const item of report.quarantinedFiles) md.push(`- ${item.path}`);
  fs.writeFileSync(MD_REPORT, `${md.join('\n')}\n`, 'utf8');

  console.log(JSON.stringify({
    status: report.status,
    summary: report.summary,
    jsonReport: JSON_REPORT,
    markdownReport: MD_REPORT,
  }, null, 2));

  if (report.status !== 'passed') process.exitCode = 1;
}

main();
