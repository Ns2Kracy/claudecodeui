import { routingDb } from '@/modules/database/index.js';

import { NineRouterClient } from './nine-router-client.js';
import { requestNineRouterJson } from './nine-router-http.js';
import { createRoutingRouter } from './routing.routes.js';
import { createRoutingRuntimeService } from './routing-runtime.service.js';
import { createRoutingSecretStore } from './routing-secret-store.js';
import { createRoutingService } from './routing.service.js';
import { validateRoutingTarget } from './routing-target-policy.js';

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

/** Used by server startup; Task 14 supplies the explicit advisory-usage monitor lifecycle. */
export function startRoutingUsageMonitor(): void {}

/** Used by server shutdown; Task 14 supplies the explicit advisory-usage monitor lifecycle. */
export function stopRoutingUsageMonitor(): void {}
