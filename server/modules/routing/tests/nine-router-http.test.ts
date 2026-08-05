import assert from 'node:assert/strict';
import { EventEmitter, once } from 'node:events';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import test from 'node:test';

import { AppError } from '@/shared/utils.js';

import { requestNineRouterJson } from '../nine-router-http.js';

const localTargetPolicy = {
  allowLoopbackHttp: true,
  lookup: async () => [{ address: '127.0.0.1', family: 4 as const }],
};

async function withServer(
  handler: (request: IncomingMessage, response: ServerResponse) => void,
  runTest: (baseUrl: string) => Promise<void>,
): Promise<void> {
  const server = createServer(handler);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address === 'object');

  try {
    await runTest(`http://router.test:${address.port}`);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

async function readRequestBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function assertHttpError(
  run: () => Promise<unknown>,
  code: string,
): Promise<AppError> {
  let caught: AppError | null = null;
  await assert.rejects(run, (error: unknown) => {
    assert.ok(error instanceof AppError);
    assert.equal(error.code, code);
    caught = error;
    return true;
  });
  assert.ok(caught);
  return caught;
}

test('sends and receives JSON through a fixed operation mapping', async () => {
  await withServer(async (request, response) => {
    assert.equal(request.method, 'POST');
    assert.equal(request.url, '/api/auth/login');
    assert.equal(request.headers['content-type'], 'application/json');
    assert.equal(request.headers['accept-encoding'], 'identity');
    assert.deepEqual(JSON.parse(await readRequestBody(request)), { password: 'submitted-once' });
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ ok: true }));
  }, async (baseUrl) => {
    const result = await requestNineRouterJson(
      {
        baseUrl,
        operation: 'login',
        body: { password: 'submitted-once' },
      },
      { targetPolicy: localTargetPolicy },
    );
    assert.equal(result.statusCode, 200);
    assert.deepEqual(result.data, { ok: true });
  });
});

test('encodes dynamic resource IDs instead of accepting arbitrary paths', async () => {
  await withServer((request, response) => {
    assert.equal(request.method, 'GET');
    assert.equal(request.url, '/api/combos/route%2Fwith%20spaces%3F');
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ id: 'route/with spaces?' }));
  }, async (baseUrl) => {
    await requestNineRouterJson(
      {
        baseUrl,
        operation: 'routeGet',
        id: 'route/with spaces?',
      },
      { targetPolicy: localTargetPolicy },
    );
  });
});

test('maps Task 7 provider, OAuth, and provider-node operations to exact upstream paths', async () => {
  const seen: Array<{ method: string | undefined; url: string | undefined; body: unknown }> = [];
  await withServer(async (request, response) => {
    seen.push({
      method: request.method,
      url: request.url,
      body: request.method === 'GET' || request.method === 'DELETE'
        ? null
        : JSON.parse(await readRequestBody(request)) as unknown,
    });
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ ok: true }));
  }, async (baseUrl) => {
    const options = { targetPolicy: localTargetPolicy };
    await requestNineRouterJson({ baseUrl, operation: 'providerGet', id: 'provider/1' }, options);
    await requestNineRouterJson({ baseUrl, operation: 'providerModels', id: 'provider/1' }, options);
    await requestNineRouterJson({ baseUrl, operation: 'oauthAuthorize', provider: 'codex', redirectUri: 'http://localhost:1455/auth/callback?x=1' }, options);
    await requestNineRouterJson({ baseUrl, operation: 'oauthExchange', provider: 'codex', body: { code: 'c' } }, options);
    await requestNineRouterJson({ baseUrl, operation: 'oauthDeviceCode', provider: 'openai' }, options);
    await requestNineRouterJson({ baseUrl, operation: 'oauthPoll', provider: 'openai', body: { deviceCode: 'd' } }, options);
    await requestNineRouterJson({ baseUrl, operation: 'providerNodesList' }, options);
    await requestNineRouterJson({ baseUrl, operation: 'providerNodeCreate', body: { name: 'n' } }, options);
    await requestNineRouterJson({ baseUrl, operation: 'providerNodeValidate', body: { baseUrl: 'https://node.test' } }, options);
    await requestNineRouterJson({ baseUrl, operation: 'providerNodeUpdate', id: 'node/1', body: { isActive: false } }, options);
    await requestNineRouterJson({ baseUrl, operation: 'providerNodeDelete', id: 'node/1' }, options);
  });

  assert.deepEqual(seen, [
    { method: 'GET', url: '/api/providers/provider%2F1', body: null },
    { method: 'GET', url: '/api/providers/provider%2F1/models', body: null },
    { method: 'GET', url: '/api/oauth/codex/authorize?redirect_uri=http%3A%2F%2Flocalhost%3A1455%2Fauth%2Fcallback%3Fx%3D1', body: null },
    { method: 'POST', url: '/api/oauth/codex/exchange', body: { code: 'c' } },
    { method: 'GET', url: '/api/oauth/openai/device-code', body: null },
    { method: 'POST', url: '/api/oauth/openai/poll', body: { deviceCode: 'd' } },
    { method: 'GET', url: '/api/provider-nodes', body: null },
    { method: 'POST', url: '/api/provider-nodes', body: { name: 'n' } },
    { method: 'POST', url: '/api/provider-nodes/validate', body: { baseUrl: 'https://node.test' } },
    { method: 'PUT', url: '/api/provider-nodes/node%2F1', body: { isActive: false } },
    { method: 'DELETE', url: '/api/provider-nodes/node%2F1', body: null },
  ]);
});

test('rejects invalid dynamic Task 7 path inputs before making a request', async () => {
  const requestFactory = () => {
    throw new Error('request should not start');
  };
  const dependencies = {
    requestFactory,
    targetPolicy: localTargetPolicy,
  };

  await assertHttpError(
    () => requestNineRouterJson({ baseUrl: 'http://router.test:20128', operation: 'providerGet' }, dependencies),
    'ROUTING_OPERATION_FAILED',
  );
  await assertHttpError(
    () => requestNineRouterJson({ baseUrl: 'http://router.test:20128', operation: 'oauthAuthorize', provider: '', redirectUri: 'http://localhost/callback' }, dependencies),
    'ROUTING_OPERATION_FAILED',
  );
  await assertHttpError(
    () => requestNineRouterJson({ baseUrl: 'http://router.test:20128', operation: 'oauthAuthorize', provider: 'codex' }, dependencies),
    'ROUTING_OPERATION_FAILED',
  );
});

test('rejects malformed, credentialed, fragmented, and oversized base URLs before requests', async () => {
  const requestFactory = () => { throw new Error('request should not start'); };
  const dependencies = { requestFactory, targetPolicy: localTargetPolicy };
  for (const baseUrl of [
    'not a url',
    'ftp://router.test',
    'https://user:pass@router.test',
    'https://router.test#secret',
    `https://router.test/${'x'.repeat(3000)}`,
  ]) {
    await assertHttpError(
      () => requestNineRouterJson({ baseUrl, operation: 'health' }, dependencies),
      'ROUTING_TARGET_BLOCKED',
    );
  }
});

test('does not retry ambiguous Task 7 mutations after network failure', async () => {
  let attempts = 0;
  const requestFactory = () => {
    attempts += 1;
    const request = new EventEmitter() as EventEmitter & {
      write: () => void;
      end: () => void;
      destroy: () => void;
    };
    request.write = () => undefined;
    request.destroy = () => undefined;
    request.end = () => queueMicrotask(() => request.emit('error', new Error('socket reset')));
    return request;
  };

  await assertHttpError(
    () => requestNineRouterJson(
      { baseUrl: 'http://router.test:20128', operation: 'providerNodeCreate', body: { name: 'n' } },
      { requestFactory, targetPolicy: localTargetPolicy },
    ),
    'ROUTING_UNREACHABLE',
  );
  assert.equal(attempts, 1);
});

test('enforces a connection timeout with an injected never-connecting request', async () => {
  const requestFactory = () => {
    const request = new EventEmitter() as EventEmitter & {
      write: () => void;
      end: () => void;
      destroy: (error: Error) => void;
    };
    request.write = () => undefined;
    request.end = () => {
      const socket = new EventEmitter() as EventEmitter & { connecting: boolean };
      socket.connecting = true;
      queueMicrotask(() => request.emit('socket', socket));
    };
    request.destroy = (error) => queueMicrotask(() => request.emit('error', error));
    return request;
  };

  await assertHttpError(
    () =>
      requestNineRouterJson(
        { baseUrl: 'https://router.example', operation: 'health' },
        {
          requestFactory,
          targetPolicy: {
            lookup: async () => [{ address: '93.184.216.34', family: 4 }],
          },
          timeouts: { connectMs: 10, headersMs: 100, bodyMs: 100, totalMs: 200 },
        },
      ),
    'ROUTING_UPSTREAM_TIMEOUT',
  );
});

test('enforces headers, body, and total timeouts', async () => {
  await withServer(() => undefined, async (baseUrl) => {
    await assertHttpError(
      () =>
        requestNineRouterJson(
          { baseUrl, operation: 'health' },
          {
            targetPolicy: localTargetPolicy,
            timeouts: { connectMs: 100, headersMs: 15, bodyMs: 100, totalMs: 200 },
          },
        ),
      'ROUTING_UPSTREAM_TIMEOUT',
    );
  });

  await withServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.write('{"ok":');
  }, async (baseUrl) => {
    await assertHttpError(
      () =>
        requestNineRouterJson(
          { baseUrl, operation: 'health' },
          {
            targetPolicy: localTargetPolicy,
            timeouts: { connectMs: 100, headersMs: 100, bodyMs: 15, totalMs: 200 },
          },
        ),
      'ROUTING_UPSTREAM_TIMEOUT',
    );
  });

  await withServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.write('{"chunks":[');
    const interval = setInterval(() => response.write('0,'), 5);
    response.once('close', () => clearInterval(interval));
  }, async (baseUrl) => {
    await assertHttpError(
      () =>
        requestNineRouterJson(
          { baseUrl, operation: 'health' },
          {
            targetPolicy: localTargetPolicy,
            timeouts: { connectMs: 100, headersMs: 100, bodyMs: 100, totalMs: 20 },
          },
        ),
      'ROUTING_UPSTREAM_TIMEOUT',
    );
  });
});

test('rejects redirects without following their Location target', async () => {
  let requests = 0;
  await withServer((_request, response) => {
    requests += 1;
    response.writeHead(302, {
      location: 'http://169.254.169.254/latest/meta-data',
      'content-type': 'application/json',
    });
    response.end(JSON.stringify({ redirect: true }));
  }, async (baseUrl) => {
    await assertHttpError(
      () =>
        requestNineRouterJson(
          { baseUrl, operation: 'health' },
          { targetPolicy: localTargetPolicy },
        ),
      'ROUTING_REDIRECT_REJECTED',
    );
  });
  assert.equal(requests, 1);
});

test('rejects bodies over one MiB before parsing', async () => {
  await withServer((_request, response) => {
    response.writeHead(200, {
      'content-type': 'application/json',
      'content-length': String(1024 * 1024 + 1),
    });
    response.end('x');
  }, async (baseUrl) => {
    await assertHttpError(
      () =>
        requestNineRouterJson(
          { baseUrl, operation: 'health' },
          { targetPolicy: localTargetPolicy },
        ),
      'ROUTING_UPSTREAM_RESPONSE_TOO_LARGE',
    );
  });
});

test('turns non-JSON, malformed JSON, and invalid JSON shapes into safe errors', async () => {
  const responses = [
    { contentType: 'text/plain', body: '{"ok":true}' },
    { contentType: 'application/json', body: '{not-json' },
    { contentType: 'application/json', body: '"not-an-object"' },
  ];

  for (const item of responses) {
    await withServer((_request, response) => {
      response.writeHead(200, { 'content-type': item.contentType });
      response.end(item.body);
    }, async (baseUrl) => {
      await assertHttpError(
        () =>
          requestNineRouterJson(
            { baseUrl, operation: 'health' },
            { targetPolicy: localTargetPolicy },
          ),
        'ROUTING_UPSTREAM_RESPONSE_INVALID',
      );
    });
  }
});

test('safe errors identify origin and operation without header credentials', async () => {
  await withServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end('{invalid');
  }, async (baseUrl) => {
    const error = await assertHttpError(
      () =>
        requestNineRouterJson(
          {
            baseUrl,
            operation: 'health',
            authorization: 'Bearer authorization-secret',
            cookie: 'auth_token=cookie-secret',
          },
          { targetPolicy: localTargetPolicy },
        ),
      'ROUTING_UPSTREAM_RESPONSE_INVALID',
    );
    assert.match(error.message, /http:\/\/router\.test:\d+/);
    assert.match(error.message, /health/);
    assert.equal(error.message.includes('authorization-secret'), false);
    assert.equal(error.message.includes('cookie-secret'), false);
  });
});
