import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';

const requireFromProject = createRequire(import.meta.url);

test('pins the embedded 9router package and expected server entrypoints', () => {
  const packageJsonPath = requireFromProject.resolve('9router/package.json');
  const packageJson = requireFromProject('9router/package.json') as { version?: string };
  const packageRoot = dirname(packageJsonPath);

  assert.equal(packageJson.version, '0.5.45');
  assert.equal(existsSync(join(packageRoot, 'app/custom-server.js')), true);
  assert.equal(existsSync(join(packageRoot, 'app/server.js')), true);
});
