import assert from 'node:assert/strict';
import test from 'node:test';

import { emptyRoutingSettingsView } from '../../../../shared/routing.js';
import { createRoutingService } from '../routing.service.js';

function createHarness(state: 'ready' | 'unavailable' = 'ready') {
  const calls: string[] = [];
  const repository = {
    getConnection: () => null,
    upsertConnection: () => undefined,
    deleteConnectionAndSettings: () => undefined,
    listConnectionUserIds: () => [],
    getProviderDefaults: () => [],
    getProviderDefault: () => null,
    setProviderDefault: (_userId: number, provider: 'claude', binding: { source: 'native' | '9router'; routeId?: string | null; routeName?: string | null }) => {
      calls.push(`${provider}:${binding.source}:${binding.routeId ?? ''}`);
    },
    snapshotSessionBinding: () => ({ provider: 'claude' as const, source: 'native' as const, routeId: null, routeName: null }),
    getSessionBinding: () => null,
    deleteSessionBinding: () => undefined,
    listAlerts: () => [],
    upsertAlert: () => undefined,
    markAlertNotified: () => undefined,
  };
  const client = {
    validateConnection: async () => { throw new Error('unused'); },
    listModels: async () => [{ id: 'm1', provider: 'openai', name: 'M1' }],
    getProvider: async (id: string) => ({ id, provider: 'openai', name: 'Primary', authType: 'oauth', priority: null, active: true, status: 'healthy' as const, lastError: null, expiresAt: null }),
    listProviderModels: async (id: string) => ({ provider: 'openai', connectionId: id, models: [{ id: 'openai/gpt-4o', provider: 'openai', name: 'GPT-4o' }] }),
    startOAuth: async () => ({ provider: 'codex', authUrl: 'https://example.test/auth', state: 'state', redirectUri: 'http://localhost/callback', codeVerifier: 'verifier' }),
    exchangeOAuth: async () => ({ id: 'a3', provider: 'codex', name: 'Codex', authType: 'oauth', priority: null, active: true, status: 'healthy' as const, lastError: null, expiresAt: null }),
    startDeviceCode: async () => ({ provider: 'codex', deviceCode: 'device', codeVerifier: 'verifier', userCode: 'ABCD', verificationUri: 'https://example.test/device', verificationUriComplete: null, expiresIn: null, interval: null }),
    pollDeviceCode: async () => ({ provider: 'codex', pending: true, account: null }),
    listProviderNodes: async () => [{ id: 'node1', type: 'openai-compatible' as const, name: 'Local', prefix: 'openai', baseUrl: 'https://node.test', apiType: 'chat' as const, createdAt: null, updatedAt: null }],
    createProviderNode: async (input: any) => ({ id: 'node2', type: input.type, name: input.name, prefix: input.prefix, baseUrl: input.baseUrl ?? 'https://node.test', apiType: input.apiType ?? null, createdAt: null, updatedAt: null }),
    validateProviderNode: async () => ({ valid: true, message: null }),
    updateProviderNode: async (id: string, input: any) => ({ id, type: 'openai-compatible' as const, name: input.name, prefix: input.prefix, baseUrl: input.baseUrl, apiType: input.apiType ?? null, createdAt: null, updatedAt: null }),
    deleteProviderNode: async () => undefined,
    listAccounts: async () => [{ id: 'a1', provider: 'openai', name: 'Primary', authType: 'apikey', priority: 1, active: true, status: 'healthy' as const, lastError: null, expiresAt: null }],
    createApiKeyAccount: async (input: any) => ({ id: 'a2', provider: input.provider, name: input.name, authType: 'apikey', priority: input.priority ?? null, active: input.active ?? true, status: 'unknown' as const, lastError: null, expiresAt: null }),
    updateAccount: async (id: string) => ({ id, provider: 'openai', name: 'Updated', authType: 'apikey', priority: null, active: true, status: 'healthy' as const, lastError: null, expiresAt: null }),
    deleteAccount: async () => undefined,
    testAccount: async () => ({ healthy: true, error: null, refreshed: false }),
    listRoutes: async () => [{ id: 'r1', name: 'quality-first', kind: 'fallback', models: ['m1'] }],
    getRoute: async (id: string) => ({ id, name: 'quality-first', kind: 'fallback', models: ['m1'] }),
    createRoute: async (input: any) => ({ id: 'r2', name: input.name, kind: input.kind ?? null, models: input.models }),
    updateRoute: async (id: string, input: any) => ({ id, name: input.name ?? 'quality-first', kind: input.kind ?? null, models: input.models ?? ['m1'] }),
    deleteRoute: async () => undefined,
    getUsage: async (period: 'today' | '7d' | '30d') => ({ period, requests: 1, promptTokens: 2, completionTokens: 3, estimatedCostMicrousd: 4, byProvider: [], staleAt: null }),
  };
  const runtime = {
    getStatus: () => ({ state, origin: 'http://127.0.0.1:20128', version: '0.5.45', lastError: state === 'ready' ? null : { code: 'ROUTING_STARTUP_TIMEOUT' as const, message: 'startup timed out', retryable: true } }),
    getInternalCredentials: () => ({ jwtSecret: 'jwt', initialPassword: 'admin', apiKeySecret: 'hmac-secret', dataPlaneKey: 'sk-cloudcli-abc123-deadbeef', machineIdSalt: 'salt', dataDir: '/db/9router' }),
    restart: async () => undefined,
  };
  const service = createRoutingService({ repository, runtime, clientFactory: () => { calls.push('client'); return client; }, now: () => new Date('2026-08-04T00:00:00.000Z') });
  return { service, calls };
}

test('settings report embedded runtime without connection storage', async () => {
  const { service, calls } = createHarness('ready');
  const settings = await service.getSettings(7, { accounts: true, models: true, routes: true, usage: 'today' });
  assert.equal(settings.runtime.mode, 'embedded');
  assert.equal(settings.runtime.status, 'ready');
  assert.equal(settings.runtime.version, '0.5.45');
  assert.equal('connection' in settings, false);
  assert.equal(settings.accounts?.length, 1);
  assert.equal(settings.routes?.length, 1);
  assert.equal(settings.models?.length, 1);
  assert.equal(settings.usage?.requests, 1);
  assert.deepEqual(settings.runtime.capabilities.cursorRuntime, false);
  assert.equal(calls.includes('client'), true);
});

test('management operations use supervisor credentials and do not require a connection row', async () => {
  const { service, calls } = createHarness('ready');
  const binding = await service.setProviderBinding(7, 'claude', { source: '9router', routeId: 'r1' });
  assert.equal(binding.routeName, 'quality-first');
  assert.deepEqual(calls, ['client', 'claude:9router:r1']);
});

test('unavailable embedded runtime is safe and typed for explicit 9router operations', async () => {
  const { service } = createHarness('unavailable');
  const settings = await service.getSettings(7, { accounts: true });
  assert.equal(settings.runtime.status, 'unavailable');
  assert.deepEqual(settings.runtime.capabilities, emptyRoutingSettingsView().runtime.capabilities);
  await assert.rejects(
    () => service.listAccounts(7),
    (error: any) => error.code === 'ROUTING_RUNTIME_UNAVAILABLE' && error.statusCode === 409,
  );
});

test('provider management workflows delegate through sanitized 9router client contract', async () => {
  const { service } = createHarness('ready');
  assert.deepEqual(await service.getProvider(7, 'a1'), { id: 'a1', provider: 'openai', name: 'Primary', authType: 'oauth', priority: null, active: true, status: 'healthy', lastError: null, expiresAt: null });
  assert.deepEqual(await service.listProviderModels(7, 'a1'), { provider: 'openai', connectionId: 'a1', models: [{ id: 'openai/gpt-4o', provider: 'openai', name: 'GPT-4o' }] });
  assert.equal((await service.listProviderNodes(7))[0].id, 'node1');
});
