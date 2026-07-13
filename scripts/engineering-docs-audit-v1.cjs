const fs = require('fs');
const path = require('path');

const root = process.cwd();
const findings = [];
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');
const exists = (relativePath) => fs.existsSync(path.join(root, relativePath));
const add = (severity, file, message) => findings.push({ severity, file, message });
const requireIncludes = (file, text, severity, message) => {
  const content = read(file);
  if (!content.includes(text)) add(severity, file, message);
  return content;
};

if (!exists('CONTRIBUTING.md')) add('P1', 'CONTRIBUTING.md', 'Contributor workflow document is missing.');
if (!exists('CHANGELOG.md')) add('P1', 'CHANGELOG.md', 'Changelog is missing.');

if (exists('CONTRIBUTING.md')) {
  const contributing = read('CONTRIBUTING.md');
  for (const token of ['Development Flow', 'Common Validation Commands', 'Backend Expectations', 'Security Expectations', 'docs/adr/']) {
    if (!contributing.includes(token)) add('P2', 'CONTRIBUTING.md', `Missing contribution guidance token: ${token}`);
  }
}

if (exists('CHANGELOG.md')) {
  const changelog = read('CHANGELOG.md');
  for (const token of ['## Unreleased', '### Added', '### Changed', '### Security', '### Still Pending']) {
    if (!changelog.includes(token)) add('P2', 'CHANGELOG.md', `Missing changelog section: ${token}`);
  }
}

const adrDir = path.join(root, 'docs', 'adr');
if (!fs.existsSync(adrDir)) {
  add('P1', 'docs/adr', 'ADR directory is missing.');
} else {
  const adrFiles = fs.readdirSync(adrDir).filter(name => /^\d{4}-.+\.md$/.test(name)).sort();
  if (adrFiles.length < 19) add('P2', 'docs/adr', 'Expected at least nineteen current architecture decision records.');
  for (const name of adrFiles) {
    const relativePath = `docs/adr/${name}`;
    const content = read(relativePath);
    if (!content.includes('## Status')) add('P2', relativePath, 'ADR is missing Status section.');
    if (!content.includes('## Context')) add('P2', relativePath, 'ADR is missing Context section.');
    if (!content.includes('## Decision')) add('P2', relativePath, 'ADR is missing Decision section.');
    if (!content.includes('## Consequences')) add('P2', relativePath, 'ADR is missing Consequences section.');
  }
}

const commercialAudit = requireIncludes(
  'scripts/commercial-erp-crm-ui-ux-audit-v1.cjs',
  'CONTRIBUTING.md and CHANGELOG.md exist',
  'P2',
  'Commercial audit should not keep stale missing-doc evidence.'
);
if (!commercialAudit.includes('docs/adr/ now records')) {
  add('P2', 'scripts/commercial-erp-crm-ui-ux-audit-v1.cjs', 'Commercial audit should mention current ADR coverage.');
}

if (findings.length) {
  console.error('Engineering Docs Audit: FAIL');
  for (const finding of findings) {
    console.error(`[${finding.severity}] ${finding.file}: ${finding.message}`);
  }
  process.exit(1);
}

console.log('Engineering Docs Audit: PASS');
console.log('- CONTRIBUTING.md exists with validation and security guidance.');
console.log('- CHANGELOG.md exists with current production-readiness changes.');
console.log('- ADR directory has current decision records with required sections.');
