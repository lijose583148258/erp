/**
 * Dashboard role-scope audit.
 * Goal: sales dashboard must not expose global inventory/risk/commission scope.
 */
const fs = require('fs');
const path = require('path');

const APP_URL = process.env.APP_URL || 'http://127.0.0.1:5001/';
const OUTPUT_DIR = path.join(process.cwd(), 'output', 'playwright');
const REPORT_PATH = path.join(OUTPUT_DIR, 'dashboard-role-scope-audit-report-v1.json');

const report = {
  appUrl: APP_URL,
  startedAt: new Date().toISOString(),
  steps: [],
  status: 'running',
};

function recordStep(entry) {
  report.steps.push({ at: new Date().toISOString(), ...entry });
}

async function apiFetch(endpoint, options = {}, token = '') {
  const response = await fetch(`${APP_URL}api${endpoint}`, {
    method: options.method || 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
    body: options.data ? JSON.stringify(options.data) : undefined,
  });

  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }
  return { ok: response.ok, status: response.status, json };
}

async function login(username, password) {
  const response = await apiFetch('/auth/login', {
    method: 'POST',
    data: { username, password },
  });
  if (!response.ok) {
    throw new Error(`Login failed (${username}): ${response.status} ${JSON.stringify(response.json)}`);
  }
  return response.json.data;
}

function assertNumber(value, label) {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    throw new Error(`${label} must be a number, got ${String(value)}`);
  }
}

async function run() {
  try {
    const sales = await login('sales', 'sales123');
    const manager = await login('manager', 'manager123');
    recordStep({
      step: 'login-sales-manager',
      result: 'passed',
      salesUserId: sales.user.id,
      managerUserId: manager.user.id,
    });

    const salesDashboard = await apiFetch('/dashboard', {}, sales.token);
    if (!salesDashboard.ok) {
      throw new Error(`Sales dashboard failed: ${salesDashboard.status} ${JSON.stringify(salesDashboard.json)}`);
    }
    const salesData = salesDashboard.json?.data || {};
    const salesOverview = salesData.overview || {};
    ['totalCustomers', 'totalOrders', 'totalRevenue', 'pendingOrders', 'pendingCommissions', 'overdueAmount']
      .forEach((key) => assertNumber(salesOverview[key], `sales.overview.${key}`));
    if (!Array.isArray(salesData.inventoryAlerts)) {
      throw new Error('sales.inventoryAlerts must be an array');
    }
    if (salesData.inventoryAlerts.length !== 0) {
      throw new Error('Sales dashboard must not expose global inventory alerts');
    }
    recordStep({
      step: 'verify-sales-dashboard-scope',
      result: 'passed',
      inventoryAlerts: salesData.inventoryAlerts.length,
      overview: salesOverview,
    });

    const salesTrends = await apiFetch('/dashboard/trends', {}, sales.token);
    if (!salesTrends.ok || !Array.isArray(salesTrends.json?.data)) {
      throw new Error(`Sales dashboard trends failed: ${salesTrends.status}`);
    }
    recordStep({ step: 'verify-sales-trends', result: 'passed', trendRows: salesTrends.json.data.length });

    const managerDashboard = await apiFetch('/dashboard', {}, manager.token);
    if (!managerDashboard.ok) {
      throw new Error(`Manager dashboard failed: ${managerDashboard.status} ${JSON.stringify(managerDashboard.json)}`);
    }
    const managerData = managerDashboard.json?.data || {};
    if (!Array.isArray(managerData.inventoryAlerts)) {
      throw new Error('manager.inventoryAlerts must be an array');
    }
    recordStep({
      step: 'verify-manager-dashboard-shape',
      result: 'passed',
      inventoryAlerts: managerData.inventoryAlerts.length,
    });

    report.status = 'passed';
  } catch (error) {
    report.status = 'failed';
    report.error = String(error.message || error);
  } finally {
    report.finishedAt = new Date().toISOString();
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2), 'utf8');
  }

  if (report.status !== 'passed') {
    console.error(report.error || 'Dashboard role-scope audit failed');
    process.exit(1);
  }

  console.log(`Dashboard role-scope audit passed. Report: ${REPORT_PATH}`);
}

run();
