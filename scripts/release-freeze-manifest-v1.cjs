const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const ROOT = process.cwd();
const OUTPUT_DIR = path.join(ROOT, 'output', 'audit');
const DEFAULT_RUNTIME = 'E:\\爱劳达纯净系统';
const RUNTIME_DIR = process.env.AILAODA_RELEASE_RUNTIME || DEFAULT_RUNTIME;
const JSON_REPORT = path.join(OUTPUT_DIR, 'release-freeze-manifest-v1.json');
const MD_REPORT = path.join(OUTPUT_DIR, 'release-freeze-manifest-v1.md');

function findLatestReleaseZip() {
  if (process.env.AILAODA_RELEASE_ZIP) return process.env.AILAODA_RELEASE_ZIP;
  const prefix = `${path.basename(DEFAULT_RUNTIME)}_`;
  const searchDirs = [
    path.join(ROOT, 'output', 'packages'),
    path.parse(DEFAULT_RUNTIME).root,
  ];

  const candidates = [];
  for (const dir of searchDirs) {
    if (!fs.existsSync(dir)) continue;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.startsWith(prefix) || !entry.name.endsWith('.zip')) continue;
      candidates.push(path.join(dir, entry.name));
    }
  }

  candidates.sort((left, right) => fs.statSync(right).mtimeMs - fs.statSync(left).mtimeMs);
  return candidates[0] || path.join(searchDirs[0], `${prefix}missing.zip`);
}

const ZIP_PATH = findLatestReleaseZip();

function posix(relativePath) {
  return relativePath.split(path.sep).join('/');
}

function rel(filePath) {
  if (!filePath) return '';
  const relativePath = path.relative(ROOT, filePath);
  return relativePath.startsWith('..') ? filePath : posix(relativePath);
}

function fileFingerprint(filePath) {
  if (!fs.existsSync(filePath)) return { path: filePath, exists: false };
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  const stat = fs.statSync(filePath);
  return {
    path: filePath,
    exists: true,
    bytes: stat.size,
    lastWriteTime: stat.mtime.toISOString(),
    sha256: hash.digest('hex').toUpperCase(),
  };
}

function runGit(args) {
  try {
    return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();
  } catch {
    return '';
  }
}

function getGitStatus() {
  const lines = runGit(['status', '--short']).split(/\r?\n/).filter(Boolean);
  const counts = { total: lines.length, modified: 0, untracked: 0, deleted: 0, other: 0 };
  for (const line of lines) {
    if (line.startsWith('??')) counts.untracked += 1;
    else if (line.includes('D')) counts.deleted += 1;
    else if (line.includes('M')) counts.modified += 1;
    else counts.other += 1;
  }
  return {
    branch: runGit(['branch', '--show-current']) || null,
    head: runGit(['rev-parse', '--short', 'HEAD']) || null,
    fullHead: runGit(['rev-parse', 'HEAD']) || null,
    counts,
    sample: lines.slice(0, 80),
  };
}

function readJson(filePath) {
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, ''));
  } catch (error) {
    return { parseError: String(error.message || error) };
  }
}

function findEntryExe(runtimeDir, runtimeManifest) {
  const manifestExe = runtimeManifest?.entryExe;
  if (typeof manifestExe === 'string' && fs.existsSync(manifestExe)) return manifestExe;
  if (!fs.existsSync(runtimeDir)) return null;
  return fs.readdirSync(runtimeDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.exe'))
    .map((entry) => path.join(runtimeDir, entry.name))[0] || null;
}

function requiredRuntimeFiles(runtimeDir, entryExe) {
  const required = [
    'dist/index.html',
    'backend/dist/server.js',
    '.env.production',
    'PURE_RUNTIME_PACKAGE.json',
    'SOURCE_MANIFEST.json',
  ].map((item) => {
    const fullPath = path.join(runtimeDir, item);
    return { path: fullPath, relativePath: item, exists: fs.existsSync(fullPath) };
  });
  required.unshift({
    path: entryExe || path.join(runtimeDir, '*.exe'),
    relativePath: entryExe ? path.basename(entryExe) : 'root *.exe',
    exists: Boolean(entryExe),
  });
  return required;
}

function writeReports(report) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  fs.writeFileSync(JSON_REPORT, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  const lines = [
    '# 发布冻结 Manifest v1',
    '',
    `- generatedAt: ${report.generatedAt}`,
    `- status: ${report.status}`,
    `- releaseZip: ${report.releaseZip.path}`,
    `- zipSha256: ${report.releaseZip.sha256 || 'missing'}`,
    `- runtimeDir: ${report.runtimeDir}`,
    `- gitBranch: ${report.git.branch || 'unknown'}`,
    `- gitHead: ${report.git.head || 'unknown'}`,
    `- gitDirtyTotal: ${report.git.counts.total}`,
    '',
    '## 判定',
    '',
    report.status === 'frozen'
      ? '- 可以作为冻结包进入下一轮迁移/服务器测试。'
      : '- 不能作为最终商业发布冻结包；必须先处理下方阻断项。',
    '',
    '## 阻断项',
  ];

  if (report.blockers.length === 0) lines.push('- none');
  for (const item of report.blockers) lines.push(`- ${item}`);

  lines.push('', '## 运行目录必要文件');
  for (const item of report.runtimeFiles) {
    lines.push(`- ${item.exists ? 'ok' : 'missing'}: ${item.relativePath}`);
  }

  if (report.git.sample.length > 0) {
    lines.push('', '## Git 变更样本');
    for (const item of report.git.sample) lines.push(`- ${item}`);
  }

  fs.writeFileSync(MD_REPORT, `${lines.join('\n')}\n`, 'utf8');
}

function main() {
  const releaseZip = fileFingerprint(ZIP_PATH);
  const runtimeManifestPath = path.join(RUNTIME_DIR, 'PURE_RUNTIME_PACKAGE.json');
  const runtimeManifest = readJson(runtimeManifestPath);
  const sourceManifestPath = path.join(RUNTIME_DIR, 'SOURCE_MANIFEST.json');
  const sourceManifest = readJson(sourceManifestPath);
  const entryExe = findEntryExe(RUNTIME_DIR, runtimeManifest);
  const runtimeFiles = requiredRuntimeFiles(RUNTIME_DIR, entryExe);
  const git = getGitStatus();

  const blockers = [];
  if (!releaseZip.exists) blockers.push(`release zip missing: ${ZIP_PATH}`);
  for (const item of runtimeFiles) {
    if (!item.exists) blockers.push(`runtime file missing: ${item.relativePath}`);
  }
  if (runtimeManifest?.parseError) blockers.push(`runtime manifest parse error: ${runtimeManifest.parseError}`);
  if (sourceManifest?.parseError) blockers.push(`source manifest parse error: ${sourceManifest.parseError}`);
  if (git.counts.total > 0) blockers.push(`source workspace is not frozen: ${git.counts.total} git status entries`);
  if (!sourceManifest) blockers.push('source manifest missing');
  if (sourceManifest && sourceManifest.sourceDirtyCount !== 0) {
    blockers.push(`stable package was built from a dirty workspace: ${sourceManifest.sourceDirtyCount}`);
  }
  if (sourceManifest?.sourceCommit && git.fullHead && sourceManifest.sourceCommit !== git.fullHead) {
    blockers.push(`runtime source commit ${sourceManifest.sourceCommit} does not match current source ${git.fullHead}`);
  }
  const runtimeFrontend = fileFingerprint(path.join(RUNTIME_DIR, 'dist', 'index.html'));
  const runtimeBackend = fileFingerprint(path.join(RUNTIME_DIR, 'backend', 'dist', 'server.js'));
  if (sourceManifest?.frontendIndex?.sha256 && runtimeFrontend.sha256 !== sourceManifest.frontendIndex.sha256) {
    blockers.push('runtime frontend hash does not match SOURCE_MANIFEST.json');
  }
  if (sourceManifest?.backendEntry?.sha256 && runtimeBackend.sha256 !== sourceManifest.backendEntry.sha256) {
    blockers.push('runtime backend hash does not match SOURCE_MANIFEST.json');
  }
  const sourceManifestFingerprint = fileFingerprint(sourceManifestPath);
  if (releaseZip.exists && sourceManifestFingerprint.exists && releaseZip.lastWriteTime < sourceManifestFingerprint.lastWriteTime) {
    blockers.push('release zip is older than runtime SOURCE_MANIFEST.json');
  }

  const report = {
    name: 'Release Freeze Manifest',
    version: 1,
    generatedAt: new Date().toISOString(),
    status: blockers.length === 0 ? 'frozen' : 'blocked',
    releaseZip,
    runtimeDir: RUNTIME_DIR,
    runtimeFiles,
    runtimeManifestSummary: runtimeManifest ? {
      generatedAt: runtimeManifest.generatedAt || null,
      packageRoot: runtimeManifest.packageRoot || runtimeManifest.targetRoot || null,
      sourceRoot: runtimeManifest.sourceRoot || null,
    } : null,
    sourceManifestSummary: sourceManifest ? {
      generatedAt: sourceManifest.generatedAt || null,
      sourceCommit: sourceManifest.sourceCommit || null,
      sourceBranch: sourceManifest.sourceBranch || null,
      sourceDirtyCount: sourceManifest.sourceDirtyCount ?? null,
      frontendIndexSha256: sourceManifest.frontendIndex?.sha256 || null,
      backendEntrySha256: sourceManifest.backendEntry?.sha256 || null,
    } : null,
    runtimeArtifactFingerprints: {
      frontendIndex: runtimeFrontend,
      backendEntry: runtimeBackend,
    },
    git,
    blockers,
    outputs: {
      json: rel(JSON_REPORT),
      markdown: rel(MD_REPORT),
    },
  };

  writeReports(report);
  console.log(JSON.stringify({
    status: report.status,
    blockers: report.blockers,
    releaseZip: report.releaseZip.exists ? {
      bytes: report.releaseZip.bytes,
      sha256: report.releaseZip.sha256,
    } : null,
    outputs: report.outputs,
  }, null, 2));

  if (report.status !== 'frozen') process.exitCode = 1;
}

main();
