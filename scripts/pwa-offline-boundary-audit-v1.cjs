const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const findings = [];

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8').replace(/^\uFEFF/, '');
}

function exists(relativePath) {
  return fs.existsSync(path.join(ROOT, relativePath));
}

function add(severity, file, message) {
  findings.push({ severity, file, message });
}

function requireIncludes(file, text, severity, message) {
  const content = read(file);
  if (!content.includes(text)) add(severity, file, message);
  return content;
}

for (const file of ['public/manifest.json', 'public/app-pwa.js', 'public/sw.js', 'public/offline.html']) {
  if (!exists(file)) add('P1', file, 'Required PWA boundary file is missing.');
}

const indexHtml = read('index.html');
if (!indexHtml.includes('rel="manifest" href="/manifest.json"')) {
  add('P1', 'index.html', 'App manifest is not linked from the HTML shell.');
}
if (!indexHtml.includes('src="/app-pwa.js"')) {
  add('P1', 'index.html', 'PWA registration script is not loaded from the HTML shell.');
}

if (exists('public/app-pwa.js')) {
  const registration = requireIncludes(
    'public/app-pwa.js',
    "navigator.serviceWorker.register('/sw.js'",
    'P1',
    'PWA script must register /sw.js explicitly.',
  );
  if (!registration.includes('window.isSecureContext')) {
    add('P2', 'public/app-pwa.js', 'PWA registration should guard non-secure contexts.');
  }
}

if (exists('public/sw.js')) {
  const sw = read('public/sw.js');
  for (const token of ["'/api'", "'/uploads'", "'/metrics'", "'/health'", "'/ready'"]) {
    if (!sw.includes(token)) add('P1', 'public/sw.js', `Service worker must keep ${token} network-only.`);
  }
  for (const token of ["request.method !== 'GET'", 'request.mode === \'navigate\'', "'/offline.html'", 'cache.addAll(APP_SHELL_ASSETS)']) {
    if (!sw.includes(token)) add('P1', 'public/sw.js', `Service worker is missing required offline boundary token: ${token}`);
  }
}

const server = read('backend/src/server.ts');
if (server.includes("send('service worker is disabled')")) {
  add('P1', 'backend/src/server.ts', 'Backend still disables /sw.js.');
}
if (!server.includes("app.get('/sw.js'") || !server.includes("'Cache-Control', 'no-cache'")) {
  add('P1', 'backend/src/server.ts', 'Backend must serve /sw.js with no-cache semantics when frontend dist exists.');
}

const adr = 'docs/adr/0009-pwa-offline-shell-boundary.md';
if (!exists(adr)) {
  add('P2', adr, 'PWA offline boundary ADR is missing.');
} else {
  const content = read(adr);
  for (const token of ['## Status', '## Context', '## Decision', '## Consequences', 'Never cache `/api`']) {
    if (!content.includes(token)) add('P2', adr, `ADR is missing token: ${token}`);
  }
}

if (findings.length) {
  console.error('PWA Offline Boundary Audit: FAIL');
  for (const finding of findings) {
    console.error(`[${finding.severity}] ${finding.file}: ${finding.message}`);
  }
  process.exit(1);
}

console.log('PWA Offline Boundary Audit: PASS');
console.log('- Manifest, registration script, service worker, and offline page are present.');
console.log('- Service worker excludes API, upload, metrics, health, and readiness endpoints from caching.');
console.log('- Backend serves /sw.js from frontend dist with no-cache semantics.');
