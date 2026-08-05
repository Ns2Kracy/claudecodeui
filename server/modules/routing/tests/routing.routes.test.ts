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
    createProviderNode: async (_userId, input) => { calls.push(`nodes:create:${input.name}`); return { id: 'node1', name: input.name, baseUrl: input.baseUrl, active: true, createdAt: null, updatedAt: null }; },
    validateProviderNode: async () => { calls.push('nodes:validate'); return { valid: true, message: null }; },
    updateProviderNode: async (_userId, id) => { calls.push(`nodes:update:${id}`); return { id, name: 'n', baseUrl: 'https://node.test', active: true, createdAt: null, updatedAt: null }; },
    deleteProviderNode: async (_userId, id) => { calls.push(`nodes:delete:${id}`); },
  }, async (baseUrl) => {
    const headers = { 'content-type': 'application/json', origin: baseUrl };
    assert.equal((await fetch(`${baseUrl}/api/routing/accounts/a%2Fb`)).status, 200);
    assert.equal((await fetch(`${baseUrl}/api/routing/accounts/a%2Fb/models`)).status, 200);
    assert.equal((await fetch(`${baseUrl}/api/routing/provider-nodes`)).status, 200);
    assert.equal((await fetch(`${baseUrl}/api/routing/provider-nodes`, { method: 'POST', headers, body: JSON.stringify({ name: 'n', baseUrl: 'https://node.test' }) })).status, 200);
    assert.equal((await fetch(`${baseUrl}/api/routing/provider-nodes/validations`, { method: 'POST', headers, body: JSON.stringify({ baseUrl: 'https://node.test' }) })).status, 200);
    assert.equal((await fetch(`${baseUrl}/api/routing/provider-nodes/node%2F1`, { method: 'PUT', headers, body: JSON.stringify({ active: false }) })).status, 200);
    assert.equal((await fetch(`${baseUrl}/api/routing/provider-nodes/node%2F1`, { method: 'DELETE', headers })).status, 200);
    assert.deepEqual(calls, ['provider:a/b', 'models:a/b', 'nodes:list', 'nodes:create:n', 'nodes:validate', 'nodes:update:node/1', 'nodes:delete:node/1']);
  });
});
