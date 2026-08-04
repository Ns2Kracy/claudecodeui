import { AppError } from '@/shared/utils.js';

import type {
  CreateRoutingApiKeyAccountInput,
  CreateRoutingRouteInput,
  RoutingAccountView,
  RoutingCapabilities,
  RoutingModelView,
  RoutingRouteView,
  RoutingUsagePeriod,
  RoutingUsageView,
  UpdateRoutingAccountInput,
  UpdateRoutingRouteInput,
} from '../../../shared/routing.js';

import { getNineRouterCapabilityProfile } from './nine-router-capabilities.js';
import { requestNineRouterJson } from './nine-router-http.js';

type NineRouterHttpInput = Parameters<typeof requestNineRouterJson>[0];
type NineRouterHttpResult = Awaited<ReturnType<typeof requestNineRouterJson>>;
type CapabilityProfile = NonNullable<ReturnType<typeof getNineRouterCapabilityProfile>>;
type CapabilityName = keyof RoutingCapabilities;

type NineRouterClientDependencies = {
  baseUrl: string;
  adminPassword: string;
  dataPlaneKey: string;
  request: typeof requestNineRouterJson;
  now?: () => Date;
};

type NineRouterValidationResult = {
  version: string;
  knownVersion: boolean;
  capabilities: RoutingCapabilities;
};

type AccountTestResult = {
  healthy: boolean;
  error: string | null;
  refreshed: boolean;
};

const COOKIE_TTL_MS = 20 * 60 * 60 * 1000;
const MAX_UPSTREAM_STRING_LENGTH = 1024;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function invalidResponse(): AppError {
  return new AppError('9router returned an invalid response', {
    code: 'ROUTING_UPSTREAM_RESPONSE_INVALID',
    statusCode: 502,
  });
}

function authFailed(): AppError {
  return new AppError('9router management authentication failed', {
    code: 'ROUTING_AUTH_FAILED',
    statusCode: 401,
  });
}

function apiKeyRejected(): AppError {
  return new AppError('9router rejected the configured data-plane key', {
    code: 'ROUTING_API_KEY_REJECTED',
    statusCode: 401,
  });
}

function capabilityUnavailable(): AppError {
  return new AppError('This operation is unavailable for the detected 9router version', {
    code: 'ROUTING_CAPABILITY_UNAVAILABLE',
    statusCode: 409,
  });
}

function resourceNotFound(): AppError {
  return new AppError('The requested 9router resource was not found', {
    code: 'ROUTING_RESOURCE_NOT_FOUND',
    statusCode: 404,
  });
}

function operationFailed(): AppError {
  return new AppError('The 9router operation failed', {
    code: 'ROUTING_OPERATION_FAILED',
    statusCode: 502,
  });
}

function requiredString(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    value.length > MAX_UPSTREAM_STRING_LENGTH
  ) {
    throw invalidResponse();
  }
  return value;
}

function optionalString(value: unknown): string | null {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  return requiredString(value);
}

function nullableNumber(value: unknown): number | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (!Number.isFinite(value)) {
    throw invalidResponse();
  }
  return value as number;
}

function nonNegativeNumber(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw invalidResponse();
  }
  return value;
}

function nonNegativeInteger(value: unknown): number {
  const number = nonNegativeNumber(value);
  if (!Number.isSafeInteger(number)) {
    throw invalidResponse();
  }
  return number;
}

function dollarsToMicrousd(value: unknown): number {
  const result = Math.round(nonNegativeNumber(value) * 1_000_000);
  if (!Number.isSafeInteger(result)) {
    throw invalidResponse();
  }
  return result;
}

function expectRecord(data: NineRouterHttpResult['data']): Record<string, unknown> {
  if (!isRecord(data)) {
    throw invalidResponse();
  }
  return data;
}

function assertSuccessStatus(result: NineRouterHttpResult): void {
  if (result.statusCode >= 200 && result.statusCode < 300) {
    return;
  }
  if (result.statusCode === 401 || result.statusCode === 403) {
    throw authFailed();
  }
  if (result.statusCode === 404) {
    throw resourceNotFound();
  }
  throw operationFailed();
}

function sanitizeAccount(value: unknown, now: Date): RoutingAccountView {
  if (!isRecord(value) || typeof value.isActive !== 'boolean') {
    throw invalidResponse();
  }
  const id = requiredString(value.id);
  const provider = requiredString(value.provider);
  const name = optionalString(value.name) ?? optionalString(value.email) ?? provider;
  const authType = requiredString(value.authType);
  const priority = nullableNumber(value.priority);
  const expiresAt = optionalString(value.expiresAt);
  const testStatus = typeof value.testStatus === 'string' ? value.testStatus.toLowerCase() : '';
  const errorCode = typeof value.errorCode === 'string' ? value.errorCode.toLowerCase() : '';
  const rateLimitedUntil = Date.parse(typeof value.rateLimitedUntil === 'string' ? value.rateLimitedUntil : '');

  let status: RoutingAccountView['status'] = 'unknown';
  if (Number.isFinite(rateLimitedUntil) && rateLimitedUntil > now.getTime()) {
    status = 'cooling';
  } else if (['limited', 'rate_limited', 'quota_exceeded'].includes(testStatus) || errorCode.includes('rate')) {
    status = 'limited';
  } else if (['success', 'valid', 'healthy', 'passed'].includes(testStatus)) {
    status = 'healthy';
  } else if (
    ['error', 'failed', 'invalid'].includes(testStatus) ||
    (typeof value.lastError === 'string' && value.lastError.length > 0)
  ) {
    status = 'failed';
  }

  return {
    id,
    provider,
    name,
    authType,
    priority,
    active: value.isActive,
    status,
    lastError:
      typeof value.lastError === 'string' && value.lastError
        ? 'The upstream account reported an error'
        : null,
    expiresAt,
  };
}

function sanitizeModel(value: unknown): RoutingModelView {
  if (!isRecord(value)) {
    throw invalidResponse();
  }
  const provider = requiredString(value.provider);
  const model = requiredString(value.model);
  const id =
    optionalString(value.fullModel) ??
    optionalString(value.routedModel) ??
    `${provider}/${model}`;
  const name = optionalString(value.alias) ?? model;
  return { id, provider, name };
}

function sanitizeRoute(value: unknown): RoutingRouteView {
  if (!isRecord(value) || !Array.isArray(value.models)) {
    throw invalidResponse();
  }
  return {
    id: requiredString(value.id),
    name: requiredString(value.name),
    kind: optionalString(value.kind),
    models: value.models.map(requiredString),
  };
}

function sanitizeUsage(value: unknown, period: RoutingUsagePeriod): RoutingUsageView {
  if (!isRecord(value) || !isRecord(value.byProvider)) {
    throw invalidResponse();
  }
  const byProvider = Object.entries(value.byProvider)
    .map(([id, raw]) => {
      if (!isRecord(raw)) {
        throw invalidResponse();
      }
      return {
        id: requiredString(id),
        requests: nonNegativeInteger(raw.requests),
        costMicrousd: dollarsToMicrousd(raw.cost),
      };
    })
    .sort((first, second) => first.id.localeCompare(second.id));

  return {
    period,
    requests: nonNegativeInteger(value.totalRequests),
    promptTokens: nonNegativeInteger(value.totalPromptTokens),
    completionTokens: nonNegativeInteger(value.totalCompletionTokens),
    estimatedCostMicrousd: dollarsToMicrousd(value.totalCost),
    byProvider,
    staleAt: null,
  };
}

function sanitizedAccountPayload(input: CreateRoutingApiKeyAccountInput): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    provider: input.provider,
    name: input.name,
    apiKey: input.apiKey,
  };
  if (input.priority !== undefined) payload.priority = input.priority;
  return payload;
}

function sanitizedAccountUpdate(input: UpdateRoutingAccountInput): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  if (input.name !== undefined) payload.name = input.name;
  if (input.apiKey !== undefined) payload.apiKey = input.apiKey;
  if (input.priority !== undefined) payload.priority = input.priority;
  if (input.active !== undefined) payload.isActive = input.active;
  return payload;
}

function sanitizedRouteCreate(input: CreateRoutingRouteInput): Record<string, unknown> {
  const payload: Record<string, unknown> = { name: input.name, models: input.models };
  if (input.kind !== undefined) payload.kind = input.kind;
  return payload;
}

function sanitizedRouteUpdate(input: UpdateRoutingRouteInput): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  if (input.name !== undefined) payload.name = input.name;
  if (input.models !== undefined) payload.models = input.models;
  if (input.kind !== undefined) payload.kind = input.kind;
  return payload;
}

/**
 * Used by routing services as the sole typed adapter for the inspected 9router
 * management and data-plane APIs. It owns in-memory dashboard cookies, version
 * gates, response validation, safe DTO mapping, and GET-only auth refresh.
 */
export class NineRouterClient {
  private readonly baseUrl: string;
  private readonly adminPassword: string;
  private readonly dataPlaneKey: string;
  private readonly request: typeof requestNineRouterJson;
  private readonly now: () => Date;
  private profile: CapabilityProfile | null = null;
  private cookie: string | null = null;
  private cookieExpiresAt = 0;
  private authenticationNotRequired = false;

  constructor(dependencies: NineRouterClientDependencies) {
    this.baseUrl = dependencies.baseUrl;
    this.adminPassword = dependencies.adminPassword;
    this.dataPlaneKey = dependencies.dataPlaneKey;
    this.request = dependencies.request;
    this.now = dependencies.now ?? (() => new Date());
  }

  async validateConnection(): Promise<NineRouterValidationResult> {
    const health = await this.request({ baseUrl: this.baseUrl, operation: 'health' });
    assertSuccessStatus(health);
    if (expectRecord(health.data).ok !== true) {
      throw invalidResponse();
    }

    const profile = await this.loadProfile(true);
    await this.ensureAuthenticated(true);
    await this.validateDataPlaneKey();
    if (profile.knownVersion) {
      await this.listModels();
    }

    return {
      version: profile.version,
      knownVersion: profile.knownVersion,
      capabilities: { ...profile.capabilities },
    };
  }

  async listModels(): Promise<RoutingModelView[]> {
    const profile = await this.loadProfile();
    if (!profile.knownVersion) {
      throw capabilityUnavailable();
    }
    const result = await this.managementRequest(
      { baseUrl: this.baseUrl, operation: 'catalogModels' },
      null,
      true,
    );
    const models = expectRecord(result.data).models;
    if (!Array.isArray(models)) {
      throw invalidResponse();
    }
    return models.map(sanitizeModel);
  }

  async listAccounts(): Promise<RoutingAccountView[]> {
    const result = await this.managementRequest(
      { baseUrl: this.baseUrl, operation: 'accountsList' },
      'readAccounts',
      true,
    );
    const connections = expectRecord(result.data).connections;
    if (!Array.isArray(connections)) {
      throw invalidResponse();
    }
    const now = this.now();
    return connections.map((connection) => sanitizeAccount(connection, now));
  }

  async createApiKeyAccount(
    input: CreateRoutingApiKeyAccountInput,
  ): Promise<RoutingAccountView> {
    const result = await this.managementRequest(
      {
        baseUrl: this.baseUrl,
        operation: 'accountCreate',
        body: sanitizedAccountPayload(input),
      },
      'writeApiKeyAccounts',
      false,
    );
    return sanitizeAccount(expectRecord(result.data).connection, this.now());
  }

  async updateAccount(
    id: string,
    input: UpdateRoutingAccountInput,
  ): Promise<RoutingAccountView> {
    const result = await this.managementRequest(
      {
        baseUrl: this.baseUrl,
        operation: 'accountUpdate',
        id,
        body: sanitizedAccountUpdate(input),
      },
      'writeApiKeyAccounts',
      false,
    );
    return sanitizeAccount(expectRecord(result.data).connection, this.now());
  }

  async deleteAccount(id: string): Promise<void> {
    await this.managementRequest(
      { baseUrl: this.baseUrl, operation: 'accountDelete', id },
      'writeApiKeyAccounts',
      false,
    );
  }

  async testAccount(id: string): Promise<AccountTestResult> {
    const result = await this.managementRequest(
      { baseUrl: this.baseUrl, operation: 'accountTest', id },
      'testAccounts',
      false,
    );
    const data = expectRecord(result.data);
    if (typeof data.valid !== 'boolean') {
      throw invalidResponse();
    }
    return {
      healthy: data.valid,
      error:
        data.valid || data.error === null || data.error === undefined
          ? null
          : 'The upstream account test failed',
      refreshed: data.refreshed === true,
    };
  }

  async listRoutes(): Promise<RoutingRouteView[]> {
    const result = await this.managementRequest(
      { baseUrl: this.baseUrl, operation: 'routesList' },
      'readRoutes',
      true,
    );
    const combos = expectRecord(result.data).combos;
    if (!Array.isArray(combos)) {
      throw invalidResponse();
    }
    return combos.map(sanitizeRoute);
  }

  async getRoute(id: string): Promise<RoutingRouteView> {
    const result = await this.managementRequest(
      { baseUrl: this.baseUrl, operation: 'routeGet', id },
      'readRoutes',
      true,
    );
    return sanitizeRoute(result.data);
  }

  async createRoute(input: CreateRoutingRouteInput): Promise<RoutingRouteView> {
    const result = await this.managementRequest(
      {
        baseUrl: this.baseUrl,
        operation: 'routeCreate',
        body: sanitizedRouteCreate(input),
      },
      'writeRoutes',
      false,
    );
    return sanitizeRoute(result.data);
  }

  async updateRoute(
    id: string,
    input: UpdateRoutingRouteInput,
  ): Promise<RoutingRouteView> {
    const result = await this.managementRequest(
      {
        baseUrl: this.baseUrl,
        operation: 'routeUpdate',
        id,
        body: sanitizedRouteUpdate(input),
      },
      'writeRoutes',
      false,
    );
    return sanitizeRoute(result.data);
  }

  async deleteRoute(id: string): Promise<void> {
    await this.managementRequest(
      { baseUrl: this.baseUrl, operation: 'routeDelete', id },
      'writeRoutes',
      false,
    );
  }

  async getUsage(period: RoutingUsagePeriod): Promise<RoutingUsageView> {
    const result = await this.managementRequest(
      { baseUrl: this.baseUrl, operation: 'usageStats', period },
      'readUsage',
      true,
    );
    return sanitizeUsage(result.data, period);
  }

  private async loadProfile(refresh = false): Promise<CapabilityProfile> {
    if (this.profile && !refresh) {
      return this.profile;
    }
    const result = await this.request({ baseUrl: this.baseUrl, operation: 'version' });
    assertSuccessStatus(result);
    const version = expectRecord(result.data).currentVersion;
    if (typeof version !== 'string') {
      throw invalidResponse();
    }
    const profile = getNineRouterCapabilityProfile(version);
    if (!profile) {
      throw invalidResponse();
    }
    this.profile = profile;
    return profile;
  }

  private async ensureAuthenticated(force = false): Promise<void> {
    if (
      !force &&
      (this.authenticationNotRequired ||
        (this.cookie !== null && this.cookieExpiresAt > this.now().getTime()))
    ) {
      return;
    }

    this.invalidateAuthentication();
    const statusResult = await this.request({
      baseUrl: this.baseUrl,
      operation: 'authStatus',
    });
    assertSuccessStatus(statusResult);
    const status = expectRecord(statusResult.data);
    if (typeof status.requireLogin !== 'boolean' || typeof status.authMode !== 'string') {
      throw invalidResponse();
    }
    if (!status.requireLogin) {
      this.authenticationNotRequired = true;
      return;
    }
    if (status.authMode !== 'password') {
      throw authFailed();
    }

    const loginResult = await this.request({
      baseUrl: this.baseUrl,
      operation: 'login',
      body: { password: this.adminPassword },
    });
    if (loginResult.statusCode === 401 || loginResult.statusCode === 403 || loginResult.statusCode === 429) {
      throw authFailed();
    }
    assertSuccessStatus(loginResult);
    if (expectRecord(loginResult.data).success !== true) {
      throw authFailed();
    }
    const cookie = this.readAuthCookie(loginResult.headers['set-cookie']);
    if (!cookie) {
      throw invalidResponse();
    }
    this.cookie = cookie;
    this.cookieExpiresAt = this.now().getTime() + COOKIE_TTL_MS;
  }

  private readAuthCookie(setCookie: string[] | undefined): string | null {
    for (const item of setCookie ?? []) {
      const pair = item.split(';', 1)[0]?.trim();
      if (pair?.startsWith('auth_token=') && pair.length > 'auth_token='.length) {
        return pair;
      }
    }
    return null;
  }

  private invalidateAuthentication(): void {
    this.cookie = null;
    this.cookieExpiresAt = 0;
    this.authenticationNotRequired = false;
  }

  private async validateDataPlaneKey(): Promise<void> {
    const result = await this.request({
      baseUrl: this.baseUrl,
      operation: 'dataPlaneModels',
      authorization: `Bearer ${this.dataPlaneKey}`,
    });
    if (result.statusCode === 401 || result.statusCode === 403) {
      throw apiKeyRejected();
    }
    assertSuccessStatus(result);
    const models = expectRecord(result.data).data;
    if (!Array.isArray(models)) {
      throw invalidResponse();
    }
    for (const model of models) {
      if (!isRecord(model) || typeof model.id !== 'string') {
        throw invalidResponse();
      }
    }
  }

  private async managementRequest(
    input: NineRouterHttpInput,
    capability: CapabilityName | null,
    retryGetAfterAuth: boolean,
  ): Promise<NineRouterHttpResult> {
    const profile = await this.loadProfile();
    if (capability && profile.capabilities[capability] !== true) {
      throw capabilityUnavailable();
    }
    await this.ensureAuthenticated();

    const send = () =>
      this.request({
        ...input,
        cookie: this.cookie ?? undefined,
      });
    let result = await send();
    if (result.statusCode === 401) {
      this.invalidateAuthentication();
      if (!retryGetAfterAuth) {
        throw authFailed();
      }
      await this.ensureAuthenticated(true);
      result = await send();
    }
    assertSuccessStatus(result);
    return result;
  }
}
