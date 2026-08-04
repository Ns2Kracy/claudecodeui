import { request as requestHttp, type IncomingHttpHeaders, type IncomingMessage } from 'node:http';
import { request as requestHttps } from 'node:https';
import { isIP, type LookupFunction } from 'node:net';

import { AppError } from '@/shared/utils.js';

import type { RoutingUsagePeriod } from '../../../shared/routing.js';

import { validateRoutingTarget } from './routing-target-policy.js';

type NineRouterOperation =
  | 'health'
  | 'version'
  | 'authStatus'
  | 'login'
  | 'dataPlaneModels'
  | 'catalogModels'
  | 'accountsList'
  | 'accountCreate'
  | 'accountUpdate'
  | 'accountDelete'
  | 'accountTest'
  | 'routesList'
  | 'routeGet'
  | 'routeCreate'
  | 'routeUpdate'
  | 'routeDelete'
  | 'usageStats';

type NineRouterRequestInput = {
  baseUrl: string;
  operation: NineRouterOperation;
  id?: string;
  period?: RoutingUsagePeriod;
  body?: unknown;
  authorization?: string;
  cookie?: string;
};

type NineRouterHttpResult = {
  statusCode: number;
  headers: IncomingHttpHeaders;
  data: Record<string, unknown> | unknown[] | null;
};

type RequestTimeouts = {
  connectMs: number;
  headersMs: number;
  bodyMs: number;
  totalMs: number;
};

type RequestLike = {
  on(event: string, listener: (...args: any[]) => void): unknown;
  once(event: string, listener: (...args: any[]) => void): unknown;
  write(data: string | Buffer): unknown;
  end(): unknown;
  destroy(error?: Error): unknown;
};

type RequestFactory = (
  protocol: 'http:' | 'https:',
  options: Record<string, unknown>,
  onResponse: (response: IncomingMessage) => void,
) => RequestLike;

type NineRouterHttpDependencies = {
  targetPolicy?: Parameters<typeof validateRoutingTarget>[1];
  timeouts?: Partial<RequestTimeouts>;
  requestFactory?: RequestFactory;
};

type OperationDefinition = {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  path: (input: NineRouterRequestInput) => string;
};

const MAX_BODY_BYTES = 1024 * 1024;
const DEFAULT_TIMEOUTS: RequestTimeouts = {
  connectMs: 5_000,
  headersMs: 10_000,
  bodyMs: 10_000,
  totalMs: 20_000,
};

function fixedPath(path: string): () => string {
  return () => path;
}

function encodedId(input: NineRouterRequestInput): string {
  if (typeof input.id !== 'string' || !input.id || input.id.length > 512) {
    throw operationFailed(input.operation, 'configured target');
  }
  return encodeURIComponent(input.id);
}

function usagePath(input: NineRouterRequestInput): string {
  if (!input.period || !['today', '7d', '30d'].includes(input.period)) {
    throw operationFailed(input.operation, 'configured target');
  }
  return `/api/usage/stats?period=${encodeURIComponent(input.period)}`;
}

const OPERATIONS: Record<NineRouterOperation, OperationDefinition> = {
  health: { method: 'GET', path: fixedPath('/api/health') },
  version: { method: 'GET', path: fixedPath('/api/version') },
  authStatus: { method: 'GET', path: fixedPath('/api/auth/status') },
  login: { method: 'POST', path: fixedPath('/api/auth/login') },
  dataPlaneModels: { method: 'GET', path: fixedPath('/v1/models') },
  catalogModels: { method: 'GET', path: fixedPath('/api/models') },
  accountsList: { method: 'GET', path: fixedPath('/api/providers') },
  accountCreate: { method: 'POST', path: fixedPath('/api/providers') },
  accountUpdate: {
    method: 'PUT',
    path: (input) => `/api/providers/${encodedId(input)}`,
  },
  accountDelete: {
    method: 'DELETE',
    path: (input) => `/api/providers/${encodedId(input)}`,
  },
  accountTest: {
    method: 'POST',
    path: (input) => `/api/providers/${encodedId(input)}/test`,
  },
  routesList: { method: 'GET', path: fixedPath('/api/combos') },
  routeGet: {
    method: 'GET',
    path: (input) => `/api/combos/${encodedId(input)}`,
  },
  routeCreate: { method: 'POST', path: fixedPath('/api/combos') },
  routeUpdate: {
    method: 'PUT',
    path: (input) => `/api/combos/${encodedId(input)}`,
  },
  routeDelete: {
    method: 'DELETE',
    path: (input) => `/api/combos/${encodedId(input)}`,
  },
  usageStats: { method: 'GET', path: usagePath },
};

function errorMessage(operation: NineRouterOperation, origin: string, detail: string): string {
  return `9router ${operation} request to ${origin} ${detail}`;
}

function operationFailed(operation: NineRouterOperation, origin: string): AppError {
  return new AppError(errorMessage(operation, origin, 'failed'), {
    code: 'ROUTING_OPERATION_FAILED',
    statusCode: 502,
  });
}

function unreachable(operation: NineRouterOperation, origin: string): AppError {
  return new AppError(errorMessage(operation, origin, 'could not connect'), {
    code: 'ROUTING_UNREACHABLE',
    statusCode: 502,
  });
}

function timedOut(
  operation: NineRouterOperation,
  origin: string,
  stage: 'connection' | 'headers' | 'body' | 'total',
): AppError {
  return new AppError(errorMessage(operation, origin, `timed out during ${stage}`), {
    code: 'ROUTING_UPSTREAM_TIMEOUT',
    statusCode: 504,
  });
}

function redirectRejected(operation: NineRouterOperation, origin: string): AppError {
  return new AppError(errorMessage(operation, origin, 'returned a forbidden redirect'), {
    code: 'ROUTING_REDIRECT_REJECTED',
    statusCode: 502,
  });
}

function responseTooLarge(operation: NineRouterOperation, origin: string): AppError {
  return new AppError(errorMessage(operation, origin, 'returned an oversized response'), {
    code: 'ROUTING_UPSTREAM_RESPONSE_TOO_LARGE',
    statusCode: 502,
  });
}

function invalidResponse(operation: NineRouterOperation, origin: string): AppError {
  return new AppError(errorMessage(operation, origin, 'returned an invalid JSON response'), {
    code: 'ROUTING_UPSTREAM_RESPONSE_INVALID',
    statusCode: 502,
  });
}

function serializeBody(input: NineRouterRequestInput, origin: string): Buffer | null {
  if (input.body === undefined) {
    return null;
  }
  try {
    const serialized = JSON.stringify(input.body);
    if (serialized === undefined) {
      throw operationFailed(input.operation, origin);
    }
    const body = Buffer.from(serialized, 'utf8');
    if (body.length > MAX_BODY_BYTES) {
      throw operationFailed(input.operation, origin);
    }
    return body;
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }
    throw operationFailed(input.operation, origin);
  }
}

function defaultRequestFactory(
  protocol: 'http:' | 'https:',
  options: Record<string, unknown>,
  onResponse: (response: IncomingMessage) => void,
): RequestLike {
  return protocol === 'https:'
    ? requestHttps(options, onResponse)
    : requestHttp(options, onResponse);
}

function isJsonContentType(value: string | string[] | undefined): boolean {
  const contentType = Array.isArray(value) ? value[0] : value;
  return typeof contentType === 'string' && /^(?:application\/json|[^;]+\+json)(?:;|$)/i.test(contentType.trim());
}

function parseJsonResponse(
  body: Buffer,
  statusCode: number,
  headers: IncomingHttpHeaders,
  operation: NineRouterOperation,
  origin: string,
): NineRouterHttpResult['data'] {
  if (statusCode === 204 && body.length === 0) {
    return null;
  }
  if (!isJsonContentType(headers['content-type']) || body.length === 0) {
    throw invalidResponse(operation, origin);
  }

  try {
    const parsed = JSON.parse(body.toString('utf8')) as unknown;
    if (!parsed || typeof parsed !== 'object') {
      throw invalidResponse(operation, origin);
    }
    return parsed as Record<string, unknown> | unknown[];
  } catch {
    throw invalidResponse(operation, origin);
  }
}

function mergedTimeouts(overrides: Partial<RequestTimeouts> | undefined): RequestTimeouts {
  const timeouts = { ...DEFAULT_TIMEOUTS, ...overrides };
  for (const value of Object.values(timeouts)) {
    if (!Number.isFinite(value) || value <= 0) {
      throw new AppError('9router request timeout configuration is invalid', {
        code: 'ROUTING_CONFIGURATION_INVALID',
        statusCode: 500,
      });
    }
  }
  return timeouts;
}

/**
 * Used by NineRouterClient to execute only allowlisted management/data-plane
 * operations with DNS pinning, redirect rejection, bounded JSON responses, and
 * safe errors that never contain request credentials.
 */
export async function requestNineRouterJson(
  input: NineRouterRequestInput,
  dependencies: NineRouterHttpDependencies = {},
): Promise<NineRouterHttpResult> {
  const target = await validateRoutingTarget(input.baseUrl, dependencies.targetPolicy);
  const operation = OPERATIONS[input.operation];
  if (!operation) {
    throw operationFailed(input.operation, target.origin);
  }
  const path = operation.path(input);
  const body = serializeBody(input, target.origin);
  const timeouts = mergedTimeouts(dependencies.timeouts);
  const requestFactory = dependencies.requestFactory ?? defaultRequestFactory;

  const headers: Record<string, string | number> = {
    accept: 'application/json',
    'accept-encoding': 'identity',
  };
  if (body) {
    headers['content-type'] = 'application/json';
    headers['content-length'] = body.length;
  }
  if (input.authorization) {
    headers.authorization = input.authorization;
  }
  if (input.cookie) {
    headers.cookie = input.cookie;
  }

  const pinnedLookup: LookupFunction = (_hostname, options, callback) => {
    if (options.all) {
      callback(null, [{ address: target.pinnedAddress, family: target.family }]);
    } else {
      callback(null, target.pinnedAddress, target.family);
    }
  };

  return new Promise<NineRouterHttpResult>((resolve, reject) => {
    let request: RequestLike;
    let settled = false;
    let connectTimer: NodeJS.Timeout | undefined;
    let headersTimer: NodeJS.Timeout | undefined;
    let bodyTimer: NodeJS.Timeout | undefined;
    let totalTimer: NodeJS.Timeout | undefined;

    const clearTimers = () => {
      clearTimeout(connectTimer);
      clearTimeout(headersTimer);
      clearTimeout(bodyTimer);
      clearTimeout(totalTimer);
    };
    const fail = (error: AppError) => {
      if (settled) return;
      settled = true;
      clearTimers();
      request?.destroy(error);
      reject(error);
    };
    const succeed = (result: NineRouterHttpResult) => {
      if (settled) return;
      settled = true;
      clearTimers();
      resolve(result);
    };

    totalTimer = setTimeout(
      () => fail(timedOut(input.operation, target.origin, 'total')),
      timeouts.totalMs,
    );

    try {
      request = requestFactory(
        target.protocol,
        {
          protocol: target.protocol,
          hostname: target.hostname,
          port: target.port,
          method: operation.method,
          path,
          headers,
          agent: false,
          lookup: pinnedLookup,
          ...(target.protocol === 'https:' && isIP(target.hostname) === 0
            ? { servername: target.hostname }
            : {}),
        },
        (response) => {
          clearTimeout(connectTimer);
          clearTimeout(headersTimer);

          const statusCode = response.statusCode;
          if (!statusCode) {
            response.resume();
            fail(invalidResponse(input.operation, target.origin));
            return;
          }
          if (statusCode >= 300 && statusCode < 400) {
            response.resume();
            fail(redirectRejected(input.operation, target.origin));
            return;
          }

          const contentLength = Number(response.headers['content-length']);
          if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
            response.resume();
            fail(responseTooLarge(input.operation, target.origin));
            return;
          }

          const chunks: Buffer[] = [];
          let receivedBytes = 0;
          bodyTimer = setTimeout(
            () => fail(timedOut(input.operation, target.origin, 'body')),
            timeouts.bodyMs,
          );

          response.on('data', (chunk: Buffer | string) => {
            const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
            receivedBytes += buffer.length;
            if (receivedBytes > MAX_BODY_BYTES) {
              response.destroy(responseTooLarge(input.operation, target.origin));
              fail(responseTooLarge(input.operation, target.origin));
              return;
            }
            chunks.push(buffer);
          });
          response.once('aborted', () => fail(unreachable(input.operation, target.origin)));
          response.once('error', (error) => {
            fail(error instanceof AppError ? error : unreachable(input.operation, target.origin));
          });
          response.once('end', () => {
            clearTimeout(bodyTimer);
            if (settled) return;
            try {
              const data = parseJsonResponse(
                Buffer.concat(chunks),
                statusCode,
                response.headers,
                input.operation,
                target.origin,
              );
              succeed({ statusCode, headers: response.headers, data });
            } catch (error) {
              fail(
                error instanceof AppError
                  ? error
                  : invalidResponse(input.operation, target.origin),
              );
            }
          });
        },
      );
    } catch (error) {
      clearTimers();
      reject(error instanceof AppError ? error : operationFailed(input.operation, target.origin));
      return;
    }

    headersTimer = setTimeout(
      () => fail(timedOut(input.operation, target.origin, 'headers')),
      timeouts.headersMs,
    );
    request.once('socket', (socket: {
      connecting?: boolean;
      once(event: string, listener: (...args: any[]) => void): unknown;
    }) => {
      if (!socket.connecting) {
        return;
      }
      connectTimer = setTimeout(
        () => fail(timedOut(input.operation, target.origin, 'connection')),
        timeouts.connectMs,
      );
      const connectedEvent = target.protocol === 'https:' ? 'secureConnect' : 'connect';
      socket.once(connectedEvent, () => clearTimeout(connectTimer));
      socket.once('error', () => clearTimeout(connectTimer));
    });
    request.once('error', (error: unknown) => {
      if (settled) return;
      fail(error instanceof AppError ? error : unreachable(input.operation, target.origin));
    });

    if (body) {
      request.write(body);
    }
    request.end();
  });
}
