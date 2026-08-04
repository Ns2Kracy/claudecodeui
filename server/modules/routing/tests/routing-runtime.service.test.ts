import assert from 'node:assert/strict';
import test from 'node:test';

import { AppError } from '@/shared/utils.js';

import { createRoutingRuntimeService } from '../routing-runtime.service.js';

function createHarness() {
  const state = {
    connection: {
      userId: 7,
      baseUrl: 'https://router.example',
      adminSecretCiphertext: 'sealed-admin',
      dataPlaneKeyCiphertext: 'sealed-key',
      upstreamVersion: '0.5.45',
      capabilities: null,
      lastCheckedAt: null,
      lastErrorCode: null,
    } as null | {
      userId: number;
      baseUrl: string;
      adminSecretCiphertext: string;
      dataPlaneKeyCiphertext: string;
      upstreamVersion: string | null;
      capabilities: null;
      lastCheckedAt: string | null;
      lastErrorCode: string | null;
    },
    sessionBinding: null as null | {
      provider: 'claude' | 'codex' | 'cursor' | 'opencode';
      source: 'native' | '9router';
      routeId: string | null;
      routeName: string | null;
    },
    snapshotCalls: [] as Array<{ userId: number; sessionId: string; provider: string }>,
    openCalls: [] as Array<{ userId: number; purpose: string; envelope: string }>,
    clientFactoryCalls: 0,
    routeCalls: [] as string[],
  };

  const repository = {
    getConnection: () => state.connection,
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
  const secretStore = {
    available: true,
    seal: () => 'unused',
    open: (userId: number, purpose: 'admin-password' | 'data-plane-key', envelope: string) => {
      state.openCalls.push({ userId, purpose, envelope });
      return purpose === 'admin-password' ? 'decrypted-admin' : 'decrypted-runtime-key';
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
    secretStore,
    clientFactory: () => {
      state.clientFactoryCalls += 1;
      return client;
    },
  });

  return { state, repository, secretStore, client, service };
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
  assert.equal(harness.state.openCalls.length, 0);
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
    baseUrl: 'https://router.example',
    openAiBaseUrl: 'https://router.example/v1',
    apiKey: 'decrypted-runtime-key',
    routeId: 'route-1',
    routeName: 'renamed-current-route',
  });
  assert.deepEqual(
    harness.state.openCalls.map((call) => call.purpose),
    ['admin-password', 'data-plane-key'],
  );
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
    throw new Error('failed with decrypted-runtime-key and decrypted-admin');
  };

  await assert.rejects(
    () => harness.service.resolveForRun(7, 'session-error', 'claude'),
    (error: unknown) => {
      assert.ok(error instanceof AppError);
      assert.equal(error.code, 'ROUTING_OPERATION_FAILED');
      assert.equal(error.message.includes('decrypted-runtime-key'), false);
      assert.equal(error.message.includes('decrypted-admin'), false);
      return true;
    },
  );
});
