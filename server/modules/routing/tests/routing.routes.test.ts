import assert from 'node:assert/strict';
import { once } from 'node:events';
import http from 'node:http';
import test from 'node:test';

import express from 'express';

import { AppError } from '@/shared/utils.js';

import { emptyRoutingSettingsView } from '../../../../shared/routing.js';
import { createRoutingRouter } from '../routing.routes.js';
import { createRoutingService } from '../routing.service.js';

type Service = ReturnType<typeof createRoutingService>;

async function withRoutingServer(service: Partial<Service>, run: (baseUrl: string) => Promise<void>) {
  const app = express();
  app.use(express.json());
  app.use((request, _response, next) => {
    (request as any).user = { id: 7 };
    next();
  });
  app.use('/api/routing', createRoutingRouter(service as Service));
  app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
    if (error instanceof AppError) {
      response.status(error.statusCode).json({ success: false, error: { code: error.code, message: error.message } });
      return;
    }
    response.status(500).json({ success: false });
  });
  const server = http.createServer(app);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const address = server.address();
    assert.equal(typeof address, 'object');
    await run(`http://127.0.0.1:${(address as any).port}`);
  } finally {
    server.close();
    await once(server, 'close');
  }
}

test('aggregate GET returns runtime contract and allowlisted details', async () => {
  await withRoutingServer({
    getSettings: async (_userId, details = {}) => ({ ...emptyRoutingSettingsView(), runtime: { ...emptyRoutingSettingsView().runtime, status: 'ready' }, accounts: details.accounts ? [] : undefined }),
  }, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/routing?details=accounts`);
    assert.equal(response.status, 200);
    const body = await response.json() as any;
    assert.equal(body.success, true);
    assert.equal(body.data.runtime.mode, 'embedded');
    assert.equal('connection' in body.data, false);
    assert.deepEqual(body.data.accounts, []);
  });
});

test('authenticated runtime restart route calls service workflow', async () => {
  let calls = 0;
  await withRoutingServer({
    restartRuntime: async () => {
      calls += 1;
      return { ...emptyRoutingSettingsView().runtime, status: 'starting' };
    },
  }, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/routing/runtime/restart`, { method: 'POST', headers: { origin: baseUrl } });
    assert.equal(response.status, 200);
    const body = await response.json() as any;
    assert.equal(body.data.status, 'starting');
    assert.equal(calls, 1);
  });
});

test('GET settings rejects invalid details and usage period inputs', async () => {
  await withRoutingServer({
    getSettings: async () => emptyRoutingSettingsView(),
  }, async (baseUrl) => {
    assert.equal((await fetch(`${baseUrl}/api/routing?details=connection`)).status, 400);
    assert.equal((await fetch(`${baseUrl}/api/routing?details=usage&period=year`)).status, 400);
  });
});

test('mutation guard rejects cross-origin routing writes before service calls', async () => {
  let calls = 0;
  await withRoutingServer({
    restartRuntime: async () => { calls += 1; return emptyRoutingSettingsView().runtime; },
  }, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/routing/runtime/restart`, { method: 'POST', headers: { origin: 'https://attacker.example' } });
    assert.equal(response.status, 403);
    assert.equal(calls, 0);
  });
});

test('write routes require authenticated user before service calls', async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/routing', createRoutingRouter({ restartRuntime: async () => emptyRoutingSettingsView().runtime } as Service));
  app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
    if (error instanceof AppError) response.status(error.statusCode).json({ success: false, error: { code: error.code } });
    else response.status(500).json({ success: false });
  });
  const server = http.createServer(app);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const address = server.address();
    assert.equal(typeof address, 'object');
    const baseUrl = `http://127.0.0.1:${(address as any).port}`;
    const response = await fetch(`${baseUrl}/api/routing/runtime/restart`, { method: 'POST', headers: { origin: baseUrl } });
    assert.equal(response.status, 401);
  } finally {
    server.close();
    await once(server, 'close');
  }
});

test('restart route applies per-user write rate limit', async () => {
  let calls = 0;
  await withRoutingServer({
    restartRuntime: async () => { calls += 1; return emptyRoutingSettingsView().runtime; },
  }, async (baseUrl) => {
    for (let i = 0; i < 30; i += 1) {
      assert.equal((await fetch(`${baseUrl}/api/routing/runtime/restart`, { method: 'POST', headers: { origin: baseUrl } })).status, 200);
    }
    assert.equal((await fetch(`${baseUrl}/api/routing/runtime/restart`, { method: 'POST', headers: { origin: baseUrl } })).status, 429);
    assert.equal(calls, 30);
  });
});

test('account, route, binding, and alert routes reject invalid inputs without service calls', async () => {
  await withRoutingServer({
    createApiKeyAccount: async () => { throw new Error('unexpected account call'); },
    createRoute: async () => { throw new Error('unexpected route call'); },
    setProviderBinding: async () => { throw new Error('unexpected binding call'); },
    setUsageAlert: async () => { throw new Error('unexpected alert call'); },
  }, async (baseUrl) => {
    const headers = { 'content-type': 'application/json', origin: baseUrl };
    assert.equal((await fetch(`${baseUrl}/api/routing/accounts`, { method: 'POST', headers, body: JSON.stringify({ provider: '', name: 'n', apiKey: 'k' }) })).status, 400);
    assert.equal((await fetch(`${baseUrl}/api/routing/routes`, { method: 'POST', headers, body: JSON.stringify({ name: 'bad name!', models: [] }) })).status, 400);
    assert.equal((await fetch(`${baseUrl}/api/routing/bindings/providers/not-real`, { method: 'PUT', headers, body: JSON.stringify({ source: 'native' }) })).status, 400);
    assert.equal((await fetch(`${baseUrl}/api/routing/bindings/providers/claude`, { method: 'PUT', headers, body: JSON.stringify({ source: 'bad' }) })).status, 400);
    assert.equal((await fetch(`${baseUrl}/api/routing/usage-alerts/yearly`, { method: 'PUT', headers, body: JSON.stringify({ enabled: true, thresholdMicrousd: 1 }) })).status, 400);
    assert.equal((await fetch(`${baseUrl}/api/routing/usage-alerts/daily`, { method: 'PUT', headers, body: JSON.stringify({ enabled: 'yes', thresholdMicrousd: 1 }) })).status, 400);
  });
});

test('connection mutation routes are removed', async () => {
  await withRoutingServer({}, async (baseUrl) => {
    for (const [method, path] of [['PUT', '/connection'], ['POST', '/connection/validations'], ['DELETE', '/connection']] as const) {
      const response = await fetch(`${baseUrl}/api/routing${path}`, { method, headers: { origin: baseUrl } });
      assert.equal(response.status, 404);
    }
  });
});

test('typed account, route, binding, and alert mutations reach service', async () => {
  const calls: string[] = [];
  await withRoutingServer({
    createApiKeyAccount: async () => { calls.push('account'); return { id: 'a1', provider: 'openai', name: 'n', authType: 'apikey', priority: null, active: true, status: 'unknown', lastError: null, expiresAt: null }; },
    createRoute: async () => { calls.push('route'); return { id: 'r1', name: 'quality', kind: null, models: [] }; },
    setProviderBinding: async () => { calls.push('binding'); return { provider: 'claude', source: 'native', routeId: null, routeName: null, supported: true }; },
    setUsageAlert: async () => { calls.push('alert'); return { period: 'daily', enabled: true, thresholdMicrousd: 1 }; },
  }, async (baseUrl) => {
    const headers = { 'content-type': 'application/json', origin: baseUrl };
    assert.equal((await fetch(`${baseUrl}/api/routing/accounts`, { method: 'POST', headers, body: JSON.stringify({ provider: 'openai', name: 'n', apiKey: 'k' }) })).status, 200);
    assert.equal((await fetch(`${baseUrl}/api/routing/routes`, { method: 'POST', headers, body: JSON.stringify({ name: 'quality', models: [] }) })).status, 200);
    assert.equal((await fetch(`${baseUrl}/api/routing/bindings/providers/claude`, { method: 'PUT', headers, body: JSON.stringify({ source: 'native' }) })).status, 200);
    assert.equal((await fetch(`${baseUrl}/api/routing/usage-alerts/daily`, { method: 'PUT', headers, body: JSON.stringify({ enabled: true, thresholdMicrousd: 1 }) })).status, 200);
    assert.deepEqual(calls, ['account', 'route', 'binding', 'alert']);
  });
});


test('provider detail, model, and provider-node routes are thin authenticated service calls', async () => {
  const calls: string[] = [];
  await withRoutingServer({
    getProvider: async (_userId, id) => { calls.push(`provider:${id}`); return { id, provider: 'openai', name: 'n', authType: 'oauth', priority: null, active: true, status: 'healthy', lastError: null, expiresAt: null }; },
    listProviderModels: async (_userId, id) => { calls.push(`models:${id}`); return { provider: 'openai', connectionId: id, models: [] }; },
    listProviderNodes: async () => { calls.push('nodes:list'); return []; },
    createProviderNode: async (_userId, input) => { calls.push(`nodes:create:${input.name}:${input.prefix}:${input.type}:${input.apiType ?? 'none'}`); return { id: 'node1', type: input.type, name: input.name, prefix: input.prefix, baseUrl: input.baseUrl ?? 'https://node.test', apiType: input.apiType ?? null, createdAt: null, updatedAt: null }; },
    validateProviderNode: async (_userId, input) => { calls.push(`nodes:validate:${input.type}:${input.apiKey}:${input.modelId ?? 'none'}`); return { valid: true, message: null }; },
    updateProviderNode: async (_userId, id, input) => { calls.push(`nodes:update:${id}:${input.name}:${input.prefix}:${input.baseUrl}:${input.apiType ?? 'none'}`); return { id, type: 'openai-compatible', name: input.name, prefix: input.prefix, baseUrl: input.baseUrl, apiType: input.apiType ?? null, createdAt: null, updatedAt: null }; },
    deleteProviderNode: async (_userId, id) => { calls.push(`nodes:delete:${id}`); },
  }, async (baseUrl) => {
    const headers = { 'content-type': 'application/json', origin: baseUrl };
    assert.equal((await fetch(`${baseUrl}/api/routing/accounts/a%2Fb`)).status, 200);
    assert.equal((await fetch(`${baseUrl}/api/routing/accounts/a%2Fb/models`)).status, 200);
    assert.equal((await fetch(`${baseUrl}/api/routing/provider-nodes`)).status, 200);
    assert.equal((await fetch(`${baseUrl}/api/routing/provider-nodes`, { method: 'POST', headers, body: JSON.stringify({ name: 'n', prefix: 'openai', type: 'openai-compatible', apiType: 'chat', baseUrl: 'https://node.test' }) })).status, 200);
    assert.equal((await fetch(`${baseUrl}/api/routing/provider-nodes/validations`, { method: 'POST', headers, body: JSON.stringify({ baseUrl: 'https://node.test', apiKey: 'k', type: 'custom-embedding', modelId: 'embed-1' }) })).status, 200);
    assert.equal((await fetch(`${baseUrl}/api/routing/provider-nodes/node%2F1`, { method: 'PUT', headers, body: JSON.stringify({ name: 'n2', prefix: 'openai', baseUrl: 'https://node.test', apiType: 'responses' }) })).status, 200);
    assert.equal((await fetch(`${baseUrl}/api/routing/provider-nodes/node%2F1`, { method: 'DELETE', headers })).status, 200);
    assert.deepEqual(calls, ['provider:a/b', 'models:a/b', 'nodes:list', 'nodes:create:n:openai:openai-compatible:chat', 'nodes:validate:custom-embedding:k:embed-1', 'nodes:update:node/1:n2:openai:https://node.test:responses', 'nodes:delete:node/1']);
  });
});

test('provider-node routes reject invalid DTOs and unsafe URL syntax before service calls', async () => {
  await withRoutingServer({
    createProviderNode: async () => { throw new Error('unexpected create'); },
    validateProviderNode: async () => { throw new Error('unexpected validate'); },
    updateProviderNode: async () => { throw new Error('unexpected update'); },
  }, async (baseUrl) => {
    const headers = { 'content-type': 'application/json', origin: baseUrl };
    assert.equal((await fetch(`${baseUrl}/api/routing/provider-nodes`, { method: 'POST', headers, body: JSON.stringify({ name: 'n', prefix: 'p', type: 'openai-compatible' }) })).status, 400);
    assert.equal((await fetch(`${baseUrl}/api/routing/provider-nodes`, { method: 'POST', headers, body: JSON.stringify({ name: 'n', prefix: 'p', type: 'custom-embedding', baseUrl: 'ftp://node.test' }) })).status, 400);
    assert.equal((await fetch(`${baseUrl}/api/routing/provider-nodes`, { method: 'POST', headers, body: JSON.stringify({ name: 'n', prefix: 'p', type: 'custom-embedding', baseUrl: 'https://user:pass@node.test' }) })).status, 400);
    assert.equal((await fetch(`${baseUrl}/api/routing/provider-nodes/validations`, { method: 'POST', headers, body: JSON.stringify({ baseUrl: 'https://node.test', type: 'custom-embedding', apiKey: 'k' }) })).status, 400);
    assert.equal((await fetch(`${baseUrl}/api/routing/provider-nodes/validations`, { method: 'POST', headers, body: JSON.stringify({ baseUrl: 'https://node.test#secret', type: 'anthropic-compatible', apiKey: 'k' }) })).status, 400);
    assert.equal((await fetch(`${baseUrl}/api/routing/provider-nodes/node1`, { method: 'PUT', headers, body: JSON.stringify({ name: 'n', prefix: 'p' }) })).status, 400);
  });
});

test('OAuth routes are thin, guarded, and never expose internal secrets', async () => {
  const calls: string[] = [];
  await withRoutingServer({
    startOAuth: async (_userId, provider) => { calls.push(`start:${provider}`); return { provider, transactionId: 'tx1', authUrl: 'https://auth.example.test', redirectUri: 'https://app.example.test/cb', expiresAt: '2026-01-01T00:00:00.000Z' }; },
    startDeviceCode: async (_userId, provider) => { calls.push(`device:${provider}`); return { provider, transactionId: 'tx2', userCode: 'USER', verificationUri: 'https://verify.example.test', verificationUriComplete: null, expiresAt: '2026-01-01T00:00:00.000Z', interval: 5 }; },
    exchangeOAuth: async (_userId, provider, input) => { calls.push(`exchange:${provider}:${input.transactionId}:${input.state}:${input.code}`); return { id: 'acct', provider, name: 'n', authType: 'oauth', priority: null, active: true, status: 'healthy', lastError: null, expiresAt: null }; },
    pollDeviceCode: async (_userId, provider, input) => { calls.push(`poll:${provider}:${input.transactionId}`); return { provider, pending: true, account: null }; },
    cancelDeviceCode: async (_userId, provider, input) => { calls.push(`cancel:${provider}:${input.transactionId}`); return { cancelled: true }; },
  }, async (baseUrl) => {
    const headers = { 'content-type': 'application/json', origin: baseUrl };
    const start = await fetch(`${baseUrl}/api/routing/oauth/openai/authorize`, { method: 'POST', headers });
    assert.equal(start.status, 200);
    const startBody = await start.json() as any;
    assert.deepEqual(Object.keys(startBody.data).sort(), ['authUrl', 'expiresAt', 'provider', 'redirectUri', 'transactionId'].sort());
    assert.equal((await fetch(`${baseUrl}/api/routing/oauth/Bad.Provider/authorize`, { method: 'POST', headers })).status, 400);
    assert.equal((await fetch(`${baseUrl}/api/routing/oauth/openai/callback?state=s&code=c`)).status, 404);
    assert.deepEqual(calls, ['start:openai']);
    assert.equal((await fetch(`${baseUrl}/api/routing/oauth/openai/callback`, { method: 'POST', headers, body: JSON.stringify({ transactionId: 'tx1', state: 'state1', code: 'code1', redirectUri: 'evil', codeVerifier: 'leak' }) })).status, 200);
    const device = await fetch(`${baseUrl}/api/routing/oauth/google/device-code`, { method: 'POST', headers });
    assert.equal(device.status, 200);
    const deviceBody = await device.json() as any;
    assert.deepEqual(Object.keys(deviceBody.data).sort(), ['expiresAt', 'interval', 'provider', 'transactionId', 'userCode', 'verificationUri', 'verificationUriComplete'].sort());
    assert.equal(JSON.stringify(deviceBody).includes('deviceCode'), false);
    assert.equal((await fetch(`${baseUrl}/api/routing/oauth/google/poll`, { method: 'POST', headers, body: JSON.stringify({ transactionId: 'tx2', deviceCode: 'leak' }) })).status, 200);
    assert.equal((await fetch(`${baseUrl}/api/routing/oauth/google/cancel`, { method: 'POST', headers, body: JSON.stringify({ transactionId: 'tx2' }) })).status, 200);
    assert.deepEqual(calls, ['start:openai', 'exchange:openai:tx1:state1:code1', 'device:google', 'poll:google:tx2', 'cancel:google:tx2']);
  });
});
