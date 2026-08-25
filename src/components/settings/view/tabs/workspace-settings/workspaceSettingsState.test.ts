import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeWorkspaceSettings } from './workspaceSettingsState.js';

test('workspace settings normalize protection API values', () => {
  assert.deepEqual(normalizeWorkspaceSettings({
    strictIsolation: true,
    isolationAvailable: true,
    isolationReason: null,
  }), {
    strictIsolation: true,
    isolationAvailable: true,
    isolationReason: null,
  });
});

test('workspace settings preserve an explicit choice to turn protection off', () => {
  assert.equal(normalizeWorkspaceSettings({ strictIsolation: false }).strictIsolation, false);
});

test('workspace settings default safely to protection enabled', () => {
  assert.deepEqual(normalizeWorkspaceSettings({ strictIsolation: 'yes' }), {
    strictIsolation: true,
    isolationAvailable: false,
    isolationReason: null,
  });
});
