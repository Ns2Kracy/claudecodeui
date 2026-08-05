import assert from 'node:assert/strict';
import test from 'node:test';

import { AppError } from '@/shared/utils.js';

import { createRoutingRuntimeService } from '../routing-runtime.service.js';

function createHarness() {
  const state = {
    sessionBinding: null as null | {
      provider: 'claude' | 'codex' | 'cursor' | 'opencode';
      source: 'native' | '9router';
      routeId: string | null;
      routeName: string | null;
    },
    snapshotCalls: [] as Array<{ userId: number; sessionId: string; provider: string }>,
    credentialReads: 0,
    clientFactoryCalls: 0,
    routeCalls: [] as string[],
  };

  const repository = {
    getConnection: () => null,
    upsertConnection: () => undefined,
    deleteConnectionAndSettings: () => undefined,
    listConnectionUserIds: () => [],
    getProviderDefaults: () => [],
    getProviderDefault: () => null,
    setProviderDefault: () => undefined,
    snapshotSessionBinding: (userId: number, sessionId: string, provider: typeof state.sessionBinding extends infer _T ? 'claude' | 'codex' | 'cursor' | 'opencode' : never) => {
      state.snapshotCalls.push({ userId, sessionId, provider });
      state.sessionBinding ??= {
        provider,
        source: 'native',
        routeId: null,
        routeName: null,
      };
      return state.sessionBinding;
    },
    getSessionBinding: () => state.sessionBinding,
    deleteSessionBinding: () => undefined,
    listAlerts: () => [],
    upsertAlert: () => undefined,
    markAlertNotified: () => undefined,
  };
  const runtime = {
    getStatus: () => ({ state: 'ready' as const, origin: 'http://127.0.0.1:20128', version: '0.5.45', lastError: null }),
    getInternalCredentials: () => {
      state.credentialReads += 1;
      return { jwtSecret: 'jwt', initialPassword: 'embedded-admin', apiKeySecret: 'hmac-secret', dataPlaneKey: 'embedded-runtime-key', machineIdSalt: 'salt', dataDir: '/db/9router' };
    },
  };
  const client = {
    getRoute: async (routeId: string) => {
      state.routeCalls.push(routeId);
      return {
        id: routeId,
        name: 'renamed-current-route',
        kind: 'fallback',
        models: ['openai/gpt-5'],
      };
    },
  };
  const service = createRoutingRuntimeService({
    repository,
    runtime,
    clientFactory: () => {
      state.clientFactoryCalls += 1;
      return client;
    },
  });

  return { state, repository, runtime, client, service };
}

test('snapshots provider defaults through the user-scoped repository', async () => {
  const harness = createHarness();

  await harness.service.snapshotSessionBinding(7, 'session-1', 'claude');

  assert.deepEqual(harness.state.snapshotCalls, [
    { userId: 7, sessionId: 'session-1', provider: 'claude' },
  ]);
});

test('missing and native session bindings resolve native without decrypting', async () => {
  const harness = createHarness();
  harness.state.sessionBinding = null;

  assert.deepEqual(
    await harness.service.resolveForRun(7, 'session-missing', 'claude'),
    { source: 'native' },
  );
  harness.state.sessionBinding = {
    provider: 'claude',
    source: 'native',
    routeId: null,
    routeName: null,
  };
  assert.deepEqual(
    await harness.service.resolveForRun(7, 'session-native', 'claude'),
    { source: 'native' },
  );
  assert.equal(harness.state.credentialReads, 0);
  assert.equal(harness.state.clientFactoryCalls, 0);
});

test('router sessions decrypt only at run time and refresh the route name by stable ID', async () => {
  const harness = createHarness();
  harness.state.sessionBinding = {
    provider: 'claude',
    source: '9router',
    routeId: 'route-1',
    routeName: 'stale-route-name',
  };

  const configuration = await harness.service.resolveForRun(7, 'session-router', 'claude');

  assert.deepEqual(configuration, {
    source: '9router',
    baseUrl: 'http://127.0.0.1:20128',
    openAiBaseUrl: 'http://127.0.0.1:20128/v1',
    apiKey: 'embedded-runtime-key',
    routeId: 'route-1',
    routeName: 'renamed-current-route',
  });
  assert.equal(harness.state.credentialReads, 1);
  assert.deepEqual(harness.state.routeCalls, ['route-1']);
});

test('rejects routed Cursor sessions and provider-mismatched snapshots', async () => {
  const harness = createHarness();
  harness.state.sessionBinding = {
    provider: 'cursor',
    source: '9router',
    routeId: 'route-1',
    routeName: 'quality-first',
  };
  await assert.rejects(
    () => harness.service.resolveForRun(7, 'session-cursor', 'cursor'),
    (error: unknown) =>
      error instanceof AppError && error.code === 'ROUTING_RUNTIME_UNSUPPORTED',
  );

  harness.state.sessionBinding = {
    provider: 'claude',
    source: '9router',
    routeId: 'route-1',
    routeName: 'quality-first',
  };
  assert.deepEqual(
    await harness.service.resolveForRun(7, 'session-mismatch', 'codex'),
    { source: 'native' },
  );
});

test('sanitizes unexpected runtime failures without exposing decrypted values', async () => {
  const harness = createHarness();
  harness.state.sessionBinding = {
    provider: 'claude',
    source: '9router',
    routeId: 'route-1',
    routeName: 'quality-first',
  };
  harness.client.getRoute = async () => {
    throw new Error('failed with embedded-runtime-key and embedded-admin');
  };

  await assert.rejects(
    () => harness.service.resolveForRun(7, 'session-error', 'claude'),
    (error: unknown) => {
      assert.ok(error instanceof AppError);
      assert.equal(error.code, 'ROUTING_OPERATION_FAILED');
      assert.equal(error.message.includes('embedded-runtime-key'), false);
      assert.equal(error.message.includes('embedded-admin'), false);
      return true;
    },
  );
});
