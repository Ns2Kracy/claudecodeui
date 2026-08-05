import assert from 'node:assert/strict';
import test from 'node:test';

import {
  configureNineRouterSidecarForTesting,
  createRemoteSidecarHealthCheckerForTesting,
  getNineRouterSidecarStatus,
  refreshNineRouterSidecar,
  resetNineRouterSidecarForTesting,
} from '../routing.module.js';

test.afterEach(() => {
  resetNineRouterSidecarForTesting();
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
