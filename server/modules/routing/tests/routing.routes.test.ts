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
