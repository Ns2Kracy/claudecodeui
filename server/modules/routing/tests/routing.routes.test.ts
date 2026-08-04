import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import test from 'node:test';

import express, {
  type NextFunction,
  type Request,
  type Response,
} from 'express';

import { AppError } from '@/shared/utils.js';

import { emptyRoutingSettingsView } from '../../../../shared/routing.js';
import { createRoutingRouter } from '../routing.routes.js';
import type { createRoutingService } from '../routing.service.js';

type RoutingService = ReturnType<typeof createRoutingService>;

function createFakeService(overrides: Partial<RoutingService> = {}): RoutingService {
  const unexpected = async (): Promise<never> => {
    throw new Error('Unexpected routing service call');
  };
  return {
    getSettings: unexpected,
    connect: unexpected,
    validateConnection: unexpected,
    disconnect: unexpected,
    setProviderBinding: unexpected,
    listModels: unexpected,
    listAccounts: unexpected,
    createApiKeyAccount: unexpected,
    updateAccount: unexpected,
    deleteAccount: unexpected,
    testAccount: unexpected,
    listRoutes: unexpected,
    getRoute: unexpected,
    createRoute: unexpected,
    updateRoute: unexpected,
    deleteRoute: unexpected,
    getUsage: unexpected,
    setUsageAlert: unexpected,
    ...overrides,
  } as RoutingService;
}

async function withRoutingServer(
  service: RoutingService,
  runTest: (baseUrl: string) => Promise<void>,
): Promise<void> {
  const app = express();
  app.use(express.json());
  app.use((request, _response, next) => {
    (request as Request & { user?: { id: number } }).user = { id: 7 };
    next();
  });
  app.use('/api/routing', createRoutingRouter(service));
  app.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
    if (error instanceof AppError) {
      response.status(error.statusCode).json({
        success: false,
        error: {
          code: error.code,
          message: error.message,
          details: error.details,
        },
      });
      return;
    }
    response.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Internal server error' },
    });
  });

  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const address = server.address() as AddressInfo;
    await runTest(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

function jsonHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return { 'content-type': 'application/json', ...extra };
}

test('aggregate GET returns the standard envelope and parses allowlisted details', async () => {
  const calls: unknown[][] = [];
  const settings = emptyRoutingSettingsView();
  const service = createFakeService({
    getSettings: async (...args) => {
      calls.push(args);
      return settings;
    },
  });

  await withRoutingServer(service, async (baseUrl) => {
    const response = await fetch(
      `${baseUrl}/api/routing?details=accounts,routes,usage&period=7d`,
    );
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { success: true, data: settings });
  });
  assert.deepEqual(calls, [[7, { accounts: true, routes: true, usage: '7d' }]]);
});

test('connection mutations forward typed fields and never echo submitted secrets', async () => {
  const inputs: unknown[][] = [];
  const safeConnection = {
    ...emptyRoutingSettingsView().connection,
    configured: true,
    baseUrl: 'https://router.example',
    status: 'connected' as const,
    hasAdminCredential: true,
    hasDataPlaneKey: true,
  };
  const service = createFakeService({
    connect: async (...args) => {
      inputs.push(args);
      return safeConnection;
    },
  });

  await withRoutingServer(service, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/routing/connection`, {
      method: 'PUT',
      headers: jsonHeaders({ origin: baseUrl }),
      body: JSON.stringify({
        baseUrl: 'https://router.example/v1',
        adminPassword: 'submitted-admin-secret',
        dataPlaneKey: 'submitted-data-key',
        ignoredField: 'must-not-forward',
      }),
    });
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(JSON.stringify(payload).includes('submitted-admin-secret'), false);
    assert.equal(JSON.stringify(payload).includes('submitted-data-key'), false);
  });
  assert.deepEqual(inputs, [[
    7,
    {
      baseUrl: 'https://router.example/v1',
      adminPassword: 'submitted-admin-secret',
      dataPlaneKey: 'submitted-data-key',
    },
  ]]);
});

test('typed account, route, binding, and alert mutations reach the service', async () => {
  const calls: Array<{ operation: string; args: unknown[] }> = [];
  const service = createFakeService({
    createApiKeyAccount: async (...args) => {
      calls.push({ operation: 'account', args });
      return {
        id: 'account-1', provider: 'openai', name: 'Primary', authType: 'apikey',
        priority: 2, active: true, status: 'unknown', lastError: null, expiresAt: null,
      };
    },
    createRoute: async (...args) => {
      calls.push({ operation: 'route', args });
      return { id: 'route-1', name: 'quality-first', kind: null, models: ['openai/gpt-5'] };
    },
    setProviderBinding: async (...args) => {
      calls.push({ operation: 'binding', args });
      return {
        provider: 'claude', source: '9router', routeId: 'route-1',
        routeName: 'quality-first', supported: true,
      };
    },
    setUsageAlert: async (...args) => {
      calls.push({ operation: 'alert', args });
      return { period: 'daily', enabled: true, thresholdMicrousd: 5_000_000 };
    },
  });

  await withRoutingServer(service, async (baseUrl) => {
    const headers = jsonHeaders({ origin: baseUrl });
    const requests = [
      fetch(`${baseUrl}/api/routing/accounts`, {
        method: 'POST', headers,
        body: JSON.stringify({ provider: 'openai', name: 'Primary', apiKey: 'key', priority: 2 }),
      }),
      fetch(`${baseUrl}/api/routing/routes`, {
        method: 'POST', headers,
        body: JSON.stringify({ name: 'quality-first', models: ['openai/gpt-5'] }),
      }),
      fetch(`${baseUrl}/api/routing/bindings/providers/claude`, {
        method: 'PUT', headers,
        body: JSON.stringify({ source: '9router', routeId: 'route-1' }),
      }),
      fetch(`${baseUrl}/api/routing/usage-alerts/daily`, {
        method: 'PUT', headers,
        body: JSON.stringify({ enabled: true, thresholdMicrousd: 5_000_000 }),
      }),
    ];
    for (const response of await Promise.all(requests)) {
      assert.equal(response.status, 200);
    }
  });

  assert.deepEqual(calls, [
    { operation: 'account', args: [7, { provider: 'openai', name: 'Primary', apiKey: 'key', priority: 2 }] },
    { operation: 'route', args: [7, { name: 'quality-first', models: ['openai/gpt-5'] }] },
    { operation: 'binding', args: [7, 'claude', { source: '9router', routeId: 'route-1' }] },
    { operation: 'alert', args: [7, 'daily', { enabled: true, thresholdMicrousd: 5_000_000 }] },
  ]);
});

test('rejects cross-origin mutations and accepts same-origin or non-browser requests', async () => {
  let disconnectCalls = 0;
  const service = createFakeService({
    disconnect: async () => {
      disconnectCalls += 1;
    },
  });

  await withRoutingServer(service, async (baseUrl) => {
    const crossOrigin = await fetch(`${baseUrl}/api/routing/connection`, {
      method: 'DELETE',
      headers: { origin: 'https://attacker.example' },
    });
    assert.equal(crossOrigin.status, 403);

    const crossSite = await fetch(`${baseUrl}/api/routing/connection`, {
      method: 'DELETE',
      headers: { 'sec-fetch-site': 'cross-site' },
    });
    assert.equal(crossSite.status, 403);

    const sameOrigin = await fetch(`${baseUrl}/api/routing/connection`, {
      method: 'DELETE',
      headers: { origin: baseUrl },
    });
    assert.equal(sameOrigin.status, 200);

    const nonBrowser = await fetch(`${baseUrl}/api/routing/connection`, {
      method: 'DELETE',
    });
    assert.equal(nonBrowser.status, 200);
  });
  assert.equal(disconnectCalls, 2);
});

test('limits connection validation to five requests per user per minute', async () => {
  let validationCalls = 0;
  const service = createFakeService({
    validateConnection: async () => {
      validationCalls += 1;
      return emptyRoutingSettingsView().connection;
    },
  });

  await withRoutingServer(service, async (baseUrl) => {
    for (let index = 0; index < 6; index += 1) {
      const response = await fetch(`${baseUrl}/api/routing/connection/validations`, {
        method: 'POST',
        headers: jsonHeaders({ origin: baseUrl }),
        body: JSON.stringify({
          baseUrl: 'https://router.example',
          adminPassword: 'admin',
          dataPlaneKey: 'key',
        }),
      });
      assert.equal(response.status, index < 5 ? 200 : 429);
    }
  });
  assert.equal(validationCalls, 5);
});

test('limits ordinary writes to thirty requests per user per minute', async () => {
  let disconnectCalls = 0;
  const service = createFakeService({
    disconnect: async () => {
      disconnectCalls += 1;
    },
  });

  await withRoutingServer(service, async (baseUrl) => {
    for (let index = 0; index < 31; index += 1) {
      const response = await fetch(`${baseUrl}/api/routing/connection`, {
        method: 'DELETE',
        headers: { origin: baseUrl },
      });
      assert.equal(response.status, index < 30 ? 200 : 429);
    }
  });
  assert.equal(disconnectCalls, 30);
});

test('passes dynamic IDs decoded exactly once as values', async () => {
  const ids: string[] = [];
  const service = createFakeService({
    deleteAccount: async (_userId, id) => {
      ids.push(id);
    },
  });

  await withRoutingServer(service, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/routing/accounts/account%252Fid`, {
      method: 'DELETE',
      headers: { origin: baseUrl },
    });
    assert.equal(response.status, 200);
  });
  assert.deepEqual(ids, ['account%2Fid']);
});

test('preserves explicit nullable route fields in typed mutations', async () => {
  const calls: unknown[][] = [];
  const service = createFakeService({
    updateRoute: async (...args) => {
      calls.push(args);
      return { id: 'route-1', name: 'route', kind: null, models: [] };
    },
    setProviderBinding: async (...args) => {
      calls.push(args);
      return {
        provider: 'claude', source: 'native', routeId: null,
        routeName: null, supported: true,
      };
    },
  });

  await withRoutingServer(service, async (baseUrl) => {
    const headers = jsonHeaders({ origin: baseUrl });
    const routeResponse = await fetch(`${baseUrl}/api/routing/routes/route-1`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({ kind: null }),
    });
    const bindingResponse = await fetch(
      `${baseUrl}/api/routing/bindings/providers/claude`,
      {
        method: 'PUT',
        headers,
        body: JSON.stringify({ source: 'native', routeId: null }),
      },
    );
    assert.equal(routeResponse.status, 200);
    assert.equal(bindingResponse.status, 200);
  });
  assert.deepEqual(calls, [
    [7, 'route-1', { kind: null }],
    [7, 'claude', { source: 'native', routeId: null }],
  ]);
});

test('forwards service AppErrors to the standard error middleware', async () => {
  const service = createFakeService({
    getSettings: async () => {
      throw new AppError('safe routing error', {
        code: 'ROUTING_TEST_ERROR',
        statusCode: 418,
      });
    },
  });

  await withRoutingServer(service, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/routing`);
    assert.equal(response.status, 418);
    assert.deepEqual(await response.json(), {
      success: false,
      error: {
        code: 'ROUTING_TEST_ERROR',
        message: 'safe routing error',
      },
    });
  });
});
