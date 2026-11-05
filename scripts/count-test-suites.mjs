import fs from 'node:fs';
import path from 'node:path';

const testDir = path.join(process.cwd(), 'test');
const files = [
  'correlativas.test.ts',
  'scheduleImport.test.ts',
  'reviewsFrontend.test.ts',
  'authFrontend.test.ts',
  'brand.test.ts',
  'scheduleLayout.test.ts',
  'adminFrontend.test.ts',
  'libraryFrontend.test.ts',
  'mobileFrontend.test.ts',
];

console.log('=== CONTEO REPRODUCIBLE DE SUITES DE TESTS ===\n');

for (const file of files) {
  const fullPath = path.join(testDir, file);
  if (!fs.existsSync(fullPath)) continue;
  const content = fs.readFileSync(fullPath, 'utf-8');

  // Count it(...) and test(...)
  const itMatches = content.match(/(?:^|\s)(?:it|test)\s*\(/g) || [];
  
  // Count assert.* and expect.*
  const assertMatches = content.match(/(?:assert\.[a-zA-Z0-9_]+|expect\([^)]+\)\.[a-zA-Z0-9_]+)/g) || [];

  // Count describe blocks
  const describeMatches = content.match(/(?:^|\s)describe\s*\(/g) || [];

  console.log(`Archivo: ${file}`);
  console.log(`  - Describe blocks: ${describeMatches.length}`);
  console.log(`  - Tests individuales (it/test): ${itMatches.length}`);
  console.log(`  - Llamadas de aserción (assert/expect): ${assertMatches.length}`);
}

