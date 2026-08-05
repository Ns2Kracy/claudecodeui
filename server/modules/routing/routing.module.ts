import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { promises as fsPromises } from 'node:fs';
import net from 'node:net';

import { appConfigDb, getDatabasePath, routingDb } from '@/modules/database/index.js';
import { createNotificationEvent, notifyUserIfEnabled } from '@/modules/notifications/index.js';

import { NineRouterClient } from './nine-router-client.js';
import { requestNineRouterJson } from './nine-router-http.js';
import { createNineRouterRuntimeService, type NineRouterRuntimeServiceDependencies } from './nine-router-runtime.service.js';
import { createRoutingOAuthCallbackRouter } from './routing-oauth-callback.routes.js';
import { createRoutingOAuthService } from './routing-oauth.service.js';
import { createRoutingRouter } from './routing.routes.js';
import { createRoutingRuntimeService } from './routing-runtime.service.js';
import { createRoutingService } from './routing.service.js';
import { tryAutoConnect } from './routing-auto-connect.js';
import { createRoutingUsageMonitor } from './routing-usage-monitor.js';

const clientFactory = (credentials: {
  baseUrl: string;
  adminPassword: string;
  dataPlaneKey: string;
}) =>
  new NineRouterClient({
    ...credentials,
    request: requestNineRouterJson,
  });

function routingServiceClientForRuntime() {
  const runtime = getEmbeddedNineRouterRuntime();
  const status = runtime.getStatus();
  const credentials = runtime.getInternalCredentials();
  return clientFactory({
    baseUrl: status.origin ?? 'http://127.0.0.1:20128',
    adminPassword: credentials.initialPassword,
    dataPlaneKey: credentials.dataPlaneKey,
  });
}

const routingOAuthService = createRoutingOAuthService({
  clientForRuntime: () => routingServiceClientForRuntime(),
});

/** Used by the routing HTTP router to execute authenticated application workflows. */
export const routingService = createRoutingService({
  repository: routingDb,
  runtime: {
    getStatus: () => getEmbeddedNineRouterRuntime().getStatus(),
    getInternalCredentials: () => getEmbeddedNineRouterRuntime().getInternalCredentials(),
    restart: () => getEmbeddedNineRouterRuntime().restart(),
  },
  clientFactory,
  oauth: routingOAuthService,
});

/** Used by provider session creation and run dispatch for sticky per-session routing. */
export const routingRuntimeService = createRoutingRuntimeService({
  repository: routingDb,
  runtime: {
    getStatus: () => getEmbeddedNineRouterRuntime().getStatus(),
    getInternalCredentials: () => getEmbeddedNineRouterRuntime().getInternalCredentials(),
  },
  clientFactory,
});

/** Used by server composition to mount unauthenticated static OAuth callback acks before protected routing routes. */
export const routingOAuthCallbackRoutes = createRoutingOAuthCallbackRouter();

/** Used by the server composition root to mount the protected routing API. */
export const routingRoutes = createRoutingRouter(routingService);

function formatMicrousd(value: number): string {
  const decimal = (value / 1_000_000).toFixed(6).replace(/0+$/, '').replace(/\.$/, '');
  return `$${decimal || '0'}`;
}

const usageMonitor = createRoutingUsageMonitor({
  repository: routingDb,
  getUsage: (userId, period) => routingService.getUsage(userId, period),
  notify: (userId, usageEvent) => {
    const periodLabel = usageEvent.period === 'daily' ? 'daily' : 'rolling 30-day';
    const message = `9Router ${periodLabel} usage reached ${formatMicrousd(usageEvent.estimatedCostMicrousd)} (advisory alert at ${formatMicrousd(usageEvent.thresholdMicrousd)}).`;
    const event = createNotificationEvent({
      provider: 'system',
      kind: 'info',
      code: 'agent.notification',
      severity: 'warning',
      meta: {
        ...usageEvent,
        message,
      },
    });
    return notifyUserIfEnabled({
      userId,
      event: {
        ...event,
        dedupeKey: `9router:usage:${userId}:${usageEvent.periodKey}`,
      },
    });
  },
  reportError: (error, context) => {
    const code = typeof error === 'object' && error !== null && 'code' in error
      ? String(error.code)
      : 'ROUTING_USAGE_CHECK_FAILED';
    console.warn('[Routing] Usage monitor check failed', { ...context, code });
  },
});

const require = createRequire(import.meta.url);

const embeddedNineRouterSecretKeys = {
  jwtSecret: 'nine_router_jwt_secret',
  initialPassword: 'nine_router_initial_password',
  apiKeySecret: 'nine_router_api_key_secret',
  dataPlaneKey: 'nine_router_data_plane_key',
  machineIdSalt: 'nine_router_machine_id_salt',
} as const;

type EmbeddedNineRouterRuntime = ReturnType<typeof createNineRouterRuntimeService>;
type EmbeddedNineRouterFactory = () => EmbeddedNineRouterRuntime;
const MAX_HEALTH_PAYLOAD_BYTES = 512;
const MAX_KEY_PAYLOAD_BYTES = 2048;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function boundedJson(response: Response): Promise<unknown> {
  const contentLength = response.headers.get('content-length');
  if (contentLength !== null && Number(contentLength) > MAX_HEALTH_PAYLOAD_BYTES) return null;
  const body = await response.text();
  if (Buffer.byteLength(body, 'utf8') > MAX_HEALTH_PAYLOAD_BYTES) return null;
  try {
    return JSON.parse(body) as unknown;
  } catch {
    return null;
  }
}

function createPortAvailability(): NineRouterRuntimeServiceDependencies['portAvailability'] {
  return {
    isAvailable: (host, port) => new Promise<boolean>((resolve) => {
      const socket = net.createConnection({ host, port });
      const finish = (available: boolean) => {
        socket.removeAllListeners();
        socket.destroy();
        resolve(available);
      };
      socket.once('connect', () => finish(false));
      socket.once('error', () => finish(true));
      socket.setTimeout(1_000, () => finish(false));
    }),
  };
}

function createBoundedLoopbackHealthChecker(): NineRouterRuntimeServiceDependencies['health'] {
  return {
    async check(baseUrl) {
      const timeout = AbortSignal.timeout(1_000);
      let healthResponse: Response;
      let versionResponse: Response;
      try {
        [healthResponse, versionResponse] = await Promise.all([
          fetch(`${baseUrl}/api/health`, { signal: timeout }),
          fetch(`${baseUrl}/api/version`, { signal: timeout }),
        ]);
      } catch {
        return { ok: false };
      }
      if (!healthResponse.ok || !versionResponse.ok) return { ok: false };
      const healthJson = await boundedJson(healthResponse);
      const versionJson = await boundedJson(versionResponse);
      if (!isRecord(healthJson) || healthJson.ok !== true || !isRecord(versionJson)) return { ok: false };
      const currentVersion = versionJson.currentVersion;
      if (typeof currentVersion !== 'string' || currentVersion.length === 0 || currentVersion.length > 64) {
        return { ok: false };
      }
      return {
        ok: true,
        origin: baseUrl,
        version: currentVersion,
      };
    },
  };
}

function persistedDataPlaneKey(): string {
  return appConfigDb.get(embeddedNineRouterSecretKeys.dataPlaneKey) ?? '';
}

function strictKeyFromResponse(data: unknown): string | null {
  if (!isRecord(data)) return null;
  const key = data.key;
  if (typeof key === 'string') return key;
  if (isRecord(key) && typeof key.key === 'string') return key.key;
  return null;
}

async function boundedProvisionJson(response: Response): Promise<unknown> {
  const contentLength = response.headers.get('content-length');
  if (contentLength !== null && Number(contentLength) > MAX_KEY_PAYLOAD_BYTES) return null;
  const body = await response.text();
  if (Buffer.byteLength(body, 'utf8') > MAX_KEY_PAYLOAD_BYTES) return null;
  try {
    return JSON.parse(body) as unknown;
  } catch {
    return null;
  }
}

async function authenticateManagement(baseUrl: string, adminPassword: string, signal: AbortSignal): Promise<string | undefined> {
  const status = await fetch(`${baseUrl}/api/auth/status`, { signal });
  if (!status.ok) throw new Error('management auth status failed');
  const statusJson = await boundedProvisionJson(status);
  if (!isRecord(statusJson) || typeof statusJson.requireLogin !== 'boolean' || typeof statusJson.authMode !== 'string') {
    throw new Error('management auth status response invalid');
  }
  if (!statusJson.requireLogin) return undefined;
  if (statusJson.authMode !== 'password') throw new Error('management auth mode unsupported');

  const login = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password: adminPassword }),
    signal,
  });
  if (!login.ok) throw new Error('management login failed');
  const loginJson = await boundedProvisionJson(login);
  if (!isRecord(loginJson) || loginJson.success !== true) throw new Error('management login response invalid');
  const cookie = login.headers.getSetCookie?.().find((item) => item.startsWith('auth_token='))?.split(';', 1)[0]
    ?? login.headers.get('set-cookie')?.split(';', 1)[0];
  if (!cookie?.startsWith('auth_token=') || cookie.length <= 'auth_token='.length) {
    throw new Error('management login cookie missing');
  }
  return cookie;
}

/** Used by the production embedded runtime to create one official installation-owned data-plane key. */
export function createOfficialDataPlaneKeyProvisioner() {
  return {
    async provision(baseUrl: string, credentials: { initialPassword: string }): Promise<void> {
      if (persistedDataPlaneKey()) return;
      const signal = AbortSignal.timeout(5_000);
      const cookie = await authenticateManagement(baseUrl, credentials.initialPassword, signal);
      const response = await fetch(`${baseUrl}/api/keys`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(cookie ? { cookie } : {}),
        },
        body: JSON.stringify({ name: 'CloudCLI embedded runtime' }),
        signal,
      });
      if (!response.ok) throw new Error('data-plane key creation failed');
      const key = strictKeyFromResponse(await boundedProvisionJson(response));
      if (!key || key.length > 1024 || !key.startsWith('sk-')) {
        throw new Error('data-plane key creation response invalid');
      }
      appConfigDb.set(embeddedNineRouterSecretKeys.dataPlaneKey, key);
    },
  };
}

/** Used by routing module tests to exercise the same strict health adapter used by the production embedded runtime. */
export function createBoundedLoopbackHealthCheckerForTesting(): NineRouterRuntimeServiceDependencies['health'] {
  return createBoundedLoopbackHealthChecker();
}

/** Used by the production embedded runtime and routing module tests to create and permission its private data directory. */
export function createProductionFilesystemAdapter(): NineRouterRuntimeServiceDependencies['filesystem'] {
  return {
    async ensureDataDir(dataDir, mode) {
      await fsPromises.mkdir(dataDir, { recursive: true, mode });
      await fsPromises.chmod(dataDir, mode);
    },
  };
}

function createDefaultEmbeddedNineRouterRuntime(): EmbeddedNineRouterRuntime {
  const apiKeySecret = appConfigDb.getOrCreateSecret(embeddedNineRouterSecretKeys.apiKeySecret, 32);
  return createNineRouterRuntimeService({
    credentials: {
      jwtSecret: appConfigDb.getOrCreateSecret(embeddedNineRouterSecretKeys.jwtSecret, 32),
      initialPassword: appConfigDb.getOrCreateSecret(embeddedNineRouterSecretKeys.initialPassword, 32),
      apiKeySecret,
      dataPlaneKey: persistedDataPlaneKey,
      machineIdSalt: appConfigDb.getOrCreateSecret(embeddedNineRouterSecretKeys.machineIdSalt, 32),
    },
    databasePath: getDatabasePath(),
    filesystem: createProductionFilesystemAdapter(),
    packageResolver: {
      async resolveOfficialServerPath() {
        try {
          return require.resolve('9router/app/custom-server.js');
        } catch {
          return null;
        }
      },
    },
    processSpawner: { spawn },
    portAvailability: createPortAvailability(),
    health: createBoundedLoopbackHealthChecker(),
    dataPlaneKeyProvisioner: createOfficialDataPlaneKeyProvisioner(),
    clock: {
      now: () => new Date(),
      setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
      clearTimeout: (timer) => clearTimeout(timer as NodeJS.Timeout),
    },
    onStatusChange: (status) => {
      if (status.state === 'ready') {
        usageMonitor.start();
      } else {
        usageMonitor.stop();
      }
    },
  });
}

let embeddedNineRouterRuntime: EmbeddedNineRouterRuntime | null = null;
let embeddedNineRouterFactory: EmbeddedNineRouterFactory = createDefaultEmbeddedNineRouterRuntime;

function getEmbeddedNineRouterRuntime(): EmbeddedNineRouterRuntime {
  embeddedNineRouterRuntime ??= embeddedNineRouterFactory();
  return embeddedNineRouterRuntime;
}

/** Used by routing lifecycle tests to replace process, filesystem, and health adapters without refactoring server startup. */
export function configureEmbeddedNineRouterForTesting(factory: EmbeddedNineRouterFactory): void {
  embeddedNineRouterFactory = factory;
  embeddedNineRouterRuntime = null;
}

/** Used by routing lifecycle tests to restore the production embedded runtime factory. */
export function resetEmbeddedNineRouterForTesting(): void {
  embeddedNineRouterFactory = createDefaultEmbeddedNineRouterRuntime;
  embeddedNineRouterRuntime = null;
}

/** Used by the server composition root after database initialization to start the embedded 9router runtime. */
export async function startEmbeddedNineRouter() {
  return getEmbeddedNineRouterRuntime().start();
}

/** Used by the server shutdown path to await the owned embedded 9router child before process exit. */
export async function stopEmbeddedNineRouter(): Promise<void> {
  await getEmbeddedNineRouterRuntime().stop();
}

/** Used by maintenance routes and tests to restart the embedded 9router runtime without replacing persisted secrets. */
export async function restartEmbeddedNineRouter() {
  return getEmbeddedNineRouterRuntime().restart();
}

/** Used by diagnostics to report the embedded 9router runtime state without exposing credentials. */
export function getEmbeddedNineRouterStatus() {
  return getEmbeddedNineRouterRuntime().getStatus();
}

/** Used by server startup after database initialization to begin advisory usage checks. */
export function startRoutingUsageMonitor(): void {
  usageMonitor.start();
}

/** Used by server shutdown to stop future advisory usage checks. */
export function stopRoutingUsageMonitor(): void {
  usageMonitor.stop();
}

export { tryAutoConnect };
