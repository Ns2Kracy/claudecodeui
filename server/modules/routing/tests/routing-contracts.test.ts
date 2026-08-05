import assert from 'node:assert/strict';
import test from 'node:test';

import { emptyRoutingSettingsView } from '../../../../shared/routing.js';

test('routing settings contain no obsolete model-source bindings', () => {
  assert.equal('bindings' in emptyRoutingSettingsView(), false);
});

test('public runtime DTO contains status but no secrets', () => {
  const json = JSON.stringify(emptyRoutingSettingsView().runtime);
  assert.equal(
    /"(?:adminPassword|dataPlaneKey|apiKey|cookie|ciphertext)"\s*:/i.test(json),
    false,
  );
  assert.equal(json.includes('sidecar'), true);
  assert.equal(json.includes('hasAdminCredential'), false);
  assert.equal(json.includes('hasDataPlaneKey'), false);
});
