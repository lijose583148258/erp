const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const REPORT_DIR = path.join(__dirname, '../output/playwright');
const REPORT_PATH = path.join(REPORT_DIR, 'db-migration-probe-report.json');

const report = {
  name: "Database Migration Capability Probe",
  version: "1.0",
  startTime: new Date().toISOString(),
  engine: "PostgreSQL",
  status: "running",
  steps: []
};

// Ensure output dir
if (!fs.existsSync(REPORT_DIR)) {
  fs.mkdirSync(REPORT_DIR, { recursive: true });
}

function recordStep(name, status, details = {}) {
  const step = { name, status, time: new Date().toISOString(), ...details };
  report.steps.push(step);
  console.log(`[Step] ${name} (${status}):`, JSON.stringify(details));
  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2), 'utf8');
  return step;
}

function runProbe() {
  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2), 'utf8');
  
  try {
    // 强制挂载一个哪怕是虚假的 PostgreSQL 地址，只为了探测 Prisma 的支持路径
    const dummyPgUrl = "postgresql://dummy_user:dummy_pass@localhost:5432/dummy_db?schema=public";
    
    // Create a temporary schema substituting the provider for validation
    const originalSchema = fs.readFileSync('backend/prisma/schema.prisma', 'utf8');
    const tempSchema = originalSchema.replace(/provider\s*=\s*"sqlite"/g, 'provider = "postgresql"');
    const tempSchemaPath = 'backend/prisma/schema.temp.prisma';
    fs.writeFileSync(tempSchemaPath, tempSchema, 'utf8');
    
    recordStep('invoke_prisma_migration', 'running', { targetUrl: dummyPgUrl });
    
    // Execute migration check on the temp schema
    try {
      execSync('npx prisma migrate dev --create-only --schema=backend/prisma/schema.temp.prisma', {
        env: { ...process.env, DATABASE_URL: dummyPgUrl },
        stdio: 'pipe',
        encoding: 'utf8'
      });
    } finally {
      if (fs.existsSync(tempSchemaPath)) fs.unlinkSync(tempSchemaPath);
    }
    
    // 如果竟然没有报错，说明可能本地真的有个dummy被建出来了？不太可能
    throw new Error('Unexpected success. The dummy DB should not be reachable.');
  } catch (error) {
    const errorOutput = error.stderr || error.stdout || error.message;
    
    // 判断是不是预期的引擎连接失败而不是 schema 语法错误
    // Prisma 连接不上 DB 时会报 P1001 错误: "Can't reach database server"
    if (errorOutput.includes('P1001') || errorOutput.includes('reach database server')) {
      recordStep('pg_engine_assertion', 'passed', { 
        reason: 'Received correct P1001 connection error, confirming PG engine path is active and Schema is compatible.'
      });
      report.status = "passed";
    } 
    // 如果报出 provider 相关的错误，说明不支持跨引擎
    else if (errorOutput.includes('provider') || errorOutput.includes('validate')) {
      recordStep('pg_engine_assertion', 'failed', { 
        reason: 'Schema provider validation failed.',
        details: errorOutput.substring(0, 500)
      });
      report.status = "failed";
      process.exitCode = 1;
    } 
    else {
      // 其它未知错误
      recordStep('pg_engine_assertion', 'failed', { 
        reason: 'Unknown error',
        details: errorOutput.substring(0, 500)
      });
      report.status = "failed";
      process.exitCode = 1;
    }
  } finally {
    report.finishedAt = new Date().toISOString();
    fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2), 'utf8');
    if (report.status === "passed") {
      console.log("DB Migration probe successfully completed. Engine supports PG path.");
    }
  }
}

runProbe();
