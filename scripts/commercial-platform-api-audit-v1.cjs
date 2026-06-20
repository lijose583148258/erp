const fs = require('fs');
const path = require('path');

const APP_URL = (process.env.APP_URL || 'http://127.0.0.1:5001/').replace(/\/?$/, '/');
const OUTPUT_DIR = path.join(process.cwd(), 'output', 'audit');
const REPORT_PATH = path.join(OUTPUT_DIR, 'commercial-platform-api-audit-v1.json');
const REQUEST_TIMEOUT_MS = 10_000;
const RUN_ID = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);

const ADMIN = { username: 'admin', password: 'admin123' };

const report = {
  appUrl: APP_URL,
  runId: RUN_ID,
  startedAt: new Date().toISOString(),
  status: 'running',
  steps: [],
  failure: null,
};

function recordStep(step) {
  report.steps.push({ at: new Date().toISOString(), ...step });
}

function parseJson(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text.slice(0, 500) };
  }
}

function expect(condition, message, details) {
  if (!condition) {
    const error = new Error(message);
    error.details = details;
    throw error;
  }
}

function expectStatus(response, expected, label) {
  if (!expected.includes(response.status)) {
    const error = new Error(`${label}: expected ${expected.join('/')} but got ${response.status}`);
    error.status = response.status;
    error.details = response.json || response.text;
    throw error;
  }
}

async function apiFetch(endpoint, options = {}, token = '') {
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new Error(`Timeout after ${REQUEST_TIMEOUT_MS}ms for ${endpoint}`)),
    REQUEST_TIMEOUT_MS,
  );

  try {
    const response = await fetch(`${APP_URL}api${endpoint}`, {
      method: options.method || 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: options.data === undefined ? undefined : JSON.stringify(options.data),
      signal: controller.signal,
    });
    const text = await response.text();
    return { status: response.status, ok: response.ok, json: parseJson(text), text };
  } finally {
    clearTimeout(timer);
  }
}

async function rawFetch(urlPath) {
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new Error(`Timeout after ${REQUEST_TIMEOUT_MS}ms for ${urlPath}`)),
    REQUEST_TIMEOUT_MS,
  );
  try {
    const response = await fetch(`${APP_URL}${urlPath.replace(/^\//, '')}`, { signal: controller.signal });
    const text = await response.text();
    return { status: response.status, ok: response.ok, text };
  } finally {
    clearTimeout(timer);
  }
}

function dataOf(response) {
  return response?.json?.data ?? null;
}

async function login() {
  const response = await apiFetch('/auth/login', {
    method: 'POST',
    data: ADMIN,
  });
  expectStatus(response, [200], 'admin-login');
  const data = dataOf(response);
  expect(Boolean(data?.token), 'admin-login missing token', response.json);
  recordStep({ step: 'admin-login', result: 'passed', role: data.user?.role });
  return data.token;
}

async function main() {
  try {
    const token = await login();

    const readiness = await apiFetch('/commercial/readiness', {}, token);
    expectStatus(readiness, [200], 'platform-readiness');
    const readinessData = dataOf(readiness);
    expect(['ready', 'watch', 'blocked'].includes(readinessData?.status), 'readiness status invalid', readiness.json);
    expect(Array.isArray(readinessData?.checks) && readinessData.checks.length >= 4, 'readiness checks missing', readiness.json);
    recordStep({ step: 'platform-readiness', result: 'passed', status: readinessData.status, checks: readinessData.checks.length });

    const workflowCode = `audit_flow_${RUN_ID}`;
    const definition = await apiFetch('/commercial/workflow/definitions', {
      method: 'POST',
      data: {
        code: workflowCode,
        name: `P3 审批流 ${RUN_ID}`,
        documentType: 'barter_settlement',
        config: {
          nodes: [
            { code: 'manager_review', name: '经理审批', assigneeRole: 'manager' },
            { code: 'finance_review', name: '财务复核', assigneeRole: 'admin' },
          ],
        },
      },
    }, token);
    expectStatus(definition, [201], 'create-workflow-definition');
    expect(dataOf(definition)?.code === workflowCode, 'workflow definition code mismatch', definition.json);
    recordStep({ step: 'create-workflow-definition', result: 'passed', code: workflowCode });

    const invalidDefinition = await apiFetch('/commercial/workflow/definitions', {
      method: 'POST',
      data: {
        code: `audit_bad_${RUN_ID}`,
        name: `P3 坏审批流 ${RUN_ID}`,
        documentType: 'barter_settlement',
        config: { nodes: [{ code: 'bad_node_without_assignee' }] },
      },
    }, token);
    expectStatus(invalidDefinition, [400, 409, 500], 'invalid-workflow-definition-rejected');
    recordStep({ step: 'invalid-workflow-definition-rejected', result: 'passed', status: invalidDefinition.status });

    const instance = await apiFetch('/commercial/workflow/instances', {
      method: 'POST',
      data: {
        definitionCode: workflowCode,
        documentType: 'barter_settlement',
        documentId: `BT-AUDIT-${RUN_ID}`,
      },
    }, token);
    expectStatus(instance, [201], 'create-workflow-instance');
    const instanceData = dataOf(instance);
    expect(Number(instanceData?.id) > 0, 'workflow instance id missing', instance.json);
    recordStep({ step: 'create-workflow-instance', result: 'passed', instanceId: instanceData.id });

    const tasks = await apiFetch('/commercial/workflow/tasks', {}, token);
    expectStatus(tasks, [200], 'list-workflow-tasks');
    const task = (dataOf(tasks) || []).find(item => Number(item.instance_id) === Number(instanceData.id));
    expect(Boolean(task?.id), 'created workflow task not found', tasks.json);
    recordStep({ step: 'list-workflow-tasks', result: 'passed', taskId: task.id });

    const action1 = await apiFetch(`/commercial/workflow/tasks/${task.id}/actions`, {
      method: 'POST',
      data: { action: 'approve', comment: 'P3 audit manager approval' },
    }, token);
    expectStatus(action1, [200], 'approve-first-workflow-task');
    expect(dataOf(action1)?.status === 'pending', 'workflow should move to second node', action1.json);
    recordStep({ step: 'approve-first-workflow-task', result: 'passed' });

    const tasksAfterFirstApproval = await apiFetch('/commercial/workflow/tasks', {}, token);
    const nextTask = (dataOf(tasksAfterFirstApproval) || []).find(item => Number(item.instance_id) === Number(instanceData.id));
    expect(Boolean(nextTask?.id), 'second workflow task not found', tasksAfterFirstApproval.json);
    const action2 = await apiFetch(`/commercial/workflow/tasks/${nextTask.id}/actions`, {
      method: 'POST',
      data: { action: 'approve', comment: 'P3 audit finance approval' },
    }, token);
    expectStatus(action2, [200], 'approve-second-workflow-task');
    expect(dataOf(action2)?.status === 'approved', 'workflow should be approved after second node', action2.json);
    recordStep({ step: 'approve-second-workflow-task', result: 'passed' });

    const bi = await apiFetch('/commercial/bi/summary', {}, token);
    expectStatus(bi, [200], 'bi-summary');
    expect(typeof dataOf(bi)?.orders === 'number', 'bi-summary orders missing', bi.json);
    recordStep({ step: 'bi-summary', result: 'passed', summary: dataOf(bi) });

    const alerts = await apiFetch('/commercial/alerts/run', { method: 'POST', data: {} }, token);
    expectStatus(alerts, [200], 'run-alert-rules');
    expect(typeof dataOf(alerts)?.createdCount === 'number', 'alert createdCount missing', alerts.json);
    recordStep({ step: 'run-alert-rules', result: 'passed', createdCount: dataOf(alerts).createdCount });

    const notifications = await apiFetch('/commercial/notifications', {}, token);
    expectStatus(notifications, [200], 'list-notifications');
    expect(Array.isArray(dataOf(notifications)), 'notifications list missing', notifications.json);
    recordStep({ step: 'list-notifications', result: 'passed', count: dataOf(notifications).length });

    const metrics = await rawFetch('/metrics');
    expectStatus(metrics, [200], 'metrics');
    expect(metrics.text.includes('ailaoda_process_uptime_seconds'), 'metrics missing uptime', metrics.text.slice(0, 500));
    expect(metrics.text.includes('ailaoda_http_requests_total'), 'metrics missing request counter', metrics.text.slice(0, 500));
    recordStep({ step: 'metrics', result: 'passed' });

    report.status = 'passed';
  } catch (error) {
    report.status = 'failed';
    report.failure = {
      message: error?.message || String(error),
      status: error?.status || null,
      details: error?.details || null,
      stack: error?.stack || null,
    };
  } finally {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    report.endedAt = new Date().toISOString();
    report.durationMs = new Date(report.endedAt).getTime() - new Date(report.startedAt).getTime();
    fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  }

  if (report.status !== 'passed') {
    console.error(report.failure?.message || 'Commercial platform API audit failed');
    process.exit(1);
  }
  console.log(`Commercial platform API audit passed. Report: ${REPORT_PATH}`);
}

main();
