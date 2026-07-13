const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const findings = [];

function read(filePath) {
  return fs.readFileSync(path.join(ROOT, filePath), 'utf8').replace(/^\uFEFF/, '');
}

function requireToken(filePath, text, token, level = 'P1') {
  if (!text.includes(token)) {
    findings.push({
      level,
      file: filePath,
      message: `missing required runtime hardening token: ${token}`,
    });
  }
}

function auditDockerfile(filePath) {
  const text = read(filePath);
  requireToken(filePath, text, 'USER node', 'P1');
  requireToken(filePath, text, 'chown -R node:node /app /data', 'P1');
  requireToken(filePath, text, 'VOLUME ["/data"]', 'P1');
  requireToken(filePath, text, 'ENV DATABASE_URL=file:/data/stable.db', 'P1');

  const runtimeSection = text.split(/\nFROM\s+/).pop() || text;
  if (!/USER\s+node\b/.test(runtimeSection)) {
    findings.push({
      level: 'P1',
      file: filePath,
      message: 'runtime stage must drop root privileges with USER node',
    });
  }
}

function auditCompose() {
  const filePath = 'docker-compose.yml';
  const text = read(filePath);
  [
    'no-new-privileges:true',
    'cap_drop:',
    '- ALL',
    'read_only: true',
    'tmpfs:',
    '- /tmp',
    'ailao-data:/data',
  ].forEach(token => requireToken(filePath, text, token, 'P1'));
}

auditDockerfile('Dockerfile');
auditDockerfile('backend/Dockerfile');
auditCompose();

const report = {
  name: 'Docker Runtime Hardening Audit',
  version: '1.0',
  status: findings.some(item => item.level === 'P0' || item.level === 'P1') ? 'failed' : 'passed',
  findings,
  generatedAt: new Date().toISOString(),
};

console.log(JSON.stringify(report, null, 2));
if (report.status !== 'passed') process.exit(1);
