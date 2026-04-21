const fs = require('fs');
const path = require('path');
const FormData = require('form-data'); // we might need this or we'll mock the fetch

const REPORT_DIR = path.join(__dirname, '../output/playwright');
const REPORT_PATH = path.join(REPORT_DIR, 'contract-api-audit-report-v1.json');

const APP_URL = process.env.APP_URL || 'http://localhost:5001';

const report = {
  name: "Contract Management API Audit (with Honesty Assertion)",
  version: "1.0",
  startTime: new Date().toISOString(),
  status: "running",
  steps: []
};

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function recordStep(name, status, details = {}) {
  const step = { name, status, time: new Date().toISOString(), ...details };
  report.steps.push(step);
  console.log(`[Step] ${name} (${status}):`, JSON.stringify(details));
  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2), 'utf8');
  return step;
}

async function apiFetch(endpoint, options = {}) {
  const url = `${APP_URL}${endpoint}`;
  const res = await fetch(url, options);
  let data;
  const isJson = res.headers.get('content-type')?.includes('application/json');
  if (isJson) {
    data = await res.json();
  } else {
    data = await res.text();
  }

  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${JSON.stringify(data)}`);
  }
  return data;
}

async function login(username, password) {
  const res = await apiFetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password })
  });
  return res.data.token;
}

async function main() {
  ensureDir(REPORT_DIR);
  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2), 'utf8');

  try {
    // 1. Get identity
    const salesToken = await login('sales', 'sales123'); // Assuming sales exists
    
    // get a customer id 
    const customersRes = await apiFetch('/api/customers?pageSize=1', {
      headers: { 'Authorization': `Bearer ${salesToken}` }
    });
    const customerId = customersRes.data.list?.[0]?.id || 1;
    recordStep('get_identity_and_customer', 'passed', { customerId });

    // 2. Honesty Assertion: mock upload a file or just POST if the API allows it, 
    // actually our freeAIService requires a file usually, but we will test the endpoint.
    // The endpoint often expects multipart/form-data. Let's just create a mock text blob.
    const form = new FormData();
    form.append('file', Buffer.from('mock contract content'), { filename: 'api-test.txt', contentType: 'text/plain' });

    // Node fetch might need slightly different handling for form-data, we can just use the headers from the form instance.
    const analyzeHeaders = {
       'Authorization': `Bearer ${salesToken}`,
       ...form.getHeaders()
    };
    
    const analyzeRes = await apiFetch('/api/contracts/analyze', {
      method: 'POST',
      headers: analyzeHeaders,
      body: form
    });
    
    // Crucial Honesty Check: amount MUST be null, and notice MUST exist
    if (analyzeRes.data.totalAmount !== null || !analyzeRes.data.metadata?.notice) {
       throw new Error("Honesty Assertion Failed: AI returned fake data instead of expected null/notice.");
    }
    recordStep('verify_ai_honesty', 'passed', { notice: analyzeRes.data.metadata.notice });

    // 3. Draft Contract
    const contractPayload = {
      customerId,
      title: "2026年度框架采购协议-API-" + Date.now(),
      type: "sales",
      totalAmount: 150000,
      currency: "CNY",
      milestones: [
        { title: "预付款", percentage: 30 },
        { title: "尾款", percentage: 70 }
      ]
    };
    const createContractRes = await apiFetch('/api/contracts', {
      method: 'POST',
      headers: { 
        'Authorization': `Bearer ${salesToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(contractPayload)
    });
    recordStep('create_contract', 'passed', { contractId: createContractRes.data.id });
    const contractId = createContractRes.data.id;

    // 4. Append Items
    const appendPayload = { note: "附加条款：年底前交付-API" };
    await apiFetch(`/api/contracts/${contractId}/items/append`, {
      method: 'POST',
      headers: { 
        'Authorization': `Bearer ${salesToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(appendPayload)
    });
    recordStep('append_items', 'passed');

    // 5. Readback verification
    const readContractRes = await apiFetch(`/api/contracts/${contractId}`, {
      headers: { 'Authorization': `Bearer ${salesToken}` }
    });
    
    if (readContractRes.data.totalAmount !== 150000) throw new Error("Amount mismatch");
    if (!readContractRes.data.notes || !readContractRes.data.notes.includes(appendPayload.note)) throw new Error("Append note missing");
    recordStep('readback_verify', 'passed');

    report.status = "passed";
  } catch (error) {
    report.status = "failed";
    console.error("Audit failed:", error);
    recordStep('audit_failed', 'failed', { error: error.message });
    process.exitCode = 1;
  } finally {
    report.finishedAt = new Date().toISOString();
    fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2), 'utf8');
    if (report.status === "passed") {
      console.log("Contract API Audit successfully completed.");
    }
  }
}

main();
