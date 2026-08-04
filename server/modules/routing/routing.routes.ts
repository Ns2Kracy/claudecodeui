import express, { type Request } from 'express';

import { AppError, asyncHandler, createApiSuccessResponse } from '@/shared/utils.js';

import type {
  CreateRoutingApiKeyAccountInput,
  CreateRoutingRouteInput,
  RoutingAgent,
  RoutingUsageAlertPeriod,
  RoutingUsagePeriod,
  UpdateRoutingAccountInput,
  UpdateRoutingBindingInput,
  UpdateRoutingConnectionInput,
  UpdateRoutingRouteInput,
  UpdateRoutingUsageAlertInput,
} from '../../../shared/routing.js';
import { ROUTING_AGENTS } from '../../../shared/routing.js';

import {
  createRoutingMutationGuard,
  createRoutingRateLimiter,
} from './routing-request-guard.js';
import type { createRoutingService } from './routing.service.js';

type AuthenticatedRequest = Request & { user?: { id?: number | string } };
type JsonRecord = Record<string, unknown>;

function invalidRequest(message = 'Invalid routing request'): AppError {
  return new AppError(message, {
    code: 'ROUTING_INVALID_REQUEST',
    statusCode: 400,
  });
}

function userId(request: Request): number {
  const value = Number((request as AuthenticatedRequest).user?.id);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new AppError('An authenticated user is required', {
      code: 'AUTHENTICATED_USER_REQUIRED',
      statusCode: 401,
    });
  }
  return value;
}

function bodyRecord(request: Request): JsonRecord {
  if (!request.body || typeof request.body !== 'object' || Array.isArray(request.body)) {
    throw invalidRequest();
  }
  return request.body as JsonRecord;
}

function requiredString(
  value: unknown,
  fieldName: string,
  maximumLength = 1024,
): string {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    value.length > maximumLength
  ) {
    throw invalidRequest(`${fieldName} is required`);
  }
  return value;
}

function optionalString(
  value: unknown,
  fieldName: string,
  maximumLength = 16_384,
): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || value.length > maximumLength) {
    throw invalidRequest(`${fieldName} must be a string`);
  }
  return value;
}

function optionalNonEmptyString(
  value: unknown,
  fieldName: string,
  maximumLength = 1024,
): string | undefined {
  const result = optionalString(value, fieldName, maximumLength);
  if (result !== undefined && !result.trim()) {
    throw invalidRequest(`${fieldName} must not be empty`);
  }
  return result;
}

function optionalNullableString(
  value: unknown,
  fieldName: string,
  maximumLength = 1024,
): string | null | undefined {
  if (value === null) return null;
  return optionalString(value, fieldName, maximumLength);
}

function optionalBoolean(value: unknown, fieldName: string): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'boolean') {
    throw invalidRequest(`${fieldName} must be a boolean`);
  }
  return value;
}

function optionalInteger(value: unknown, fieldName: string): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw invalidRequest(`${fieldName} must be a non-negative integer`);
  }
  return Number(value);
}

function connectionInput(request: Request): UpdateRoutingConnectionInput {
  const body = bodyRecord(request);
  const input: UpdateRoutingConnectionInput = {
    baseUrl: requiredString(body.baseUrl, 'baseUrl', 2048),
  };
  const adminPassword = optionalString(body.adminPassword, 'adminPassword');
  const dataPlaneKey = optionalString(body.dataPlaneKey, 'dataPlaneKey');
  const clearAdminPassword = optionalBoolean(body.clearAdminPassword, 'clearAdminPassword');
  const clearDataPlaneKey = optionalBoolean(body.clearDataPlaneKey, 'clearDataPlaneKey');
  if (adminPassword !== undefined) input.adminPassword = adminPassword;
  if (dataPlaneKey !== undefined) input.dataPlaneKey = dataPlaneKey;
  if (clearAdminPassword !== undefined) input.clearAdminPassword = clearAdminPassword;
  if (clearDataPlaneKey !== undefined) input.clearDataPlaneKey = clearDataPlaneKey;
  return input;
}

function accountCreateInput(request: Request): CreateRoutingApiKeyAccountInput {
  const body = bodyRecord(request);
  const input: CreateRoutingApiKeyAccountInput = {
    provider: requiredString(body.provider, 'provider', 256),
    name: requiredString(body.name, 'name', 256),
    apiKey: requiredString(body.apiKey, 'apiKey', 16_384),
  };
  const priority = optionalInteger(body.priority, 'priority');
  const active = optionalBoolean(body.active, 'active');
  if (priority !== undefined) input.priority = priority;
  if (active !== undefined) input.active = active;
  return input;
}

function accountUpdateInput(request: Request): UpdateRoutingAccountInput {
  const body = bodyRecord(request);
  const input: UpdateRoutingAccountInput = {};
  const name = optionalNonEmptyString(body.name, 'name', 256);
  const apiKey = optionalNonEmptyString(body.apiKey, 'apiKey', 16_384);
  const priority = optionalInteger(body.priority, 'priority');
  const active = optionalBoolean(body.active, 'active');
  if (name !== undefined) input.name = name;
  if (apiKey !== undefined) input.apiKey = apiKey;
  if (priority !== undefined) input.priority = priority;
  if (active !== undefined) input.active = active;
  if (Object.keys(input).length === 0) throw invalidRequest();
  return input;
}

function stringArray(value: unknown, fieldName: string): string[] {
  if (!Array.isArray(value) || value.length > 500) {
    throw invalidRequest(`${fieldName} must be an array`);
  }
  return value.map((item) => requiredString(item, fieldName, 1024));
}

function routeCreateInput(request: Request): CreateRoutingRouteInput {
  const body = bodyRecord(request);
  const input: CreateRoutingRouteInput = {
    name: requiredString(body.name, 'name', 256),
    models: stringArray(body.models, 'models'),
  };
  const kind = optionalNullableString(body.kind, 'kind', 128);
  if (kind !== undefined) input.kind = kind;
  return input;
}

function routeUpdateInput(request: Request): UpdateRoutingRouteInput {
  const body = bodyRecord(request);
  const input: UpdateRoutingRouteInput = {};
  const name = optionalNonEmptyString(body.name, 'name', 256);
  const kind = optionalNullableString(body.kind, 'kind', 128);
  if (name !== undefined) input.name = name;
  if (body.models !== undefined) input.models = stringArray(body.models, 'models');
  if (kind !== undefined) input.kind = kind;
  if (Object.keys(input).length === 0) throw invalidRequest();
  return input;
}

function providerParam(request: Request): RoutingAgent {
  const provider = requiredString(request.params.provider, 'provider', 32);
  if (!ROUTING_AGENTS.includes(provider as RoutingAgent)) {
    throw invalidRequest('provider is invalid');
  }
  return provider as RoutingAgent;
}

function bindingInput(request: Request): UpdateRoutingBindingInput {
  const body = bodyRecord(request);
  if (body.source !== 'native' && body.source !== '9router') {
    throw invalidRequest('source is invalid');
  }
  const routeId = optionalNullableString(body.routeId, 'routeId', 512);
  return {
    source: body.source,
    ...(routeId !== undefined ? { routeId } : {}),
  };
}

function alertPeriodParam(request: Request): RoutingUsageAlertPeriod {
  const period = requiredString(request.params.period, 'period', 16);
  if (period !== 'daily' && period !== '30d') {
    throw invalidRequest('period is invalid');
  }
  return period;
}

function alertInput(request: Request): UpdateRoutingUsageAlertInput {
  const body = bodyRecord(request);
  if (typeof body.enabled !== 'boolean') {
    throw invalidRequest('enabled must be a boolean');
  }
  if (!Number.isSafeInteger(body.thresholdMicrousd) || Number(body.thresholdMicrousd) < 0) {
    throw invalidRequest('thresholdMicrousd must be a non-negative integer');
  }
  return {
    enabled: body.enabled,
    thresholdMicrousd: Number(body.thresholdMicrousd),
  };
}

function resourceId(request: Request): string {
  return requiredString(request.params.id, 'id', 512);
}

function settingsDetails(request: Request) {
  const raw = typeof request.query.details === 'string' ? request.query.details : '';
  const details: {
    accounts?: boolean;
    models?: boolean;
    routes?: boolean;
    usage?: RoutingUsagePeriod;
  } = {};
  const allowed = new Set(['accounts', 'models', 'routes', 'usage']);
  for (const item of raw.split(',').map((value) => value.trim()).filter(Boolean)) {
    if (!allowed.has(item)) throw invalidRequest('details is invalid');
    if (item === 'usage') {
      const period = typeof request.query.period === 'string' ? request.query.period : 'today';
      if (!['today', '7d', '30d'].includes(period)) {
        throw invalidRequest('period is invalid');
      }
      details.usage = period as RoutingUsagePeriod;
    } else {
      details[item as 'accounts' | 'models' | 'routes'] = true;
    }
  }
  return details;
}

/** Creates the authenticated, same-origin, allowlisted routing HTTP API. */
export function createRoutingRouter(
  service: ReturnType<typeof createRoutingService>,
): express.Router {
  const router = express.Router();
  const mutationGuard = createRoutingMutationGuard();
  const validationLimiter = createRoutingRateLimiter({ limit: 5, windowMs: 60_000 });
  const writeLimiter = createRoutingRateLimiter({ limit: 30, windowMs: 60_000 });
  const writeGuards = [mutationGuard, writeLimiter];

  router.get(
    '/',
    asyncHandler(async (request, response) => {
      response.json(
        createApiSuccessResponse(
          await service.getSettings(userId(request), settingsDetails(request)),
        ),
      );
    }),
  );
  router.put(
    '/connection',
    ...writeGuards,
    asyncHandler(async (request, response) => {
      response.json(
        createApiSuccessResponse(
          await service.connect(userId(request), connectionInput(request)),
        ),
      );
    }),
  );
  router.post(
    '/connection/validations',
    mutationGuard,
    validationLimiter,
    asyncHandler(async (request, response) => {
      response.json(
        createApiSuccessResponse(
          await service.validateConnection(userId(request), connectionInput(request)),
        ),
      );
    }),
  );
  router.delete(
    '/connection',
    ...writeGuards,
    asyncHandler(async (request, response) => {
      await service.disconnect(userId(request));
      response.json(createApiSuccessResponse({ disconnected: true }));
    }),
  );
  router.post(
    '/accounts',
    ...writeGuards,
    asyncHandler(async (request, response) => {
      response.json(
        createApiSuccessResponse(
          await service.createApiKeyAccount(userId(request), accountCreateInput(request)),
        ),
      );
    }),
  );
  router.put(
    '/accounts/:id',
    ...writeGuards,
    asyncHandler(async (request, response) => {
      response.json(
        createApiSuccessResponse(
          await service.updateAccount(
            userId(request),
            resourceId(request),
            accountUpdateInput(request),
          ),
        ),
      );
    }),
  );
  router.post(
    '/accounts/:id/tests',
    ...writeGuards,
    asyncHandler(async (request, response) => {
      response.json(
        createApiSuccessResponse(
          await service.testAccount(userId(request), resourceId(request)),
        ),
      );
    }),
  );
  router.delete(
    '/accounts/:id',
    ...writeGuards,
    asyncHandler(async (request, response) => {
      await service.deleteAccount(userId(request), resourceId(request));
      response.json(createApiSuccessResponse({ deleted: true }));
    }),
  );
  router.post(
    '/routes',
    ...writeGuards,
    asyncHandler(async (request, response) => {
      response.json(
        createApiSuccessResponse(
          await service.createRoute(userId(request), routeCreateInput(request)),
        ),
      );
    }),
  );
  router.put(
    '/routes/:id',
    ...writeGuards,
    asyncHandler(async (request, response) => {
      response.json(
        createApiSuccessResponse(
          await service.updateRoute(
            userId(request),
            resourceId(request),
            routeUpdateInput(request),
          ),
        ),
      );
    }),
  );
  router.delete(
    '/routes/:id',
    ...writeGuards,
    asyncHandler(async (request, response) => {
      await service.deleteRoute(userId(request), resourceId(request));
      response.json(createApiSuccessResponse({ deleted: true }));
    }),
  );
  router.put(
    '/bindings/providers/:provider',
    ...writeGuards,
    asyncHandler(async (request, response) => {
      response.json(
        createApiSuccessResponse(
          await service.setProviderBinding(
            userId(request),
            providerParam(request),
            bindingInput(request),
          ),
        ),
      );
    }),
  );
  router.put(
    '/usage-alerts/:period',
    ...writeGuards,
    asyncHandler(async (request, response) => {
      response.json(
        createApiSuccessResponse(
          await service.setUsageAlert(
            userId(request),
            alertPeriodParam(request),
            alertInput(request),
          ),
        ),
      );
    }),
  );

  return router;
}
