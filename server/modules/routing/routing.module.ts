import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { promises as fsPromises } from 'node:fs';
import net from 'node:net';

import { appConfigDb, getDatabasePath, routingDb } from '@/modules/database/index.js';
import { createNotificationEvent, notifyUserIfEnabled } from '@/modules/notifications/index.js';

import { NineRouterClient } from './nine-router-client.js';
import { requestNineRouterJson } from './nine-router-http.js';
import { createNineRouterRuntimeService, type NineRouterRuntimeServiceDependencies } from './nine-router-runtime.service.js';
import { createRoutingRouter } from './routing.routes.js';
import { createRoutingRuntimeService } from './routing-runtime.service.js';
import { createRoutingSecretStore } from './routing-secret-store.js';
import { createRoutingService } from './routing.service.js';
import { tryAutoConnect } from './routing-auto-connect.js';
import { validateRoutingTarget } from './routing-target-policy.js';
import { createRoutingUsageMonitor } from './routing-usage-monitor.js';

const secretStore = createRoutingSecretStore();
const clientFactory = (credentials: {
  baseUrl: string;
  adminPassword: string;
  dataPlaneKey: string;
}) =>
  new NineRouterClient({
    ...credentials,
    request: requestNineRouterJson,
  });

/** Used by the routing HTTP router to execute authenticated application workflows. */
export const routingService = createRoutingService({
  repository: routingDb,
  secretStore,
  validateTarget: validateRoutingTarget,
  clientFactory,
});

/** Used by provider session creation and run dispatch for sticky per-session routing. */
export const routingRuntimeService = createRoutingRuntimeService({
  repository: routingDb,
  secretStore,
  clientFactory,
});

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
  machineIdSalt: 'nine_router_machine_id_salt',
} as const;

type EmbeddedNineRouterRuntime = ReturnType<typeof createNineRouterRuntimeService>;
type EmbeddedNineRouterFactory = () => EmbeddedNineRouterRuntime;

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
      const [healthResponse, versionResponse] = await Promise.all([
        fetch(`${baseUrl}/api/health`, { signal: timeout }),
        fetch(`${baseUrl}/api/version`, { signal: timeout }),
      ]);
      if (!healthResponse.ok || !versionResponse.ok) return { ok: false };
      const healthJson = await healthResponse.json().catch(() => null) as { status?: unknown; origin?: unknown } | null;
      const versionJson = await versionResponse.json().catch(() => null) as { version?: unknown } | null;
      return {
        ok: healthJson?.status === 'ok' || healthJson?.status === 'healthy' || healthResponse.ok,
        origin: typeof healthJson?.origin === 'string' ? healthJson.origin : '9router',
        version: typeof versionJson?.version === 'string' ? versionJson.version : undefined,
      };
    },
  };
}

function createDefaultEmbeddedNineRouterRuntime(): EmbeddedNineRouterRuntime {
  return createNineRouterRuntimeService({
    credentials: {
      jwtSecret: appConfigDb.getOrCreateSecret(embeddedNineRouterSecretKeys.jwtSecret, 32),
      initialPassword: appConfigDb.getOrCreateSecret(embeddedNineRouterSecretKeys.initialPassword, 32),
      apiKeySecret: appConfigDb.getOrCreateSecret(embeddedNineRouterSecretKeys.apiKeySecret, 32),
      machineIdSalt: appConfigDb.getOrCreateSecret(embeddedNineRouterSecretKeys.machineIdSalt, 32),
    },
    databasePath: getDatabasePath(),
    filesystem: {
      ensureDataDir: (dataDir, mode) => fsPromises.mkdir(dataDir, { recursive: true, mode }).then(() => undefined),
    },
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
    clock: {
      now: () => new Date(),
      setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
      clearTimeout: (timer) => clearTimeout(timer as NodeJS.Timeout),
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
