import crypto from 'node:crypto';

import express from 'express';

import { asyncHandler } from '@/shared/utils.js';

function safeProvider(value: unknown): string | null {
  return typeof value === 'string' && /^[a-z0-9][a-z0-9_-]{0,63}$/.test(value) ? value : null;
}

/** Used by server composition before auth to serve a static OAuth popup completion page without reading secrets. */
export function createRoutingOAuthCallbackRouter(): express.Router {
  const router = express.Router();
  router.get(
    '/oauth/:provider/callback',
    asyncHandler(async (request, response) => {
      if (!safeProvider(request.params.provider)) {
        response.status(404).type('text/plain').send('Not found');
        return;
      }
      const nonce = crypto.randomBytes(16).toString('base64url');
      response.setHeader('Cache-Control', 'no-store');
      response.setHeader('Referrer-Policy', 'no-referrer');
      response.setHeader('Content-Security-Policy', `default-src 'none'; script-src 'nonce-${nonce}'; connect-src 'none'; img-src 'none'; style-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`);
      response.type('html').send(`<!doctype html><html><head><meta charset="utf-8"><title>OAuth complete</title></head><body><p>OAuth callback received. You may close this window.</p><script nonce="${nonce}">try{if(window.opener)window.opener.postMessage({type:'routing-oauth-callback',url:window.location.href},window.location.origin)}catch(_){}</script></body></html>`);
    }),
  );
  return router;
}
