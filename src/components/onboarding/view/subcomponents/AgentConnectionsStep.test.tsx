import assert from 'node:assert/strict';
import test from 'node:test';

import { ONBOARDING_AGENT_CARDS } from './agentConnectionsState.js';

test('onboarding offers only Codex connection through the router', () => {
  assert.deepEqual(
    ONBOARDING_AGENT_CARDS.map(({ provider, title }) => ({ provider, title })),
    [{ provider: 'codex', title: 'OpenAI Codex' }],
  );
});
