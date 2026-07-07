import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';

type UnitTest = {
  name: string;
  run: () => void | Promise<void>;
};

type UnitTestModule = {
  tests?: UnitTest[];
};

const ROOT = process.cwd();
const TEST_ROOTS = ['components', 'utils'];

const walk = (dir: string, bucket: string[] = []) => {
  if (!fs.existsSync(dir)) return bucket;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'quarantine') continue;
      walk(fullPath, bucket);
      continue;
    }
    if (entry.isFile() && /\.unit\.test\.(ts|tsx)$/.test(entry.name)) {
      bucket.push(fullPath);
    }
  }
  return bucket;
};

const testFiles = TEST_ROOTS.flatMap((root) => walk(path.join(ROOT, root))).sort();

if (!testFiles.length) {
  console.error('No frontend unit test files found.');
  process.exit(1);
}

let passed = 0;
let failed = 0;

for (const filePath of testFiles) {
  const relativePath = path.relative(ROOT, filePath).replace(/\\/g, '/');
  const module = await import(pathToFileURL(filePath).href) as UnitTestModule;
  if (!Array.isArray(module.tests) || !module.tests.length) {
    console.error(`${relativePath}: missing exported tests[]`);
    failed += 1;
    continue;
  }

  for (const testCase of module.tests) {
    try {
      await testCase.run();
      passed += 1;
      console.log(`ok ${relativePath} - ${testCase.name}`);
    } catch (error) {
      failed += 1;
      console.error(`not ok ${relativePath} - ${testCase.name}`);
      console.error(error instanceof Error ? error.stack || error.message : String(error));
    }
  }
}

console.log(`Frontend unit tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
