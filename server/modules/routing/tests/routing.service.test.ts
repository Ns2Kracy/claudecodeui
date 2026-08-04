import assert from 'node:assert/strict';
import test from 'node:test';

import { AppError } from '@/shared/utils.js';

import { emptyRoutingSettingsView } from '../../../../shared/routing.js';
import { createRoutingService } from '../routing.service.js';

function createHarness() {
  const state = {
    connection: null as null | {
      userId: number;
      baseUrl: string;
      adminSecretCiphertext: string;
      dataPlaneKeyCiphertext: string;
      upstreamVersion: string | null;
      capabilities: ReturnType<typeof emptyRoutingSettingsView>['connection']['capabilities'] | null;
      lastCheckedAt: string | null;
      lastErrorCode: string | null;
    },
    defaults: [] as Array<{
      provider: 'claude' | 'codex' | 'cursor' | 'opencode';
      source: 'native' | '9router';
      routeId: string | null;
      routeName: string | null;
    }>,
    alerts: [] as Array<{
      period: 'daily' | '30d';
      thresholdMicrousd: number;
      enabled: boolean;
      lastNotifiedPeriodKey: string | null;
    }>,
    persistedConnections: 0,
    deletedConnections: 0,
    clientFactoryCalls: 0,
    validationCalls: 0,
    sealCalls: [] as Array<{ userId: number; purpose: string; value: string }>,
    openCalls: [] as Array<{ userId: number; purpose: string; value: string }>,
    targetCalls: [] as string[],
    bindingWrites: [] as Array<{ provider: string; source: string; routeId?: string | null; routeName?: string | null }>,
  };

  const repository = {
    getConnection: () => state.connection,
    upsertConnection: (userId: number, connection: Omit<NonNullable<typeof state.connection>, 'userId'>) => {
      state.persistedConnections += 1;
      state.connection = { userId, ...connection };
    },
    deleteConnectionAndSettings: () => {
      state.deletedConnections += 1;
      state.connection = null;
      state.defaults = [];
      state.alerts = [];
    },
    listConnectionUserIds: () => (state.connection ? [state.connection.userId] : []),
    getProviderDefaults: () => state.defaults,
    getProviderDefault: (_userId: number, provider: string) =>
      state.defaults.find((binding) => binding.provider === provider) ?? null,
    setProviderDefault: (
      _userId: number,
      provider: typeof state.defaults[number]['provider'],
      binding: Omit<typeof state.defaults[number], 'provider'>,
    ) => {
      state.bindingWrites.push({ provider, ...binding });
      state.defaults = state.defaults.filter((item) => item.provider !== provider);
      state.defaults.push({ provider, ...binding });
    },
    snapshotSessionBinding: () => ({
      provider: 'claude' as const,
      source: 'native' as const,
      routeId: null,
      routeName: null,
    }),
    getSessionBinding: () => null,
    deleteSessionBinding: () => undefined,
    listAlerts: () => state.alerts,
    upsertAlert: (_userId: number, alert: Omit<typeof state.alerts[number], 'lastNotifiedPeriodKey'>) => {
      state.alerts = state.alerts.filter((item) => item.period !== alert.period);
      state.alerts.push({ ...alert, lastNotifiedPeriodKey: null });
    },
    markAlertNotified: () => undefined,
  };

  const client = {
    validateConnection: async () => {
      state.validationCalls += 1;
      return {
        version: '0.5.45',
        knownVersion: true,
        capabilities: {
          ...emptyRoutingSettingsView().connection.capabilities,
          readAccounts: true,
          writeApiKeyAccounts: true,
          testAccounts: true,
          readRoutes: true,
          writeRoutes: true,
          readUsage: true,
          claudeRuntime: true,
          codexRuntime: true,
          openCodeRuntime: true,
        },
      };
    },
    listModels: async () => [{ id: 'openai/gpt-5', provider: 'openai', name: 'GPT 5' }],
    listAccounts: async () => [
      {
        id: 'account-1',
        provider: 'openai',
        name: 'Primary',
        authType: 'apikey',
        priority: 1,
        active: true,
        status: 'healthy' as const,
        lastError: null,
        expiresAt: null,
      },
    ],
    createApiKeyAccount: async () => {
      throw new Error('unused');
    },
    updateAccount: async () => {
      throw new Error('unused');
    },
    deleteAccount: async () => undefined,
    testAccount: async () => ({ healthy: true, error: null, refreshed: false }),
    listRoutes: async () => [
      {
        id: 'route-1',
        name: 'quality-first',
        kind: 'fallback',
        models: ['openai/gpt-5'],
      },
    ],
    getRoute: async (id: string) => ({
      id,
      name: 'quality-first',
      kind: 'fallback',
      models: ['openai/gpt-5'],
    }),
    createRoute: async () => {
      throw new Error('unused');
    },
    updateRoute: async () => {
      throw new Error('unused');
    },
    deleteRoute: async () => undefined,
    getUsage: async (period: 'today' | '7d' | '30d') => ({
      period,
      requests: 1,
      promptTokens: 2,
      completionTokens: 3,
      estimatedCostMicrousd: 4,
      byProvider: [],
      staleAt: null,
    }),
  };

  const secretStore = {
    available: true,
    seal: (userId: number, purpose: 'admin-password' | 'data-plane-key', value: string) => {
      state.sealCalls.push({ userId, purpose, value });
      return `sealed:${purpose}:${value}`;
    },
    open: (userId: number, purpose: 'admin-password' | 'data-plane-key', value: string) => {
      state.openCalls.push({ userId, purpose, value });
      return value.replace(`sealed:${purpose}:`, '');
    },
  };

  const service = createRoutingService({
    repository,
    secretStore,
    validateTarget: async (baseUrl: string) => {
      state.targetCalls.push(baseUrl);
      return {
        origin: baseUrl.replace(/\/(?:api\/)?v1\/?$/, ''),
        protocol: 'https:' as const,
        hostname: 'router.example',
        port: 443,
        pinnedAddress: '93.184.216.34',
        family: 4 as const,
        loopback: false,
      };
    },
    clientFactory: () => {
      state.clientFactoryCalls += 1;
      return client;
    },
    now: () => new Date('2026-08-04T00:00:00.000Z'),
  });

  return { state, repository, client, secretStore, service };
}

test('unconfigured reads return safe native defaults without outbound calls', async () => {
  const { service, state } = createHarness();

  const settings = await service.getSettings(7, {});

  assert.deepEqual(settings.bindings, emptyRoutingSettingsView().bindings);
  assert.equal(settings.connection.configured, false);
  assert.equal(settings.connection.secureStorageAvailable, true);
  assert.equal(state.clientFactoryCalls, 0);
  assert.equal(state.openCalls.length, 0);
});

test('connection setup validates before encrypting and persisting', async () => {
  const { service, state } = createHarness();

  const connection = await service.connect(7, {
    baseUrl: 'https://router.example/v1',
    adminPassword: 'submitted-admin',
    dataPlaneKey: 'submitted-key',
  });

  assert.equal(connection.baseUrl, 'https://router.example');
  assert.equal(connection.hasAdminCredential, true);
  assert.equal(connection.hasDataPlaneKey, true);
  assert.equal(state.validationCalls, 1);
  assert.equal(state.persistedConnections, 1);
  assert.deepEqual(state.sealCalls, [
    { userId: 7, purpose: 'admin-password', value: 'submitted-admin' },
    { userId: 7, purpose: 'data-plane-key', value: 'submitted-key' },
  ]);
  assert.equal(JSON.stringify(connection).includes('submitted-admin'), false);
  assert.equal(JSON.stringify(connection).includes('submitted-key'), false);
});

test('failed connection validation persists and encrypts nothing', async () => {
  const harness = createHarness();
  harness.client.validateConnection = async () => {
    throw new AppError('safe validation failure', {
      code: 'ROUTING_AUTH_FAILED',
      statusCode: 401,
    });
  };

  await assert.rejects(
    () =>
      harness.service.connect(7, {
        baseUrl: 'https://router.example',
        adminPassword: 'bad-admin',
        dataPlaneKey: 'data-key',
      }),
    (error: unknown) => error instanceof AppError && error.code === 'ROUTING_AUTH_FAILED',
  );
  assert.equal(harness.state.persistedConnections, 0);
  assert.equal(harness.state.sealCalls.length, 0);
});

test('connection edits reuse omitted stored secrets and reject clearing required secrets', async () => {
  const harness = createHarness();
  harness.state.connection = {
    userId: 7,
    baseUrl: 'https://old-router.example',
    adminSecretCiphertext: 'sealed:admin-password:stored-admin',
    dataPlaneKeyCiphertext: 'sealed:data-plane-key:stored-key',
    upstreamVersion: '0.5.45',
    capabilities: null,
    lastCheckedAt: null,
    lastErrorCode: null,
  };

  await harness.service.connect(7, { baseUrl: 'https://router.example' });
  assert.deepEqual(
    harness.state.openCalls.map((call) => ({ purpose: call.purpose, value: call.value })),
    [
      { purpose: 'admin-password', value: 'sealed:admin-password:stored-admin' },
      { purpose: 'data-plane-key', value: 'sealed:data-plane-key:stored-key' },
    ],
  );
  assert.deepEqual(
    harness.state.sealCalls.map((call) => ({ purpose: call.purpose, value: call.value })),
    [
      { purpose: 'admin-password', value: 'stored-admin' },
      { purpose: 'data-plane-key', value: 'stored-key' },
    ],
  );

  await assert.rejects(
    () =>
      harness.service.connect(7, {
        baseUrl: 'https://router.example',
        clearAdminPassword: true,
      }),
    (error: unknown) =>
      error instanceof AppError && error.code === 'ROUTING_CREDENTIAL_REQUIRED',
  );
});

test('configured reads expose presence flags and optional safe details only', async () => {
  const harness = createHarness();
  harness.state.connection = {
    userId: 7,
    baseUrl: 'https://router.example',
    adminSecretCiphertext: 'sealed:admin-password:stored-admin',
    dataPlaneKeyCiphertext: 'sealed:data-plane-key:stored-key',
    upstreamVersion: '0.5.45',
    capabilities: {
      ...emptyRoutingSettingsView().connection.capabilities,
      readAccounts: true,
      readRoutes: true,
      readUsage: true,
    },
    lastCheckedAt: '2026-08-04T00:00:00.000Z',
    lastErrorCode: null,
  };

  const settings = await harness.service.getSettings(7, {
    accounts: true,
    routes: true,
    usage: 'today',
    models: true,
  });
  const serialized = JSON.stringify(settings);

  assert.equal(settings.connection.hasAdminCredential, true);
  assert.equal(settings.connection.hasDataPlaneKey, true);
  assert.equal(settings.accounts?.length, 1);
  assert.equal(settings.routes?.length, 1);
  assert.equal(settings.models?.length, 1);
  assert.equal(settings.usage?.period, 'today');
  assert.equal(serialized.includes('stored-admin'), false);
  assert.equal(serialized.includes('stored-key'), false);
  assert.equal(serialized.includes('ciphertext'), false);
});

test('disconnect removes only CloudCLI routing state without constructing a client', async () => {
  const harness = createHarness();
  harness.state.connection = {
    userId: 7,
    baseUrl: 'https://router.example',
    adminSecretCiphertext: 'sealed:admin-password:stored-admin',
    dataPlaneKeyCiphertext: 'sealed:data-plane-key:stored-key',
    upstreamVersion: '0.5.45',
    capabilities: null,
    lastCheckedAt: null,
    lastErrorCode: null,
  };

  await harness.service.disconnect(7);

  assert.equal(harness.state.deletedConnections, 1);
  assert.equal(harness.state.clientFactoryCalls, 0);
  assert.equal(harness.state.openCalls.length, 0);
});

test('Cursor rejects 9router while supported bindings resolve and store a real route', async () => {
  const harness = createHarness();
  harness.state.connection = {
    userId: 7,
    baseUrl: 'https://router.example',
    adminSecretCiphertext: 'sealed:admin-password:stored-admin',
    dataPlaneKeyCiphertext: 'sealed:data-plane-key:stored-key',
    upstreamVersion: '0.5.45',
    capabilities: {
      ...emptyRoutingSettingsView().connection.capabilities,
      claudeRuntime: true,
      readRoutes: true,
    },
    lastCheckedAt: null,
    lastErrorCode: null,
  };

  await assert.rejects(
    () => harness.service.setProviderBinding(7, 'cursor', { source: '9router', routeId: 'route-1' }),
    (error: unknown) =>
      error instanceof AppError && error.code === 'ROUTING_RUNTIME_UNSUPPORTED',
  );

  const binding = await harness.service.setProviderBinding(7, 'claude', {
    source: '9router',
    routeId: 'route-1',
  });
  assert.deepEqual(binding, {
    provider: 'claude',
    source: '9router',
    routeId: 'route-1',
    routeName: 'quality-first',
    supported: true,
  });
  assert.equal(harness.state.bindingWrites.at(-1)?.routeName, 'quality-first');
});

test('unknown-version write capability failures remain typed and are not bypassed', async () => {
  const harness = createHarness();
  harness.state.connection = {
    userId: 7,
    baseUrl: 'https://router.example',
    adminSecretCiphertext: 'sealed:admin-password:stored-admin',
    dataPlaneKeyCiphertext: 'sealed:data-plane-key:stored-key',
    upstreamVersion: '0.6.0',
    capabilities: emptyRoutingSettingsView().connection.capabilities,
    lastCheckedAt: null,
    lastErrorCode: null,
  };
  harness.client.createRoute = async () => {
    throw new AppError('unavailable', {
      code: 'ROUTING_CAPABILITY_UNAVAILABLE',
      statusCode: 409,
    });
  };

  await assert.rejects(
    () => harness.service.createRoute(7, { name: 'blocked', models: ['openai/gpt-5'] }),
    (error: unknown) =>
      error instanceof AppError && error.code === 'ROUTING_CAPABILITY_UNAVAILABLE',
  );
});
