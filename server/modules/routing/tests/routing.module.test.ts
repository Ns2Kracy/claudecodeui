import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { createServer } from 'node:http';
import test from 'node:test';

import {
  configureNineRouterSidecarForTesting,
  createRemoteSidecarHealthCheckerForTesting,
  getNineRouterSidecarStatus,
  provisionNineRouterDataPlaneKeyForTesting,
  refreshNineRouterSidecar,
  resetNineRouterSidecarForTesting,
} from '../routing.module.js';

test.afterEach(() => {
  resetNineRouterSidecarForTesting();
});

test('data-plane provisioning reuses an official CloudCLI key from management REST', async () => {
  const calls: Array<{ operation: string; body?: unknown; cookie?: string }> = [];
  const originalLoopback = process.env.ROUTING_ALLOW_LOOPBACK_HTTP;
  process.env.ROUTING_ALLOW_LOOPBACK_HTTP = 'true';
  const server = createServer((request, response) => {
    let raw = '';
    request.setEncoding('utf8');
    request.on('data', (chunk) => { raw += chunk; });
    request.on('end', () => {
      const body = raw ? JSON.parse(raw) : undefined;
      const cookie = request.headers.cookie;
      response.setHeader('content-type', 'application/json');
      if (request.url === '/api/auth/status') {
      calls.push({ operation: 'authStatus' });
        response.end(JSON.stringify({ requireLogin: true, authMode: 'password' }));
        return;
      }
      if (request.url === '/api/auth/login') {
      calls.push({ operation: 'login', body });
        response.setHeader('set-cookie', 'auth_token=session; Path=/; HttpOnly');
        response.end(JSON.stringify({ success: true }));
        return;
      }
      if (request.url === '/api/keys') {
        calls.push({ operation: request.method === 'POST' ? 'keyCreate' : 'keysList', body, cookie });
        response.end(JSON.stringify({ keys: [{ name: 'CloudCLI', key: 'sk_existing' }] }));
        return;
      }
      response.statusCode = 404;
      response.end(JSON.stringify({ error: 'not found' }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.notEqual(address, null);
  assert.notEqual(typeof address, 'string');
  const port = (address as AddressInfo).port;

  try {
    assert.equal(await provisionNineRouterDataPlaneKeyForTesting(`http://127.0.0.1:${port}`, 'shared-admin'), 'sk_existing');
    assert.deepEqual(calls, [
      { operation: 'authStatus' },
      { operation: 'login', body: { password: 'shared-admin' } },
      { operation: 'keysList', body: undefined, cookie: 'auth_token=session' },
    ]);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    if (originalLoopback === undefined) delete process.env.ROUTING_ALLOW_LOOPBACK_HTTP;
    else process.env.ROUTING_ALLOW_LOOPBACK_HTTP = originalLoopback;
  }
});

test('production health checker accepts exact pinned health and version payloads', async () => {
  const originalFetch = globalThis.fetch;
  const requested: string[] = [];
  globalThis.fetch = async (input) => {
    const url = String(input);
    requested.push(url);
    if (url === 'http://9router:20128/api/health') {
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }
    if (url === 'http://9router:20128/api/version') {
      return new Response(JSON.stringify({ currentVersion: '0.5.45' }), { status: 200 });
    }
    return new Response('not found', { status: 404 });
  };

  try {
    const result = await createRemoteSidecarHealthCheckerForTesting()('http://9router:20128');

    assert.deepEqual(requested, [
      'http://9router:20128/api/health',
      'http://9router:20128/api/version',
    ]);
    assert.deepEqual(result, { ok: true, version: '0.5.45' });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('production health checker rejects malformed, wrong, and oversized 200 payloads', async () => {
  const originalFetch = globalThis.fetch;
  const scenarios: Array<{ name: string; health: string; version: string }> = [
    { name: 'wrong health ok', health: JSON.stringify({ ok: false }), version: JSON.stringify({ currentVersion: '0.5.45' }) },
    { name: 'legacy health status', health: JSON.stringify({ status: 'ok' }), version: JSON.stringify({ currentVersion: '0.5.45' }) },
    { name: 'wrong version field', health: JSON.stringify({ ok: true }), version: JSON.stringify({ version: '0.5.45' }) },
    { name: 'empty version', health: JSON.stringify({ ok: true }), version: JSON.stringify({ currentVersion: '' }) },
    { name: 'malformed json', health: '{', version: JSON.stringify({ currentVersion: '0.5.45' }) },
    { name: 'oversized version', health: JSON.stringify({ ok: true }), version: JSON.stringify({ currentVersion: '0.5.45', padding: 'x'.repeat(4096) }) },
  ];

  try {
    for (const scenario of scenarios) {
      globalThis.fetch = async (input) => {
        const url = String(input);
        if (url.endsWith('/api/health')) return new Response(scenario.health, { status: 200 });
        if (url.endsWith('/api/version')) return new Response(scenario.version, { status: 200 });
        return new Response('not found', { status: 404 });
      };

      const result = await createRemoteSidecarHealthCheckerForTesting()('http://9router:20128');
      assert.equal(result.ok, false, scenario.name);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('production health checker treats rejected fetch as transient not thrown', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error('connect ECONNREFUSED 9router:20128');
  };

  try {
    const result = await createRemoteSidecarHealthCheckerForTesting()('http://9router:20128');

    assert.deepEqual(result, { ok: false });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('sidecar lifecycle uses a singleton adapter and forwards refresh/status only', async () => {
  const calls: string[] = [];
  const sidecar = {
    async refresh() {
      calls.push('refresh');
      return { state: 'ready' as const, origin: 'http://9router:20128', version: '0.5.45', lastError: null };
    },
    getStatus() {
      calls.push('status');
      return { state: 'ready' as const, origin: 'http://9router:20128', version: '0.5.45', lastError: null };
    },
    getInternalCredentials() {
      throw new Error('credentials must stay private');
    },
  };
  let factories = 0;
  configureNineRouterSidecarForTesting(() => {
    factories += 1;
    return sidecar;
  });

  assert.equal((await refreshNineRouterSidecar()).state, 'ready');
  assert.equal(getNineRouterSidecarStatus().state, 'ready');

  assert.equal(factories, 1);
  assert.deepEqual(calls, ['refresh', 'status']);
  assert.equal('restart' in sidecar, false);
  assert.equal('stop' in sidecar, false);
});
