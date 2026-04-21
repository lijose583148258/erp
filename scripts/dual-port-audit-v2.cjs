const http = require('http');
const fs = require('fs');
const path = require('path');

const BACKEND = 'http://127.0.0.1:5001';
const FRONTEND = 'http://localhost:3000';
const REQUIRE_FRONTEND_PORT = process.env.REQUIRE_FRONTEND_PORT === 'true';

const API_ENDPOINTS = [
  { method: 'POST', path: '/api/auth/login', body: JSON.stringify({ username: 'admin', password: 'admin123' }) },
  { method: 'GET', path: '/api/dashboard' },
  { method: 'GET', path: '/api/dashboard/trends' },
  { method: 'GET', path: '/api/customers' },
  { method: 'GET', path: '/api/orders' },
  { method: 'GET', path: '/api/team' },
  { method: 'GET', path: '/api/samples' },
  { method: 'GET', path: '/api/shipping' },
  { method: 'GET', path: '/api/rma' },
  { method: 'GET', path: '/api/contracts' },
  { method: 'GET', path: '/api/adjustments' },
  { method: 'GET', path: '/api/finance/summary' },
  { method: 'GET', path: '/api/finance/workspace' },
  { method: 'GET', path: '/api/assets/balance' },
  { method: 'GET', path: '/api/assets/history' },
  { method: 'GET', path: '/api/procurement/suppliers' },
  { method: 'GET', path: '/api/procurement/orders' },
  { method: 'GET', path: '/api/production/summary' },
  { method: 'GET', path: '/api/collections/summary' },
  { method: 'GET', path: '/api/barter/summary' },
  { method: 'GET', path: '/api/barter/settlements' },
];

const MOJIBAKE_TOKENS = [
  '\u951f\u65a4\u62f7',
  '\u00ef\u00bf\u00bd',
  '\u00c3',
  '\u00c2',
  '\u00e2\u20ac',
  '\u7039\u3221\u57db',
  '\u7487\u950b',
  '\u93b4\u621c',
  '\u9416\u535e',
  '\u6748\u6350',
  '\u7eef\u8364',
  '\u935a\u5ea3',
  '\u6d60\uff47',
  '\u59af\u2033',
  '\u6d93\u8364',
  '\u95c2\u3127',
  '\u5bee\u66df',
  '\u9365\u70b4',
  '\u59f9\u7218',
  '\u93cc\u30e7',
  '\u9359\u6226',
  '\u68f0\u6fc6',
  '\u7ecb\u5b2a',
  '\u93c1\u7248',
];

function looksMojibake(value) {
  return value.includes('\uFFFD') || MOJIBAKE_TOKENS.some(token => value.includes(token));
}

function request(base, endpoint, token) {
  return new Promise((resolve) => {
    const url = new URL(endpoint.path, base);
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      method: endpoint.method,
      headers: { 'Content-Type': 'application/json' },
      timeout: 8000,
    };

    if (token) options.headers.Authorization = `Bearer ${token}`;

    const req = http.request(options, (res) => {
      const chunks = [];
      res.on('data', (chunk) => {
        chunks.push(Buffer.from(chunk));
      });
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        let parsed = null;
        let hasChinese = false;
        let chineseSample = '';
        let encodingClean = true;

        try {
          parsed = JSON.parse(body);
          const str = JSON.stringify(parsed);
          const chineseMatch = str.match(/[\u4e00-\u9fff]+/g);
          if (chineseMatch?.length) {
            hasChinese = true;
            chineseSample = chineseMatch.slice(0, 3).join(', ');
          }
          encodingClean = !looksMojibake(str);
        } catch {
          encodingClean = !looksMojibake(body);
        }

        resolve({
          status: res.statusCode,
          success: parsed?.success !== false,
          hasChinese,
          chineseSample,
          encodingClean,
          bodyLen: body.length,
        });
      });
    });

    req.on('error', (error) => resolve({ status: 0, success: false, error: error.message, encodingClean: false }));
    req.on('timeout', () => {
      req.destroy();
      resolve({ status: 0, success: false, error: 'timeout', encodingClean: false });
    });

    if (endpoint.body) req.write(endpoint.body);
    req.end();
  });
}

async function fetchToken() {
  try {
    const body = await new Promise((resolve) => {
      const url = new URL('/api/auth/login', BACKEND);
      const req = http.request(
        {
          hostname: url.hostname,
          port: url.port,
          path: url.pathname,
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        },
        (res) => {
          let payload = '';
          res.on('data', (chunk) => {
            payload += chunk;
          });
          res.on('end', () => resolve(JSON.parse(payload)));
        },
      );
      req.write(JSON.stringify({ username: 'admin', password: 'admin123' }));
      req.end();
    });
    return body.data?.token || '';
  } catch {
    return '';
  }
}

async function run() {
  console.log('='.repeat(72));
  console.log('Stable runtime API audit: 127.0.0.1:5001, optional localhost:3000 comparison');
  console.log('='.repeat(72));

  const token = await fetchToken();
  if (!token) {
    console.log('FAIL: unable to fetch backend JWT token, audit aborted');
    process.exit(1);
  }

  console.log(`PASS: JWT token fetched (${token.substring(0, 20)}...)`);
  const frontendHtml = await request(FRONTEND, { method: 'GET', path: '/' });
  const compareFrontend = frontendHtml.status !== 0 || REQUIRE_FRONTEND_PORT;
  const stableMode = !compareFrontend;
  if (!compareFrontend) {
    console.log('INFO: localhost:3000 is not running. Stable-mode audit will verify 127.0.0.1:5001 only.');
  }

  console.log('\n' + 'Endpoint'.padEnd(38) + 'Backend'.padEnd(14) + 'Frontend'.padEnd(14) + 'Encoding'.padEnd(18) + 'Match');
  console.log('-'.repeat(98));

  const results = [];
  let passed = 0;
  let encodingCleanCount = 0;

  for (const endpoint of API_ENDPOINTS.filter((item) => item.method === 'GET')) {
    const backendRes = await request(BACKEND, endpoint, token);
    const frontendRes = compareFrontend
      ? await request(FRONTEND, endpoint, token)
      : { status: 'skipped', encodingClean: true };

    const match = compareFrontend ? backendRes.status === frontendRes.status : true;
    const endpointPassed = compareFrontend
      ? match && backendRes.status === 200 && frontendRes.status === 200
      : backendRes.status === 200;
    const encodingClean = Boolean(backendRes.encodingClean && frontendRes.encodingClean);

    if (endpointPassed) passed += 1;
    if (encodingClean) encodingCleanCount += 1;

    const encodingLabel = encodingClean
      ? backendRes.hasChinese
        ? `OK ${backendRes.chineseSample.substring(0, 12)}`
        : 'OK'
      : 'BAD';

    results.push({
      path: endpoint.path,
      backendStatus: backendRes.status,
      frontendStatus: frontendRes.status,
      match,
      passed: endpointPassed,
      hasChinese: backendRes.hasChinese,
      chineseSample: backendRes.chineseSample,
      encodingClean,
    });

    console.log(
      endpoint.path.padEnd(38) +
        `${backendRes.status}`.padEnd(14) +
        `${frontendRes.status}`.padEnd(14) +
        encodingLabel.padEnd(18) +
        (endpointPassed ? 'PASS' : 'FAIL'),
    );
  }

  console.log('-'.repeat(98));
  console.log(`\nSummary: ${passed}/${results.length} status matches, ${encodingCleanCount}/${results.length} encoding-clean`);

  console.log(`Frontend home: HTTP ${frontendHtml.status}, ${frontendHtml.bodyLen} bytes`);

  const report = {
    generatedAt: new Date().toISOString(),
    auditMode: stableMode ? 'stable-backend-only' : 'dual-port-comparison',
    stableRuntimePort: 5001,
    frontend3000Compared: compareFrontend,
    frontend3000Required: REQUIRE_FRONTEND_PORT,
    note: stableMode
      ? 'localhost:3000 was not running; this report only validates the stable 5001 runtime and must not be read as a dual-port comparison pass.'
      : 'localhost:3000 was reachable and compared against the stable 5001 runtime.',
    portA: { base: BACKEND, description: 'Direct backend API' },
    portB: {
      base: FRONTEND,
      description: 'Frontend Vite proxy to backend',
      required: REQUIRE_FRONTEND_PORT,
      compared: compareFrontend,
    },
    loginToken: token ? 'fetched' : 'failed',
    endpoints: results,
    summary: {
      total: results.length,
      passed,
      failed: results.length - passed,
      chineseEncodingOk: encodingCleanCount === results.length,
      encodingClean: encodingCleanCount,
    },
    frontendHtml: { status: frontendHtml.status, bodyLength: frontendHtml.bodyLen },
  };

  const outDir = path.join(__dirname, '..', 'output', 'playwright');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, 'dual-port-audit-report.json');
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf8');
  console.log(`\nReport written to ${outPath}`);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
