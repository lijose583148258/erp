const fs = require('fs');
const path = require('path');

const backendRoot = process.cwd();
const sourceDir = path.join(backendRoot, 'prisma');
const sourceModelsDir = path.join(sourceDir, 'models');
const outputDir = path.resolve(
  backendRoot,
  process.env.POSTGRES_PRISMA_ARTIFACT_DIR || '.generated/prisma-postgresql',
);
const sourceSchemaPath = path.join(sourceDir, 'schema.prisma');
const outputSchemaPath = path.join(outputDir, 'schema.prisma');
const manifestPath = path.join(outputDir, 'artifact.json');

function removeDirectoryContents(dir) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      removeDirectoryContents(fullPath);
      fs.rmdirSync(fullPath);
    } else {
      fs.unlinkSync(fullPath);
    }
  }
}

function copyKnownPrismaFiles() {
  fs.mkdirSync(path.join(outputDir, 'models'), { recursive: true });
  fs.copyFileSync(sourceSchemaPath, outputSchemaPath);

  for (const entry of fs.readdirSync(sourceModelsDir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.prisma')) continue;
    fs.copyFileSync(
      path.join(sourceModelsDir, entry.name),
      path.join(outputDir, 'models', entry.name),
    );
  }
}

function prepareArtifact() {
  if (!fs.existsSync(sourceSchemaPath)) {
    throw new Error(`Prisma schema not found: ${sourceSchemaPath}`);
  }

  removeDirectoryContents(outputDir);
  copyKnownPrismaFiles();

  const originalSchema = fs.readFileSync(outputSchemaPath, 'utf8');
  const postgresSchema = originalSchema.replace(/provider\s*=\s*"sqlite"/g, 'provider = "postgresql"');

  if (postgresSchema === originalSchema) {
    throw new Error('SQLite provider declaration was not found in copied schema.prisma');
  }

  fs.writeFileSync(outputSchemaPath, postgresSchema, 'utf8');
  fs.writeFileSync(manifestPath, `${JSON.stringify({
    schemaProvider: 'postgresql',
    generatedAt: new Date().toISOString(),
    source: path.relative(backendRoot, sourceDir).replace(/\\/g, '/'),
    schema: path.relative(backendRoot, outputSchemaPath).replace(/\\/g, '/'),
    note: 'Generated from backend/prisma for PostgreSQL artifact validation and image builds. Do not edit by hand.',
  }, null, 2)}\n`, 'utf8');

  return outputDir;
}

try {
  const artifactDir = prepareArtifact();
  console.log(`PostgreSQL Prisma artifact prepared: ${path.relative(backendRoot, artifactDir).replace(/\\/g, '/')}`);
} catch (error) {
  console.error('PostgreSQL Prisma artifact preparation failed.');
  console.error(error instanceof Error ? error.stack || error.message : JSON.stringify(error));
  process.exit(1);
}
