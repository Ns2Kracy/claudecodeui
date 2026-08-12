import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CLI_PROVIDERS,
  PROVIDER_AUTH_STATUS_ENDPOINTS,
  createInitialProviderAuthStatusMap,
} from './types.js';

test('provider authentication exposes only the routed Codex agent', () => {
  assert.deepEqual(CLI_PROVIDERS, ['codex']);
  assert.deepEqual(PROVIDER_AUTH_STATUS_ENDPOINTS, {
    codex: '/api/providers/codex/auth/status',
  });
  assert.deepEqual(Object.keys(createInitialProviderAuthStatusMap(false)), ['codex']);
});
