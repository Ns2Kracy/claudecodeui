import assert from 'node:assert/strict';
import test from 'node:test';

import { DEFAULT_ACTIVE_PROVIDER } from './projectsState.js';

test('new projects and sessions default to Codex', () => {
  assert.equal(DEFAULT_ACTIVE_PROVIDER, 'codex');
});
