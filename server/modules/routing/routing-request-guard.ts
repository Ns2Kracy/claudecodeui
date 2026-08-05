import type { NextFunction, Request, RequestHandler, Response } from 'express';

import { AppError } from '@/shared/utils.js';

type AuthenticatedRequest = Request & { user?: { id?: number | string } };

type RateLimiterOptions = {
  limit: number;
  windowMs: number;
  maxEntries?: number;
  now?: () => number;
};

type RateLimitEntry = {
  count: number;
  resetAt: number;
};

function crossOriginRejected(): AppError {
  return new AppError('Cross-origin routing mutations are not permitted', {
    code: 'ROUTING_CROSS_ORIGIN_REJECTED',
    statusCode: 403,
  });
}

function configurationInvalid(): AppError {
  return new AppError('Trusted routing origin configuration is invalid', {
    code: 'ROUTING_CONFIGURATION_INVALID',
    statusCode: 500,
  });
}

function readUserId(request: Request): number {
  const value = Number((request as AuthenticatedRequest).user?.id);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new AppError('An authenticated user is required', {
      code: 'AUTHENTICATED_USER_REQUIRED',
      statusCode: 401,
    });
  }
  return value;
}

function canonicalOrigin(value: string): string | null {
  try {
    const url = new URL(value);
    if (
      (url.protocol !== 'http:' && url.protocol !== 'https:') ||
      url.username ||
      url.password ||
      url.pathname !== '/' ||
      url.search ||
      url.hash
    ) {
      return null;
    }
    return url.origin;
  } catch {
    return null;
  }
}

function configuredTrustedOrigins(): Set<string> {
  const result = new Set<string>();
  for (const value of (process.env.CLOUDCLI_TRUSTED_ORIGINS ?? '').split(',')) {
    const candidate = value.trim();
    if (!candidate) continue;
    const origin = canonicalOrigin(candidate);
    if (!origin) {
      throw configurationInvalid();
    }
    result.add(origin);
  }
  return result;
}

function firstHeaderValue(value: string | undefined): string | null {
  const first = value?.split(',')[0]?.trim();
  return first || null;
}

function requestOrigin(request: Request): string | null {
  const forwardedHost = firstHeaderValue(request.header('x-forwarded-host'));
  const host = forwardedHost ?? firstHeaderValue(request.header('host'));
  const forwardedProtocol = firstHeaderValue(request.header('x-forwarded-proto'));
  const protocol = forwardedProtocol ?? request.protocol;
  if (!host || (protocol !== 'http' && protocol !== 'https')) {
    return null;
  }
  return canonicalOrigin(`${protocol}://${host}`);
}

/**
 * Used by routing mutation routes to reject cross-site browser requests while
 * preserving authenticated same-origin browsers and non-browser API clients.
 */
export function createRoutingMutationGuard(): RequestHandler {
  const trustedOrigins = configuredTrustedOrigins();
  return (request: Request, _response: Response, next: NextFunction): void => {
    const fetchSite = request.header('sec-fetch-site')?.toLowerCase();
    if (fetchSite === 'cross-site') {
      next(crossOriginRejected());
      return;
    }

    // Browsers own Sec-Fetch-Site, so application JavaScript cannot spoof it.
    // A relative request passing through Vite or a reverse proxy can retain the
    // browser origin while the proxy rewrites Host. Treat the browser's
    // same-origin classification as authoritative before comparing proxy hosts.
    if (fetchSite === 'same-origin') {
      next();
      return;
    }

    const header = request.header('origin');
    if (!header) {
      next();
      return;
    }
    const origin = canonicalOrigin(header);
    if (!origin) {
      next(crossOriginRejected());
      return;
    }
    if (trustedOrigins.has(origin) || origin === requestOrigin(request)) {
      next();
      return;
    }
    next(crossOriginRejected());
  };
}

/**
 * Used by routing writes to enforce a bounded per-user fixed-window limit.
 * Expired counters are cleaned by an unref'd timer and map size is capped so
 * attacker-controlled authenticated identities cannot grow memory without bound.
 */
export function createRoutingRateLimiter(options: RateLimiterOptions): RequestHandler {
  const maxEntries = options.maxEntries ?? 10_000;
  const now = options.now ?? Date.now;
  if (
    !Number.isSafeInteger(options.limit) ||
    options.limit <= 0 ||
    !Number.isFinite(options.windowMs) ||
    options.windowMs <= 0 ||
    !Number.isSafeInteger(maxEntries) ||
    maxEntries <= 0
  ) {
    throw configurationInvalid();
  }

  const entries = new Map<number, RateLimitEntry>();
  const removeExpired = () => {
    const timestamp = now();
    for (const [key, entry] of entries) {
      if (entry.resetAt <= timestamp) {
        entries.delete(key);
      }
    }
  };
  const cleanupTimer = setInterval(removeExpired, Math.min(options.windowMs, 60_000));
  cleanupTimer.unref();

  return (request: Request, _response: Response, next: NextFunction): void => {
    let userId: number;
    try {
      userId = readUserId(request);
    } catch (error) {
      next(error);
      return;
    }

    const timestamp = now();
    let entry = entries.get(userId);
    if (!entry || entry.resetAt <= timestamp) {
      if (!entry && entries.size >= maxEntries) {
        removeExpired();
        if (entries.size >= maxEntries) {
          const oldest = entries.keys().next().value as number | undefined;
          if (oldest !== undefined) entries.delete(oldest);
        }
      }
      entry = { count: 0, resetAt: timestamp + options.windowMs };
      entries.set(userId, entry);
    }

    if (entry.count >= options.limit) {
      next(
        new AppError('Too many routing requests', {
          code: 'ROUTING_RATE_LIMITED',
          statusCode: 429,
          details: {
            retryAfterSeconds: Math.max(1, Math.ceil((entry.resetAt - timestamp) / 1000)),
          },
        }),
      );
      return;
    }
    entry.count += 1;
    next();
  };
}
