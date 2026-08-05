import assert from 'node:assert/strict';
import { promises as fsPromises } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  configureEmbeddedNineRouterForTesting,
  createBoundedLoopbackHealthCheckerForTesting,
  createProductionFilesystemAdapter,
  getEmbeddedNineRouterStatus,
  resetEmbeddedNineRouterForTesting,
  restartEmbeddedNineRouter,
  startEmbeddedNineRouter,
  stopEmbeddedNineRouter,
} from '../routing.module.js';

test.afterEach(() => {
  resetEmbeddedNineRouterForTesting();
});


test('production health checker accepts exact pinned health and version payloads', async () => {
  const originalFetch = globalThis.fetch;
  const requested: string[] = [];
  globalThis.fetch = async (input) => {
    const url = String(input);
    requested.push(url);
    if (url === 'http://127.0.0.1:9731/api/health') {
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }
    if (url === 'http://127.0.0.1:9731/api/version') {
      return new Response(JSON.stringify({ currentVersion: '0.5.45' }), { status: 200 });
    }
    return new Response('not found', { status: 404 });
  };

  try {
    const result = await createBoundedLoopbackHealthCheckerForTesting().check('http://127.0.0.1:9731');

    assert.deepEqual(requested, [
      'http://127.0.0.1:9731/api/health',
      'http://127.0.0.1:9731/api/version',
    ]);
    assert.equal(result.ok, true);
    assert.equal(result.version, '0.5.45');
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

      const result = await createBoundedLoopbackHealthCheckerForTesting().check('http://127.0.0.1:9731');
      assert.equal(result.ok, false, scenario.name);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('production filesystem adapter tightens existing data directory to 0700 on POSIX filesystems', async () => {
  const parent = await fsPromises.mkdtemp(path.join(tmpdir(), 'routing-module-'));
  const dataDir = path.join(parent, 'data');
  await fsPromises.mkdir(dataDir, { mode: 0o755 });
  await fsPromises.chmod(dataDir, 0o755);

  try {
    await createProductionFilesystemAdapter().ensureDataDir(dataDir, 0o700);
    const stat = await fsPromises.stat(dataDir);
    const mode = stat.mode & 0o777;

    if (process.platform === 'win32') {
      assert.ok(mode === 0o700 || mode === 0o755 || mode === 0o777);
    } else {
      assert.equal(mode, 0o700);
    }
  } finally {
    await fsPromises.rm(parent, { recursive: true, force: true });
  }
});

test('embedded lifecycle uses a singleton runtime and forwards start/stop/restart/status', async () => {
  const calls: string[] = [];
  const runtime = {
    async start() {
      calls.push('start');
      return { state: 'ready' as const, origin: '9router', version: '1.0.0', lastError: null };
    },
    async stop() {
      calls.push('stop');
    },
    async restart() {
      calls.push('restart');
      return { state: 'ready' as const, origin: '9router', version: '1.0.1', lastError: null };
    },
    getStatus() {
      calls.push('status');
      return { state: 'ready' as const, origin: '9router', version: '1.0.1', lastError: null };
    },
    getInternalCredentials() {
      throw new Error('credentials must stay private');
    },
  };
  let factories = 0;
  configureEmbeddedNineRouterForTesting(() => {
    factories += 1;
    return runtime;
  });

  assert.equal((await startEmbeddedNineRouter()).state, 'ready');
  assert.equal((await restartEmbeddedNineRouter()).version, '1.0.1');
  assert.equal(getEmbeddedNineRouterStatus().state, 'ready');
  await stopEmbeddedNineRouter();

  assert.equal(factories, 1);
  assert.deepEqual(calls, ['start', 'restart', 'status', 'stop']);
});
