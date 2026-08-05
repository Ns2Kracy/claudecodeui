import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import test from 'node:test';

import { AppError } from '@/shared/utils.js';

import { NineRouterClient } from '../nine-router-client.js';
import { requestNineRouterJson } from '../nine-router-http.js';

type FakeRouterOptions = {
  version?: unknown;
  password?: string;
  dataPlaneKey?: string;
  authMode?: 'password' | 'oidc';
};

type FakeRouterState = {
  loginCount: number;
  accountListCount: number;
  routeCreateCount: number;
  rejectNextAccountList: boolean;
  rejectNextRouteCreate: boolean;
  receivedBodies: Array<{ path: string; body: unknown }>;
  invalidPollPending?: boolean;
};

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
}

function sendJson(response: ServerResponse, statusCode: number, body: unknown): void {
  response.writeHead(statusCode, { 'content-type': 'application/json' });
  response.end(JSON.stringify(body));
}

function hasValidCookie(request: IncomingMessage, state: FakeRouterState): boolean {
  return request.headers.cookie === `auth_token=session-${state.loginCount}`;
}

async function withFakeRouter(
  options: FakeRouterOptions,
  runTest: (input: {
    baseUrl: string;
    request: typeof requestNineRouterJson;
    state: FakeRouterState;
  }) => Promise<void>,
): Promise<void> {
  const expectedPassword = options.password ?? 'admin-password';
  const expectedDataPlaneKey = options.dataPlaneKey ?? 'data-plane-key';
  const accounts = [
    {
      id: 'account-1',
      provider: 'openai',
      name: 'Primary',
      authType: 'apikey',
      priority: 1,
      isActive: true,
      testStatus: 'success',
      expiresAt: null,
      apiKey: 'planted-upstream-key',
      accessToken: 'planted-access-token',
      refreshToken: 'planted-refresh-token',
      idToken: 'planted-id-token',
      cookie: 'planted-cookie',
      providerSpecificData: { rawSecret: 'planted-provider-secret' },
    },
  ];
  const routes: Array<{
    id: string;
    name: string;
    kind: string | null;
    models: string[];
    createdAt: string;
    updatedAt: string;
  }> = [
    {
      id: 'route-1',
      name: 'quality-first',
      kind: 'fallback',
      models: ['openai/gpt-5', 'anthropic/claude-sonnet'],
      createdAt: '2026-08-04T00:00:00.000Z',
      updatedAt: '2026-08-04T00:00:00.000Z',
    },
  ];
  const state: FakeRouterState = {
    loginCount: 0,
    accountListCount: 0,
    routeCreateCount: 0,
    rejectNextAccountList: false,
    rejectNextRouteCreate: false,
    receivedBodies: [],
  };

  const server = createServer((request, response) => {
    void (async () => {
      const requestUrl = new URL(request.url ?? '/', 'http://router.test');
      const path = requestUrl.pathname;

      if (request.method === 'GET' && path === '/api/health') {
        sendJson(response, 200, { ok: true });
        return;
      }
      if (request.method === 'GET' && path === '/api/version') {
        sendJson(response, 200, { currentVersion: options.version ?? '0.5.45' });
        return;
      }
      if (request.method === 'GET' && path === '/api/auth/status') {
        sendJson(response, 200, {
          requireLogin: true,
          authMode: options.authMode ?? 'password',
        });
        return;
      }
      if (request.method === 'POST' && path === '/api/auth/login') {
        const body = (await readJsonBody(request)) as { password?: unknown };
        if (body.password !== expectedPassword || options.authMode === 'oidc') {
          sendJson(response, 401, { error: `invalid ${String(body.password)}` });
          return;
        }
        state.loginCount += 1;
        response.setHeader('set-cookie', [
          `auth_token=session-${state.loginCount}; Path=/; HttpOnly; SameSite=Lax`,
        ]);
        sendJson(response, 200, { success: true });
        return;
      }
      if (request.method === 'GET' && path === '/v1/models') {
        if (request.headers.authorization !== `Bearer ${expectedDataPlaneKey}`) {
          sendJson(response, 401, { error: `invalid key ${request.headers.authorization}` });
          return;
        }
        sendJson(response, 200, {
          object: 'list',
          data: [{ id: 'quality-first', object: 'model' }],
        });
        return;
      }

      if (!hasValidCookie(request, state)) {
        sendJson(response, 401, { error: `invalid cookie ${request.headers.cookie}` });
        return;
      }

      if (request.method === 'GET' && path === '/api/models') {
        sendJson(response, 200, {
          models: [
            {
              provider: 'openai',
              model: 'gpt-5',
              fullModel: 'openai/gpt-5',
              alias: 'GPT 5',
              apiKey: 'planted-model-secret',
              providerSpecificData: { token: 'planted-model-token' },
            },
          ],
        });
        return;
      }
      if (request.method === 'GET' && path === '/api/providers') {
        state.accountListCount += 1;
        if (state.rejectNextAccountList) {
          state.rejectNextAccountList = false;
          sendJson(response, 401, { error: 'expired cookie' });
          return;
        }
        sendJson(response, 200, { connections: accounts });
        return;
      }
      if (request.method === 'POST' && path === '/api/providers') {
        const body = await readJsonBody(request);
        state.receivedBodies.push({ path, body });
        const record = body as Record<string, unknown>;
        const connection = {
          id: `account-${accounts.length + 1}`,
          provider: record.provider,
          name: record.name,
          authType: 'apikey',
          priority: record.priority ?? 1,
          isActive: true,
          testStatus: 'unknown',
        };
        accounts.push(connection as (typeof accounts)[number]);
        sendJson(response, 201, { connection });
        return;
      }
      const accountMatch = path.match(/^\/api\/providers\/([^/]+)$/);

      if (accountMatch && request.method === 'GET') {
        sendJson(response, 200, { connection: { ...accounts[0], accessToken: 'hidden-token' } });
        return;
      }
      if (path.match(/^\/api\/providers\/[^/]+\/models$/) && request.method === 'GET') {
        sendJson(response, 200, { provider: 'openai', connectionId: 'account-1', models: [{ provider: 'openai', model: 'gpt-4o', fullModel: 'openai/gpt-4o', apiKey: 'hidden' }] });
        return;
      }
      if (accountMatch && request.method === 'PUT') {
        const body = await readJsonBody(request);
        state.receivedBodies.push({ path, body });
        sendJson(response, 200, {
          connection: { ...accounts[0], ...(body as object), apiKey: 'response-secret' },
        });
        return;
      }
      if (accountMatch && request.method === 'DELETE') {
        sendJson(response, 200, { message: 'Connection deleted successfully' });
        return;
      }
      if (path.match(/^\/api\/providers\/[^/]+\/test$/) && request.method === 'POST') {
        sendJson(response, 200, { valid: true, error: null, refreshed: false });
        return;
      }

      if (request.method === 'GET' && path === '/api/combos') {
        sendJson(response, 200, { combos: routes });
        return;
      }
      if (request.method === 'POST' && path === '/api/combos') {
        state.routeCreateCount += 1;
        if (state.rejectNextRouteCreate) {
          state.rejectNextRouteCreate = false;
          sendJson(response, 401, { error: 'expired cookie' });
          return;
        }
        const body = await readJsonBody(request);
        state.receivedBodies.push({ path, body });
        const record = body as { name: string; models: string[]; kind?: string | null };
        const route = {
          id: `route-${routes.length + 1}`,
          name: record.name,
          kind: record.kind ?? null,
          models: record.models,
          createdAt: '2026-08-04T00:00:00.000Z',
          updatedAt: '2026-08-04T00:00:00.000Z',
        };
        routes.push(route);
        sendJson(response, 201, route);
        return;
      }
      const routeMatch = path.match(/^\/api\/combos\/([^/]+)$/);
      if (routeMatch && request.method === 'GET') {
        const route = routes.find((item) => item.id === decodeURIComponent(routeMatch[1]));
        sendJson(response, route ? 200 : 404, route ?? { error: 'Combo not found' });
        return;
      }
      if (routeMatch && request.method === 'PUT') {
        const body = await readJsonBody(request);
        state.receivedBodies.push({ path, body });
        sendJson(response, 200, { ...routes[0], ...(body as object) });
        return;
      }
      if (routeMatch && request.method === 'DELETE') {
        sendJson(response, 200, { success: true });
        return;
      }


      if (request.method === 'GET' && path === '/api/provider-nodes') {
        sendJson(response, 200, { nodes: [{ id: 'node-1', type: 'openai-compatible', name: 'Node', prefix: 'openai', baseUrl: 'https://node.test', apiType: 'chat', apiKey: 'hidden' }] });
        return;
      }
      if (request.method === 'POST' && path === '/api/provider-nodes') {
        const body = await readJsonBody(request); state.receivedBodies.push({ path, body });
        sendJson(response, 201, { node: { id: 'node-2', ...(body as object) } });
        return;
      }
      if (request.method === 'POST' && path === '/api/provider-nodes/validate') {
        const body = await readJsonBody(request); state.receivedBodies.push({ path, body });
        sendJson(response, 200, { valid: true, error: 'hidden detail' });
        return;
      }
      if (request.method === 'POST' && path === '/api/oauth/openai/poll') {
        sendJson(response, 200, { pending: state.invalidPollPending ? 'false' : true, connection: null });
        return;
      }
      const nodeMatch = path.match(/^\/api\/provider-nodes\/([^/]+)$/);
      if (nodeMatch && request.method === 'PUT') {
        const body = await readJsonBody(request); state.receivedBodies.push({ path, body });
        sendJson(response, 200, { node: { id: decodeURIComponent(nodeMatch[1]), type: 'openai-compatible', name: 'Node', prefix: 'openai', baseUrl: 'https://node.test', apiType: 'responses', ...(body as object), apiKey: 'hidden' } });
        return;
      }
      if (nodeMatch && request.method === 'DELETE') { sendJson(response, 200, { success: true }); return; }
      if (request.method === 'GET' && path === '/api/usage/stats') {
        sendJson(response, 200, {
          totalRequests: 12,
          totalPromptTokens: 1_000,
          totalCompletionTokens: 250,
          totalCost: 1.234567,
          byProvider: {
            openai: { requests: 10, cost: 1.2, apiKey: 'planted-usage-key' },
            anthropic: { requests: 2, cost: 0.034567 },
          },
          byApiKey: { 'planted-usage-key': { requests: 12 } },
          recentRequests: [{ prompt: 'planted-prompt', response: 'planted-response' }],
        });
        return;
      }

      sendJson(response, 404, { error: 'Not found' });
    })().catch((error: unknown) => {
      sendJson(response, 500, { error: error instanceof Error ? error.message : 'test error' });
    });
  });

  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const baseUrl = `http://router.test:${address.port}`;
  const localRequest: typeof requestNineRouterJson = (input, dependencies = {}) =>
    requestNineRouterJson(input, {
      ...dependencies,
      targetPolicy: {
        allowLoopbackHttp: true,
        lookup: async () => [{ address: '127.0.0.1', family: 4 }],
      },
    });

  try {
    await runTest({ baseUrl, request: localRequest, state });
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

function assertClientError(run: () => Promise<unknown>, code: string, forbidden?: string) {
  return assert.rejects(run, (error: unknown) => {
    assert.ok(error instanceof AppError);
    assert.equal(error.code, code);
    if (forbidden) {
      assert.equal(error.message.includes(forbidden), false);
    }
    return true;
  });
}

test('validates the pinned version, management login, and data-plane key', async () => {
  await withFakeRouter({}, async ({ baseUrl, request, state }) => {
    const client = new NineRouterClient({
      baseUrl,
      adminPassword: 'admin-password',
      dataPlaneKey: 'data-plane-key',
      request,
    });

    const validation = await client.validateConnection();
    assert.equal(validation.version, '0.5.45');
    assert.equal(validation.knownVersion, true);
    assert.equal(validation.capabilities.writeRoutes, true);
    assert.equal(validation.capabilities.cursorRuntime, false);
    assert.equal(state.loginCount, 1);

    await client.listAccounts();
    await client.listRoutes();
    assert.equal(state.loginCount, 1);
  });
});

test('maps accounts, models, routes, and usage into secret-free DTOs', async () => {
  await withFakeRouter({}, async ({ baseUrl, request }) => {
    const client = new NineRouterClient({
      baseUrl,
      adminPassword: 'admin-password',
      dataPlaneKey: 'data-plane-key',
      request,
    });
    await client.validateConnection();

    const accounts = await client.listAccounts();
    const models = await client.listModels();
    const routes = await client.listRoutes();
    const usage = await client.getUsage('today');
    const serialized = JSON.stringify({ accounts, models, routes, usage });

    assert.deepEqual(accounts, [
      {
        id: 'account-1',
        provider: 'openai',
        name: 'Primary',
        authType: 'apikey',
        priority: 1,
        active: true,
        status: 'healthy',
        lastError: null,
        expiresAt: null,
      },
    ]);
    assert.deepEqual(models, [{ id: 'openai/gpt-5', provider: 'openai', name: 'GPT 5' }]);
    assert.deepEqual(routes, [
      {
        id: 'route-1',
        name: 'quality-first',
        kind: 'fallback',
        models: ['openai/gpt-5', 'anthropic/claude-sonnet'],
      },
    ]);
    assert.deepEqual(usage, {
      period: 'today',
      requests: 12,
      promptTokens: 1_000,
      completionTokens: 250,
      estimatedCostMicrousd: 1_234_567,
      byProvider: [
        { id: 'anthropic', requests: 2, costMicrousd: 34_567 },
        { id: 'openai', requests: 10, costMicrousd: 1_200_000 },
      ],
      staleAt: null,
    });
    for (const secret of [
      'planted-upstream-key',
      'planted-access-token',
      'planted-refresh-token',
      'planted-id-token',
      'planted-cookie',
      'planted-provider-secret',
      'planted-model-secret',
      'planted-model-token',
      'planted-usage-key',
      'planted-prompt',
      'planted-response',
    ]) {
      assert.equal(serialized.includes(secret), false);
    }
  });
});

test('refreshes an expired management cookie once for GET operations', async () => {
  await withFakeRouter({}, async ({ baseUrl, request, state }) => {
    const client = new NineRouterClient({
      baseUrl,
      adminPassword: 'admin-password',
      dataPlaneKey: 'data-plane-key',
      request,
    });
    await client.validateConnection();
    state.rejectNextAccountList = true;

    const accounts = await client.listAccounts();
    assert.equal(accounts.length, 1);
    assert.equal(state.accountListCount, 2);
    assert.equal(state.loginCount, 2);
  });
});

test('never automatically replays a write after a 401', async () => {
  await withFakeRouter({}, async ({ baseUrl, request, state }) => {
    const client = new NineRouterClient({
      baseUrl,
      adminPassword: 'admin-password',
      dataPlaneKey: 'data-plane-key',
      request,
    });
    await client.validateConnection();
    state.rejectNextRouteCreate = true;

    await assertClientError(
      () => client.createRoute({ name: 'new-route', models: ['openai/gpt-5'] }),
      'ROUTING_AUTH_FAILED',
    );
    assert.equal(state.routeCreateCount, 1);
    assert.equal(state.loginCount, 1);
  });
});

test('maps invalid passwords and data-plane keys to redacted errors', async () => {
  await withFakeRouter({}, async ({ baseUrl, request }) => {
    const badPassword = 'wrong-admin-password';
    const client = new NineRouterClient({
      baseUrl,
      adminPassword: badPassword,
      dataPlaneKey: 'data-plane-key',
      request,
    });
    await assertClientError(
      () => client.validateConnection(),
      'ROUTING_AUTH_FAILED',
      badPassword,
    );
  });

  await withFakeRouter({}, async ({ baseUrl, request }) => {
    const badKey = 'wrong-data-plane-key';
    const client = new NineRouterClient({
      baseUrl,
      adminPassword: 'admin-password',
      dataPlaneKey: badKey,
      request,
    });
    await assertClientError(
      () => client.validateConnection(),
      'ROUTING_API_KEY_REJECTED',
      badKey,
    );
  });
});

test('connects unknown versions in reduced mode and blocks guessed management calls', async () => {
  await withFakeRouter({ version: '0.6.0' }, async ({ baseUrl, request, state }) => {
    const client = new NineRouterClient({
      baseUrl,
      adminPassword: 'admin-password',
      dataPlaneKey: 'data-plane-key',
      request,
    });

    const validation = await client.validateConnection();
    assert.equal(validation.knownVersion, false);
    assert.equal(validation.capabilities.writeRoutes, false);
    assert.equal(validation.capabilities.claudeRuntime, true);
    await assertClientError(
      () => client.createRoute({ name: 'unknown-write', models: ['openai/gpt-5'] }),
      'ROUTING_CAPABILITY_UNAVAILABLE',
    );
    await assertClientError(() => client.listAccounts(), 'ROUTING_CAPABILITY_UNAVAILABLE');
    assert.equal(state.routeCreateCount, 0);
  });
});

test('rejects malformed upstream payloads before mapping them', async () => {
  await withFakeRouter({ version: 545 }, async ({ baseUrl, request }) => {
    const client = new NineRouterClient({
      baseUrl,
      adminPassword: 'admin-password',
      dataPlaneKey: 'data-plane-key',
      request,
    });
    await assertClientError(
      () => client.validateConnection(),
      'ROUTING_UPSTREAM_RESPONSE_INVALID',
    );
  });
});

test('sends only pinned write fields and returns sanitized mutation results', async () => {
  await withFakeRouter({}, async ({ baseUrl, request, state }) => {
    const client = new NineRouterClient({
      baseUrl,
      adminPassword: 'admin-password',
      dataPlaneKey: 'data-plane-key',
      request,
    });
    await client.validateConnection();

    const created = await client.createApiKeyAccount({
      provider: 'openai',
      name: 'Secondary',
      apiKey: 'account-input-key',
      priority: 2,
    });
    const updated = await client.updateAccount('account-1', {
      name: 'Renamed',
      apiKey: 'replacement-key',
      priority: 3,
      active: false,
    });
    const tested = await client.testAccount('account-1');
    const route = await client.createRoute({
      name: 'fast-route',
      models: ['openai/gpt-5'],
    });
    await client.updateRoute('route-1', {
      name: 'renamed-route',
      models: ['anthropic/claude-sonnet'],
    });
    await client.deleteAccount('account-1');
    await client.deleteRoute('route-1');

    assert.equal(JSON.stringify(created).includes('account-input-key'), false);
    assert.equal(JSON.stringify(updated).includes('replacement-key'), false);
    assert.deepEqual(tested, { healthy: true, error: null, refreshed: false });
    assert.equal(route.name, 'fast-route');
    assert.deepEqual(state.receivedBodies, [
      {
        path: '/api/providers',
        body: {
          provider: 'openai',
          name: 'Secondary',
          apiKey: 'account-input-key',
          priority: 2,
        },
      },
      {
        path: '/api/providers/account-1',
        body: {
          name: 'Renamed',
          apiKey: 'replacement-key',
          priority: 3,
          isActive: false,
        },
      },
      {
        path: '/api/combos',
        body: { name: 'fast-route', models: ['openai/gpt-5'] },
      },
      {
        path: '/api/combos/route-1',
        body: { name: 'renamed-route', models: ['anthropic/claude-sonnet'] },
      },
    ]);
  });
});


test('maps provider detail, provider models, and provider nodes into safe DTOs', async () => {
  await withFakeRouter({}, async ({ baseUrl, request, state }) => {
    const client = new NineRouterClient({ baseUrl, adminPassword: 'admin-password', dataPlaneKey: 'data-plane-key', request });
    assert.equal((await client.getProvider('account/1')).id, 'account-1');
    assert.equal((await client.listProviderModels('account/1')).models[0].id, 'openai/gpt-4o');
    assert.equal((await client.listProviderNodes())[0].baseUrl, 'https://node.test');
    assert.equal((await client.createProviderNode({ name: 'Node', prefix: 'openai', type: 'openai-compatible', apiType: 'chat', baseUrl: 'https://node.test' })).id, 'node-2');
    assert.equal((await client.validateProviderNode({ baseUrl: 'https://node.test', apiKey: 'secret', type: 'custom-embedding', modelId: 'embed-1' })).message, null);
    assert.equal((await client.updateProviderNode('node/1', { name: 'Node 2', prefix: 'openai', baseUrl: 'https://node.test', apiType: 'responses' })).id, 'node/1');
    await client.deleteProviderNode('node/1');
    assert.deepEqual(state.receivedBodies.filter((item) => item.path.includes('provider-nodes')).map((item) => item.body), [
      { name: 'Node', prefix: 'openai', type: 'openai-compatible', baseUrl: 'https://node.test', apiType: 'chat' },
      { baseUrl: 'https://node.test', type: 'custom-embedding', apiKey: 'secret', modelId: 'embed-1' },
      { name: 'Node 2', prefix: 'openai', baseUrl: 'https://node.test', apiType: 'responses' },
    ]);
  });
});

test('rejects invalid upstream pending states instead of coercing', async () => {
  await withFakeRouter({}, async ({ baseUrl, request, state }) => {
    const client = new NineRouterClient({ baseUrl, adminPassword: 'admin-password', dataPlaneKey: 'data-plane-key', request });
    state.invalidPollPending = true;
    await assertClientError(() => client.pollDeviceCode('openai', { deviceCode: 'd', codeVerifier: 'v' }), 'ROUTING_UPSTREAM_RESPONSE_INVALID');
  });
});
