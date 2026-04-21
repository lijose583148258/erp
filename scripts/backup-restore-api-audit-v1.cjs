/**
 * 备份/恢复 API 全链路审计（纯 fetch，不依赖浏览器）
 * 链路：login → status → backup → list → restore → status
 */
const fs = require('fs');
const path = require('path');

const APP_URL = process.env.APP_URL || 'http://127.0.0.1:5001/';
const OUTPUT_DIR = path.join(process.cwd(), 'output', 'playwright');
const REPORT_PATH = path.join(OUTPUT_DIR, 'backup-restore-api-audit-report-v1.json');
const RUN_ID = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);

const report = {
  appUrl: APP_URL,
  startedAt: new Date().toISOString(),
  runId: RUN_ID,
  steps: [],
  status: 'running',
};

function recordStep(entry) {
  report.steps.push({ at: new Date().toISOString(), ...entry });
}

function extractDatabaseStatus(payload) {
  if (!payload || typeof payload !== 'object') {
    return null;
  }

  if (payload.data && payload.data.database) {
    return payload.data.database;
  }

  return payload.data || null;
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
    throw new Error(`登录失败 (${username}): ${response.status}`);
  }
  return response.json.data;
}

async function run() {
  try {
    // 步骤 1：管理员登录
    const admin = await login('admin', 'admin123');
    recordStep({ step: 'login-admin', result: 'passed', userId: admin.user.id });

    // 步骤 2：获取系统状态
    const statusBefore = await apiFetch('/system/status', {}, admin.token);
    if (!statusBefore.ok) {
      throw new Error(`系统状态获取失败: ${statusBefore.status}`);
    }
    const dbStatus = extractDatabaseStatus(statusBefore.json);
    report.statusBefore = {
      databaseType: dbStatus?.databaseType,
      databaseExists: dbStatus?.databaseExists,
      databaseSize: dbStatus?.databaseSize,
      backupCount: dbStatus?.backupCount,
    };
    recordStep({ step: 'get-system-status-before', result: 'passed', databaseType: dbStatus?.databaseType });

    // 步骤 3：创建备份
    const createBackup = await apiFetch('/system/backups', { method: 'POST' }, admin.token);
    if (!createBackup.ok) {
      throw new Error(`创建备份失败: ${createBackup.status}`);
    }
    const backupFileName = createBackup.json?.data?.fileName;
    if (!backupFileName) {
      throw new Error('备份创建返回空文件名');
    }
    report.createdBackup = backupFileName;
    recordStep({ step: 'create-backup', result: 'passed', fileName: backupFileName });

    // 步骤 4：验证备份出现在列表中
    const listBackups = await apiFetch('/system/backups', {}, admin.token);
    if (!listBackups.ok) {
      throw new Error(`备份列表获取失败: ${listBackups.status}`);
    }
    const backups = listBackups.json?.data;
    if (!Array.isArray(backups)) {
      throw new Error('备份列表格式异常');
    }
    const found = backups.find((item) => item.filename === backupFileName);
    if (!found) {
      throw new Error(`新创建的备份 ${backupFileName} 未在列表中找到`);
    }
    recordStep({ step: 'verify-backup-in-list', result: 'passed', totalBackups: backups.length });

    // 步骤 5：从备份恢复
    const restoreResult = await apiFetch('/system/restore', {
      method: 'POST',
      data: { fileName: backupFileName },
    }, admin.token);
    if (!restoreResult.ok) {
      throw new Error(`恢复失败: ${restoreResult.status} — ${restoreResult.json?.message || ''}`);
    }
    recordStep({ step: 'restore-from-backup', result: 'passed', restoredFrom: backupFileName });

    // 步骤 6：恢复后验证系统状态
    const statusAfter = await apiFetch('/system/status', {}, admin.token);
    if (!statusAfter.ok) {
      throw new Error(`恢复后系统状态获取失败: ${statusAfter.status}`);
    }
    const dbAfter = extractDatabaseStatus(statusAfter.json);
    if (!dbAfter?.databaseExists) {
      throw new Error('恢复后数据库不存在');
    }
    report.statusAfter = {
      databaseType: dbAfter?.databaseType,
      databaseExists: dbAfter?.databaseExists,
      databaseSize: dbAfter?.databaseSize,
      backupCount: dbAfter?.backupCount,
    };
    recordStep({ step: 'get-system-status-after', result: 'passed', databaseExists: dbAfter?.databaseExists });

    // 步骤 7：恢复后验证登录仍然可用
    const loginAfterRestore = await login('admin', 'admin123');
    recordStep({ step: 'verify-login-after-restore', result: 'passed', userId: loginAfterRestore.user.id });

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
    console.error(report.error || '备份恢复 API 审计失败');
    process.exitCode = 1;
    return;
  }

  console.log(`Backup/restore API audit passed. Report: ${REPORT_PATH}`);
}

run();
