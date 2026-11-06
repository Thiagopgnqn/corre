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
  'apiContract.test.ts',
  'scheduleAvailability.test.ts',
  'tutorialLayout.test.ts',
];

for (const file of files) {
  const content = fs.readFileSync(path.join(testDir, file), 'utf-8');
  // Match assert( or assert.*(
  const assertCalls = content.match(/\bassert(?:\.[a-zA-Z0-9_]+)?\s*\(/g) || [];
  // Match test sections (either it/test, or console.log('...'), or numbered tests)
  const itCalls = content.match(/\b(?:it|test)\s*\(/g) || [];
  console.log(`${file}:`);
  console.log(`  assert calls: ${assertCalls.length}`);
  console.log(`  it/test calls: ${itCalls.length}`);
}

