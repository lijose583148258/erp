import fs from 'fs';
import path from 'path';
import prisma from '../config/database';
import { getSqliteDbPath } from '../config/runtime';

type ScalarType =
  | 'String'
  | 'Int'
  | 'Float'
  | 'Boolean'
  | 'DateTime'
  | 'Json'
  | 'Decimal'
  | 'Bytes'
  | 'BigInt';

type PrismaTableDef = {
  modelName: string;
  tableName: string;
  columns: string[];
};

export interface RuntimeSchemaAuditIssue {
  kind: 'missing-table' | 'missing-column';
  modelName: string;
  tableName: string;
  columnName?: string;
}

export interface RuntimeSchemaAuditReport {
  sqlitePath: string | null;
  schemaFileCount: number;
  tableCount: number;
  issueCount: number;
  issues: RuntimeSchemaAuditIssue[];
}

const scalarTypes = new Set<ScalarType>([
  'String',
  'Int',
  'Float',
  'Boolean',
  'DateTime',
  'Json',
  'Decimal',
  'Bytes',
  'BigInt',
]);

const resolveSchemaRoot = () => {
  const candidates = [
    path.resolve(process.cwd(), 'backend', 'prisma', 'schema.prisma'),
    path.resolve(process.cwd(), 'prisma', 'schema.prisma'),
    path.resolve(__dirname, '../../prisma/schema.prisma'),
    path.resolve(__dirname, '../../../backend/prisma/schema.prisma'),
  ];

  const schemaPath = candidates.find(candidate => fs.existsSync(candidate));
  if (!schemaPath) {
    throw new Error(`Prisma schema not found. Checked: ${candidates.join(', ')}`);
  }

  return path.dirname(schemaPath);
};

const resolveSchemaFiles = () => {
  const schemaRoot = resolveSchemaRoot();
  const files = [path.join(schemaRoot, 'schema.prisma')];
  const modelsDir = path.join(schemaRoot, 'models');

  if (fs.existsSync(modelsDir)) {
    const modelFiles = fs
      .readdirSync(modelsDir)
      .filter(fileName => fileName.endsWith('.prisma'))
      .sort((a, b) => a.localeCompare(b))
      .map(fileName => path.join(modelsDir, fileName));
    files.push(...modelFiles);
  }

  return files;
};

const parseMappedName = (line: string, token: '@map' | '@@map') => {
  const match = line.match(new RegExp(`${token}\\("([^"]+)"\\)`));
  return match?.[1] || null;
};

const parsePrismaSchema = (): PrismaTableDef[] => {
  const source = resolveSchemaFiles()
    .map(schemaPath => fs.readFileSync(schemaPath, 'utf8'))
    .join('\n');
  const lines = source.split(/\r?\n/);
  const tables: PrismaTableDef[] = [];

  let currentModel: PrismaTableDef | null = null;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('//')) continue;

    const modelMatch = line.match(/^model\s+(\w+)\s+\{$/);
    if (modelMatch) {
      currentModel = {
        modelName: modelMatch[1],
        tableName: modelMatch[1],
        columns: [],
      };
      continue;
    }

    if (!currentModel) continue;

    if (line === '}') {
      tables.push(currentModel);
      currentModel = null;
      continue;
    }

    if (line.startsWith('@@map(')) {
      currentModel.tableName = parseMappedName(line, '@@map') || currentModel.tableName;
      continue;
    }

    if (line.startsWith('@@')) {
      continue;
    }

    const fieldMatch = line.match(/^(\w+)\s+([A-Za-z][A-Za-z0-9]*)/);
    if (!fieldMatch) continue;

    const fieldName = fieldMatch[1];
    const fieldType = fieldMatch[2] as ScalarType;

    if (!scalarTypes.has(fieldType)) {
      continue;
    }

    const mapped = parseMappedName(line, '@map');
    currentModel.columns.push(mapped || fieldName);
  }

  return tables;
};

const normalizeTableInfo = (rows: Array<Record<string, unknown>>) =>
  rows.map((row) =>
    Object.fromEntries(
      Object.entries(row).map(([key, value]) => [key, typeof value === 'bigint' ? Number(value) : value]),
    ),
  );

export const auditRuntimeSchema = async (): Promise<RuntimeSchemaAuditReport> => {
  const schemaFiles = resolveSchemaFiles();
  const tables = parsePrismaSchema();
  const sqliteMaster = await prisma.$queryRawUnsafe<Array<{ name: string }>>(
    "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
  );
  const dbTables = new Set(sqliteMaster.map((row) => row.name));
  const issues: RuntimeSchemaAuditIssue[] = [];

  for (const table of tables) {
    if (!dbTables.has(table.tableName)) {
      issues.push({
        kind: 'missing-table',
        modelName: table.modelName,
        tableName: table.tableName,
      });
      continue;
    }

    const columns = normalizeTableInfo(
      await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(`PRAGMA table_info('${table.tableName}')`),
    );
    const dbColumns = new Set(columns.map((row) => String(row.name)));

    for (const column of table.columns) {
      if (!dbColumns.has(column)) {
        issues.push({
          kind: 'missing-column',
          modelName: table.modelName,
          tableName: table.tableName,
          columnName: column,
        });
      }
    }
  }

  return {
    sqlitePath: getSqliteDbPath(),
    schemaFileCount: schemaFiles.length,
    tableCount: sqliteMaster.length,
    issueCount: issues.length,
    issues,
  };
};
