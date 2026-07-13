const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const findings = [];

function read(filePath) {
  return fs.readFileSync(path.join(ROOT, filePath), 'utf8').replace(/^\uFEFF/, '');
}

function add(level, file, message) {
  findings.push({ level, file, message });
}

function walkSourceFiles(relativeDir) {
  const absoluteDir = path.join(ROOT, relativeDir);
  if (!fs.existsSync(absoluteDir)) return [];
  return fs.readdirSync(absoluteDir, { withFileTypes: true }).flatMap((entry) => {
    const relativePath = path.join(relativeDir, entry.name);
    if (entry.isDirectory()) return walkSourceFiles(relativePath);
    return /\.(?:tsx|jsx)$/.test(entry.name) ? [relativePath.replace(/\\/g, '/')] : [];
  });
}

const indexHtml = read('index.html');
if (/<script(?![^>]*\bsrc=)[^>]*>[\s\S]*?<\/script>/i.test(indexHtml)) {
  add('P1', 'index.html', 'index.html contains inline script; CSP cannot safely drop unsafe-inline.');
}
if (/<style[\s\S]*?>[\s\S]*?<\/style>/i.test(indexHtml)) {
  add('P1', 'index.html', 'index.html contains inline style block; CSP cannot safely drop unsafe-inline for styles.');
}
if (/\sstyle=/.test(indexHtml)) {
  add('P1', 'index.html', 'index.html contains inline style attributes.');
}
if (!indexHtml.includes('href="/app-shell.css"')) {
  add('P1', 'index.html', 'app shell stylesheet is not loaded as an external same-origin asset.');
}
if (!indexHtml.includes('src="/app-shell.js"')) {
  add('P1', 'index.html', 'app shell script is not loaded as an external same-origin asset.');
}

for (const file of ['app', 'components', 'pages'].flatMap(walkSourceFiles)) {
  if (/<style(?:\s|>)/i.test(read(file))) {
    add('P1', file, 'Runtime JSX must not inject a style element under the strict style-src-elem policy.');
  }
}
const clickSpark = read('components/app/ClickSpark.tsx');
if (!clickSpark.includes('click-spark-particle') || !read('index.css').includes('@keyframes spark-jelly')) {
  add('P1', 'components/app/ClickSpark.tsx', 'Click spark keyframes must live in the external same-origin stylesheet.');
}

const server = read('backend/src/server.ts');
const openApiDocument = read('backend/src/openapi/openapiDocument.ts');
if (!server.includes('AILAODA_ALLOW_UNSAFE_INLINE_CSP')) {
  add('P1', 'backend/src/server.ts', 'CSP unsafe-inline escape hatch must be explicit and auditable.');
}
if (!server.includes('const cspScriptSources = allowUnsafeInlineCsp ? ["\'self\'", "\'unsafe-inline\'"] : ["\'self\'"];')) {
  add('P1', 'backend/src/server.ts', 'script-src must default to self without unsafe-inline.');
}
if (!server.includes('const cspStyleSources = allowUnsafeInlineCsp ? ["\'self\'", "\'unsafe-inline\'"] : ["\'self\'"];')) {
  add('P1', 'backend/src/server.ts', 'style-src must default to self without unsafe-inline.');
}
if (!server.includes('const cspStyleAttributeSources = ["\'unsafe-inline\'"];')) {
  add('P1', 'backend/src/server.ts', 'React dynamic style attributes must have an explicit CSP3 style-src-attr boundary.');
}
if (!server.includes('styleSrcElem: cspStyleSources') || !server.includes('styleSrcAttr: cspStyleAttributeSources')) {
  add('P1', 'backend/src/server.ts', 'CSP must keep style elements strict while isolating the React style-attribute compatibility policy.');
}
const cspTest = read('backend/src/security/cspHeaders.test.ts');
for (const token of ["directives['script-src']", "directives['style-src-elem']", "directives['style-src-attr']", "[\"'unsafe-inline'\"]"]) {
  if (!cspTest.includes(token)) add('P1', 'backend/src/security/cspHeaders.test.ts', `CSP header test is missing directive assertion: ${token}`);
}
if (/<style[\s\S]*?>/.test(openApiDocument) || /style=/.test(openApiDocument)) {
  add('P1', 'backend/src/openapi/openapiDocument.ts', 'OpenAPI docs HTML must not rely on inline styles under strict CSP.');
}

const report = {
  name: 'CSP Hardening Audit',
  version: '1.0',
  status: findings.some(item => item.level === 'P0' || item.level === 'P1') ? 'failed' : 'passed',
  findings,
  generatedAt: new Date().toISOString(),
};

console.log(JSON.stringify(report, null, 2));
if (report.status !== 'passed') process.exit(1);
