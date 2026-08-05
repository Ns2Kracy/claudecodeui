import assert from 'node:assert/strict';
import test from 'node:test';

import {
  configureEmbeddedNineRouterForTesting,
  getEmbeddedNineRouterStatus,
  resetEmbeddedNineRouterForTesting,
  restartEmbeddedNineRouter,
  startEmbeddedNineRouter,
  stopEmbeddedNineRouter,
} from '../routing.module.js';

test.afterEach(() => {
  resetEmbeddedNineRouterForTesting();
});

test('embedded lifecycle uses a singleton runtime and forwards start/stop/restart/status', async () => {
  const calls: string[] = [];
  const runtime = {
    async start() {
      calls.push('start');
      return { state: 'ready' as const, origin: '9router', version: '1.0.0', lastError: null };
    },
    async stop() {
      calls.push('stop');
    },
    async restart() {
      calls.push('restart');
      return { state: 'ready' as const, origin: '9router', version: '1.0.1', lastError: null };
    },
    getStatus() {
      calls.push('status');
      return { state: 'ready' as const, origin: '9router', version: '1.0.1', lastError: null };
    },
    getInternalCredentials() {
      throw new Error('credentials must stay private');
    },
  };
  let factories = 0;
  configureEmbeddedNineRouterForTesting(() => {
    factories += 1;
    return runtime;
  });

  assert.equal((await startEmbeddedNineRouter()).state, 'ready');
  assert.equal((await restartEmbeddedNineRouter()).version, '1.0.1');
  assert.equal(getEmbeddedNineRouterStatus().state, 'ready');
  await stopEmbeddedNineRouter();

  assert.equal(factories, 1);
  assert.deepEqual(calls, ['start', 'restart', 'status', 'stop']);
});
