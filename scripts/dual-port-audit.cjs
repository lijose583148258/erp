/**
 * 双口径核对脚本
 * 口径 A：127.0.0.1:5001 后端 API 直连
 * 口径 B：localhost:3000  前端 Vite 代理 → 后端
 */
const http = require('http');

const BACKEND = 'http://127.0.0.1:5001';
const FRONTEND = 'http://localhost:3000';

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
    if (token) options.headers['Authorization'] = `Bearer ${token}`;

    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        let parsed = null;
        let hasChinese = false;
        let chineSample = '';
        try {
          parsed = JSON.parse(body);
          // 检查中文是否正确编码（非乱码）
          const str = JSON.stringify(parsed);
          const chineseMatch = str.match(/[\u4e00-\u9fff]+/g);
          if (chineseMatch && chineseMatch.length > 0) {
            hasChinese = true;
            chineSample = chineseMatch.slice(0, 3).join(', ');
          }
        } catch {}
        resolve({
          status: res.statusCode,
          success: parsed?.success !== false,
          hasChinese,
          chineSample,
          bodyLen: body.length,
        });
      });
    });
    req.on('error', (e) => resolve({ status: 0, success: false, error: e.message }));
    req.on('timeout', () => { req.destroy(); resolve({ status: 0, success: false, error: 'timeout' }); });
    if (endpoint.body) req.write(endpoint.body);
    req.end();
  });
}

async function run() {
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║          双口径核对 — 127.0.0.1:5001 vs localhost:3000      ║');
  console.log('╚══════════════════════════════════════════════════════════════╝\n');

  // 1. 获取 Token
  let tokenA = '';
  try {
    const loginBody = await new Promise((resolve) => {
      const url = new URL('/api/auth/login', BACKEND);
      const req = http.request({ hostname: url.hostname, port: url.port, path: url.pathname, method: 'POST', headers: { 'Content-Type': 'application/json' } }, (res) => {
        let b = ''; res.on('data', c => b += c); res.on('end', () => resolve(JSON.parse(b)));
      });
      req.write(JSON.stringify({ username: 'admin', password: 'admin123' }));
      req.end();
    });
    tokenA = loginBody.data?.token || '';
  } catch {
    // login failure is handled by the tokenA check below.
  }

  if (!tokenA) {
    console.log('❌ 无法获取后端 JWT Token，中止核对');
    process.exit(1);
  }
  console.log(`✅ JWT Token 获取成功 (${tokenA.substring(0, 20)}...)\n`);

  // 2. 逐端点双口径核对
  const results = [];
  const getEndpoints = API_ENDPOINTS.filter(ep => ep.method === 'GET');

  console.log('端点'.padEnd(38) + '后端(5001)'.padEnd(14) + '前端(3000)'.padEnd(14) + '中文编码'.padEnd(12) + '匹配');
  console.log('─'.repeat(90));

  let passCount = 0;
  let totalCount = getEndpoints.length;

  for (const ep of getEndpoints) {
    const [resA, resB] = await Promise.all([
      request(BACKEND, ep, tokenA),
      request(FRONTEND, ep, tokenA),
    ]);

    const statusMatch = resA.status === resB.status;
    const bothOk = resA.status === 200 && resB.status === 200;
    const passed = statusMatch && bothOk;
    if (passed) passCount++;

    const chineseStatus = resA.hasChinese ? `✅ ${resA.chineSample.substring(0, 8)}` : '—';

    results.push({
      path: ep.path,
      backendStatus: resA.status,
      frontendStatus: resB.status,
      match: statusMatch,
      passed,
      hasChinese: resA.hasChinese,
      chineSample: resA.chineSample,
    });

    const icon = passed ? '✅' : '❌';
    console.log(
      ep.path.padEnd(38) +
      `${resA.status}`.padEnd(14) +
      `${resB.status}`.padEnd(14) +
      chineseStatus.padEnd(12) +
      icon
    );
  }

  console.log('─'.repeat(90));
  console.log(`\n总计: ${passCount}/${totalCount} 通过\n`);

  // 3. 前端 HTML 检查
  const frontendHtml = await request(FRONTEND, { method: 'GET', path: '/' });
  console.log(`前端首页: HTTP ${frontendHtml.status}, ${frontendHtml.bodyLen} bytes`);

  // 4. 输出 JSON 报告
  const report = {
    generatedAt: new Date().toISOString(),
    口径A: { base: BACKEND, description: '后端 API 直连' },
    口径B: { base: FRONTEND, description: '前端 Vite 代理 → 后端' },
    loginToken: tokenA ? '获取成功' : '获取失败',
    endpoints: results,
    summary: {
      total: totalCount,
      passed: passCount,
      failed: totalCount - passCount,
      chineseEncodingOk: results.filter(r => r.hasChinese).length > 0,
    },
    frontendHtml: { status: frontendHtml.status, bodyLength: frontendHtml.bodyLen },
  };

  const fs = require('fs');
  const path = require('path');
  const outDir = path.join(__dirname, '..', 'output', 'playwright');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, 'dual-port-audit-report.json');
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf8');
  console.log(`\n报告已写入: ${outPath}`);
}

run().catch(e => { console.error(e); process.exit(1); });
