import assert from 'node:assert/strict';
import { once } from 'node:events';
import http from 'node:http';
import test from 'node:test';

import express from 'express';

import { validateApiKey } from '../../auth/index.js';
import { createRoutingOAuthCallbackRouter } from '../routing-oauth-callback.routes.js';

test('OAuth callback responder is unprotected static no-store HTML and does not echo query secrets', async () => {
  const app = express();
  app.use('/api/routing', createRoutingOAuthCallbackRouter());
  app.use((_request, response) => response.status(401).send('auth required'));
  const server = http.createServer(app);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const address = server.address();
    assert.equal(typeof address, 'object');
    const baseUrl = `http://127.0.0.1:${(address as any).port}`;
    const response = await fetch(`${baseUrl}/api/routing/oauth/openai/callback?code=secret-code&state=secret-state`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
    const csp = response.headers.get('content-security-policy') ?? '';
    assert.match(csp, /default-src 'none'/);
    assert.match(csp, /script-src 'nonce-[A-Za-z0-9_-]+'/);
    assert.equal(csp.includes('unsafe-inline'), false);
    const html = await response.text();
    const nonce = csp.match(/script-src 'nonce-([^']+)'/)?.[1];
    assert.ok(nonce);
    assert.match(html, new RegExp(`<script nonce="${nonce}">`));
    assert.match(html, /OAuth callback received/);
    assert.match(html, /url:window\.location\.href/);
    assert.equal(html.includes('secret-code'), false);
    assert.equal(html.includes('secret-state'), false);

    assert.equal((await fetch(`${baseUrl}/api/routing/oauth/Bad.Provider/callback?code=x&state=y`)).status, 404);
  } finally {
    server.close();
    await once(server, 'close');
  }
});

test('OAuth callback remains public when the optional global API key is configured', async () => {
  const previousApiKey = process.env.API_KEY;
  process.env.API_KEY = 'cloudcli-api-key';
  const app = express();
  app.use('/api', validateApiKey);
  app.use('/api/routing', createRoutingOAuthCallbackRouter());
  const server = http.createServer(app);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const address = server.address();
    assert.equal(typeof address, 'object');
    const baseUrl = `http://127.0.0.1:${(address as any).port}`;
    assert.equal((await fetch(`${baseUrl}/api/routing/oauth/openai/callback?code=x&state=y`)).status, 200);
    assert.equal((await fetch(`${baseUrl}/api/private`)).status, 401);
  } finally {
    server.close();
    await once(server, 'close');
    if (previousApiKey === undefined) delete process.env.API_KEY;
    else process.env.API_KEY = previousApiKey;
  }
});
