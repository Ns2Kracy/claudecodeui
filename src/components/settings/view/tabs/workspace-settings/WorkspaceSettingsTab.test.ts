import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('./WorkspaceSettingsTab.tsx', import.meta.url), 'utf8');

test('workspace settings show only protected and unprotected permission cards', () => {
  assert.match(source, /value: true/);
  assert.match(source, /value: false/);
  assert.match(source, /name="workspaceProtection"/);
  assert.match(source, /const mode = value \? 'protected' : 'unprotected';/);
  assert.match(source, /workspace\.protection\.modes\.\$\{mode\}\.title/);
  assert.doesNotMatch(source, /workspaceRoot/);
  assert.doesNotMatch(source, /SettingsCard/);
  assert.doesNotMatch(source, /SettingsToggle/);
  assert.match(source, /JSON\.stringify\(\{\s*strictIsolation: settings\.strictIsolation,?\s*\}\)/);
});
