import { routingDb } from '@/modules/database/index.js';
import { createNotificationEvent, notifyUserIfEnabled } from '@/modules/notifications/index.js';

import { NineRouterClient } from './nine-router-client.js';
import { requestNineRouterJson } from './nine-router-http.js';
import { createRoutingRouter } from './routing.routes.js';
import { createRoutingRuntimeService } from './routing-runtime.service.js';
import { createRoutingSecretStore } from './routing-secret-store.js';
import { createRoutingService } from './routing.service.js';
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

/** Used by server startup after database initialization to begin advisory usage checks. */
export function startRoutingUsageMonitor(): void {
  usageMonitor.start();
}

/** Used by server shutdown to stop future advisory usage checks. */
export function stopRoutingUsageMonitor(): void {
  usageMonitor.stop();
}
