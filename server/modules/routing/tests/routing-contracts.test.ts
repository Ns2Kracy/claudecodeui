import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ROUTING_AGENTS,
  ROUTING_SUPPORTED_AGENTS,
  emptyRoutingSettingsView,
} from '../../../../shared/routing.js';

test('routing contracts keep agent identity separate from model source', () => {
  assert.deepEqual(ROUTING_AGENTS, ['claude', 'codex', 'cursor', 'opencode']);
  assert.deepEqual(ROUTING_SUPPORTED_AGENTS, ['claude', 'codex', 'opencode']);
  assert.equal(emptyRoutingSettingsView().bindings.cursor.source, 'native');
});

test('public connection DTO contains presence flags but no secrets', () => {
  const json = JSON.stringify(emptyRoutingSettingsView().connection);
  assert.equal(
    /"(?:adminPassword|dataPlaneKey|apiKey|cookie|ciphertext)"\s*:/i.test(json),
    false,
  );
  assert.equal(json.includes('hasAdminCredential'), true);
  assert.equal(json.includes('hasDataPlaneKey'), true);
});
