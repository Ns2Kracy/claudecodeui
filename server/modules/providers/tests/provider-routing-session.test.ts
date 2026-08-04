import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import test from 'node:test';

import express from 'express';

import { createProviderSessionRouteHandler } from '@/modules/providers/provider.routes.js';
import { createProviderSessionRoutingService } from '@/modules/providers/services/provider-session-routing.service.js';
import type { LLMProvider } from '@/shared/types.js';

async function withSessionRoute(
  handler: ReturnType<typeof createProviderSessionRouteHandler>,
  runTest: (baseUrl: string) => Promise<void>,
): Promise<void> {
  const app = express();
  app.use(express.json());
  app.use((request, _response, next) => {
    (request as typeof request & { user?: { id: number } }).user = { id: 7 };
    next();
  });
  app.post('/api/providers/sessions', handler);

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

test('session route passes only authenticated identity into the creation workflow', async () => {
  const calls: unknown[][] = [];
  const handler = createProviderSessionRouteHandler({
    async createAppSession(userId, provider, projectPath) {
      calls.push([userId, provider, projectPath]);
      return { sessionId: 'app-session-1', provider, projectPath };
    },
  });

  await withSessionRoute(handler, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/providers/sessions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        provider: 'claude',
        projectPath: '/workspace/project',
        userId: 999,
      }),
    });
    assert.equal(response.status, 201);
    assert.deepEqual(await response.json(), {
      success: true,
      data: {
        sessionId: 'app-session-1',
        provider: 'claude',
        projectPath: '/workspace/project',
      },
    });
  });

  assert.deepEqual(calls, [[7, 'claude', '/workspace/project']]);
});

test('session creation snapshots routing after allocating the stable app session', async () => {
  const calls: Array<{ operation: string; args: unknown[] }> = [];
  const service = createProviderSessionRoutingService({
    createAppSession(provider: LLMProvider, projectPath: string) {
      calls.push({ operation: 'create', args: [provider, projectPath] });
      return { sessionId: 'app-session-1', provider, projectPath };
    },
    async snapshotSessionBinding(...args) {
      calls.push({ operation: 'snapshot', args });
    },
    async rollbackSession(...args) {
      calls.push({ operation: 'rollback', args });
    },
  });

  const session = await service.createAppSession(7, 'claude', '/workspace/project');

  assert.deepEqual(session, {
    sessionId: 'app-session-1',
    provider: 'claude',
    projectPath: '/workspace/project',
  });
  assert.deepEqual(calls, [
    { operation: 'create', args: ['claude', '/workspace/project'] },
    { operation: 'snapshot', args: [7, 'app-session-1', 'claude'] },
  ]);
});

test('session creation rolls back before propagating snapshot failures', async () => {
  const rollbackCalls: unknown[][] = [];
  const snapshotError = new Error('snapshot failed');
  const service = createProviderSessionRoutingService({
    createAppSession(provider: LLMProvider, projectPath: string) {
      return { sessionId: 'app-session-rollback', provider, projectPath };
    },
    async snapshotSessionBinding() {
      throw snapshotError;
    },
    async rollbackSession(...args) {
      rollbackCalls.push(args);
    },
  });

  await assert.rejects(
    service.createAppSession(7, 'codex', '/workspace/project'),
    (error) => error === snapshotError,
  );
  assert.deepEqual(rollbackCalls, [[
    'app-session-rollback',
    { force: true, deletedFromDisk: false },
  ]]);
});
