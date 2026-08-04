import assert from 'node:assert/strict';
import test from 'node:test';

import { emptyRoutingSettingsView } from '../../../../../../shared/routing.js';

import {
  createRoutingApiClient,
  RoutingApiError,
} from './routingApi.js';

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

test('parses a standard routing settings success envelope', async () => {
  const expected = emptyRoutingSettingsView();
  const api = createRoutingApiClient(async () => jsonResponse({ success: true, data: expected }));

  assert.deepEqual(await api.getSettings(), expected);
});

test('maps standard AppError envelopes into a safe RoutingApiError', async () => {
  const api = createRoutingApiClient(async () => jsonResponse({
    success: false,
    error: {
      code: 'ROUTING_RATE_LIMITED',
      message: 'Too many routing requests',
      details: { upstreamBody: 'must-not-propagate' },
    },
  }, 429));

  await assert.rejects(api.getSettings(), (error: unknown) => {
    assert.ok(error instanceof RoutingApiError);
    assert.equal(error.code, 'ROUTING_RATE_LIMITED');
    assert.equal(error.message, 'Too many routing requests');
    assert.equal(error.status, 429);
    assert.equal(error.retryable, true);
    assert.equal('details' in error, false);
    return true;
  });
});

test('rejects malformed success data instead of trusting a type assertion', async () => {
  const api = createRoutingApiClient(async () => jsonResponse({
    success: true,
    data: { connection: { configured: false } },
  }));

  await assert.rejects(
    api.getSettings(),
    (error: unknown) => error instanceof RoutingApiError
      && error.code === 'ROUTING_INVALID_RESPONSE'
      && error.retryable === false,
  );
});

test('builds allowlisted detail queries and encodes dynamic resource ids once', async () => {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const settings = {
    ...emptyRoutingSettingsView(),
    accounts: [],
    models: [],
    routes: [],
    usage: {
      period: '7d' as const,
      requests: 0,
      promptTokens: 0,
      completionTokens: 0,
      estimatedCostMicrousd: 0,
      byProvider: [],
      staleAt: null,
    },
  };
  const api = createRoutingApiClient(async (url, init) => {
    requests.push({ url: String(url), init });
    if (init?.method === 'DELETE') {
      return jsonResponse({ success: true, data: { deleted: true } });
    }
    return jsonResponse({ success: true, data: settings });
  });

  await api.getSettings({ accounts: true, models: true, routes: true, usage: '7d' });
  await api.deleteAccount('account/name');

  assert.equal(requests[0]?.url, '/api/routing?details=accounts%2Cmodels%2Croutes%2Cusage&period=7d');
  assert.equal(requests[1]?.url, '/api/routing/accounts/account%2Fname');
  assert.equal(requests[1]?.init?.method, 'DELETE');
});

test('serializes connection secrets only into the request body and parses a secret-free view', async () => {
  let requestBody = '';
  const connection = {
    ...emptyRoutingSettingsView().connection,
    configured: true,
    baseUrl: 'https://router.example',
    status: 'connected' as const,
    hasAdminCredential: true,
    hasDataPlaneKey: true,
    adminPassword: 'echoed-admin-secret',
    dataPlaneKey: 'echoed-data-plane-secret',
  };
  const api = createRoutingApiClient(async (_url, init) => {
    requestBody = String(init?.body ?? '');
    return jsonResponse({ success: true, data: connection });
  });

  const result = await api.connect({
    baseUrl: 'https://router.example',
    adminPassword: 'admin-secret',
    dataPlaneKey: 'data-plane-secret',
  });

  assert.match(requestBody, /admin-secret/);
  assert.match(requestBody, /data-plane-secret/);
  assert.equal(JSON.stringify(result).includes('admin-secret'), false);
  assert.equal(JSON.stringify(result).includes('data-plane-secret'), false);
  assert.equal(JSON.stringify(result).includes('echoed-admin-secret'), false);
  assert.equal(JSON.stringify(result).includes('echoed-data-plane-secret'), false);
});
