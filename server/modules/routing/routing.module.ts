import { appConfigDb, routingDb } from '@/modules/database/index.js';
import { createNotificationEvent, notifyUserIfEnabled } from '@/modules/notifications/index.js';

import { NineRouterClient } from './nine-router-client.js';
import { requestNineRouterJson } from './nine-router-http.js';
import { createNineRouterSidecarService, type NineRouterSidecarStatus } from './nine-router-sidecar.service.js';
import { createRoutingOAuthCallbackRouter } from './routing-oauth-callback.routes.js';
import { createRoutingOAuthService } from './routing-oauth.service.js';
import { createRoutingRouter } from './routing.routes.js';
import { createRoutingRuntimeService } from './routing-runtime.service.js';
import { createRoutingService } from './routing.service.js';
import { tryAutoConnect } from './routing-auto-connect.js';
import { createRoutingUsageMonitor } from './routing-usage-monitor.js';

const sidecarSecretKeys = {
  initialPassword: 'nine_router_initial_password',
  dataPlaneKey: 'nine_router_data_plane_key',
} as const;

const clientFactory = (credentials: {
  baseUrl: string;
  adminPassword: string;
  dataPlaneKey: string;
}) =>
  new NineRouterClient({
    ...credentials,
    request: (input) => requestNineRouterJson(input),
  });

function routingServiceClientForRuntime() {
  const sidecar = getNineRouterSidecar();
  const status = sidecar.getStatus();
  const credentials = sidecar.getInternalCredentials();
  return clientFactory({
    baseUrl: status.origin,
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
    getStatus: () => getNineRouterSidecar().getStatus(),
    getInternalCredentials: () => getNineRouterSidecar().getInternalCredentials(),
    restart: () => getNineRouterSidecar().refresh(),
  },
  clientFactory,
  oauth: routingOAuthService,
});

/** Used by provider session creation and run dispatch for sticky per-session routing. */
export const routingRuntimeService = createRoutingRuntimeService({
  repository: routingDb,
  runtime: {
    getStatus: () => getNineRouterSidecar().getStatus(),
    getInternalCredentials: () => getNineRouterSidecar().getInternalCredentials(),
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

type NineRouterSidecar = ReturnType<typeof createNineRouterSidecarService>;
type NineRouterSidecarFactory = () => NineRouterSidecar;
const MAX_HEALTH_PAYLOAD_BYTES = 512;

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

function createRemoteSidecarHealthChecker() {
  return async (baseUrl: string) => {
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
    return typeof currentVersion === 'string' && currentVersion.length > 0 ? { ok: true, version: currentVersion } : { ok: false };
  };
}

/** Used by routing module tests to exercise the production sidecar health adapter. */
export function createRemoteSidecarHealthCheckerForTesting() {
  return createRemoteSidecarHealthChecker();
}

function createDefaultNineRouterSidecar(): NineRouterSidecar {
  return createNineRouterSidecarService({
    baseUrl: process.env.NINE_ROUTER_BASE_URL,
    health: createRemoteSidecarHealthChecker(),
    credentials: {
      initialPassword: appConfigDb.getOrCreateSecret(sidecarSecretKeys.initialPassword, 32),
      dataPlaneKey: appConfigDb.getOrCreateSecret(sidecarSecretKeys.dataPlaneKey, 32),
    },
    onStatusChange: (status) => {
      if (status.state === 'ready') usageMonitor.start();
      else usageMonitor.stop();
    },
  });
}

let nineRouterSidecar: NineRouterSidecar | null = null;
let nineRouterSidecarFactory: NineRouterSidecarFactory = createDefaultNineRouterSidecar;

function getNineRouterSidecar(): NineRouterSidecar {
  nineRouterSidecar ??= nineRouterSidecarFactory();
  return nineRouterSidecar;
}

/** Used by routing lifecycle tests to replace the sidecar health adapter without owning a process. */
export function configureNineRouterSidecarForTesting(factory: NineRouterSidecarFactory): void {
  nineRouterSidecarFactory = factory;
  nineRouterSidecar = null;
}

/** Used by routing lifecycle tests to restore the production sidecar factory. */
export function resetNineRouterSidecarForTesting(): void {
  nineRouterSidecarFactory = createDefaultNineRouterSidecar;
  nineRouterSidecar = null;
}

/** Used by the server composition root after database initialization to refresh sidecar health. */
export async function refreshNineRouterSidecar() {
  return getNineRouterSidecar().refresh();
}

/** Used by diagnostics to report the sidecar state without exposing credentials. */
export function getNineRouterSidecarStatus(): NineRouterSidecarStatus {
  return getNineRouterSidecar().getStatus();
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
