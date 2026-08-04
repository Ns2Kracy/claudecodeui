/**
 * Auto-connect 9router from environment variables at server startup.
 *
 * When CLOUDCLI_ROUTING_BASE_URL, CLOUDCLI_ROUTING_ADMIN_PASSWORD, and
 * CLOUDCLI_ROUTING_DATA_PLANE_KEY are all set (together with the secret
 * key), this module validates the connection against the upstream and
 * persists encrypted credentials for every existing user who does not
 * already have a 9router connection.
 *
 * This makes the feature zero-touch for container deployments:
 * set four env vars and the Settings > 9Router page is ready on first login.
 */

import { routingDb, userDb } from '@/modules/database/index.js';

import type { createRoutingService } from './routing.service.js';
import { validateRoutingTarget } from './routing-target-policy.js';

type AutoConnectDependencies = {
  /** The assembled routing application service (must have secretStore.available === true). */
  routingService: ReturnType<typeof createRoutingService>;
};

function readOptionalEnv(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value || undefined;
}

/** True when the deployment has supplied all four required env vars for provisioning. */
export function hasAutoConnectEnv(): boolean {
  return Boolean(
    readOptionalEnv('CLOUDCLI_ROUTING_BASE_URL')
      && readOptionalEnv('CLOUDCLI_ROUTING_ADMIN_PASSWORD')
      && readOptionalEnv('CLOUDCLI_ROUTING_DATA_PLANE_KEY'),
  );
}

/**
 * Validates the upstream and persists encrypted credentials for every
 * existing user who does not yet have a 9router connection.
 *
 * Logs a clear success/failure line for each user.  A failure for one
 * user (e.g. a temporary network blip) does not abort the loop;
 * remaining users are still attempted.
 */
export async function tryAutoConnect(dependencies: AutoConnectDependencies): Promise<void> {
  const baseUrl = readOptionalEnv('CLOUDCLI_ROUTING_BASE_URL');
  const adminPassword = readOptionalEnv('CLOUDCLI_ROUTING_ADMIN_PASSWORD');
  const dataPlaneKey = readOptionalEnv('CLOUDCLI_ROUTING_DATA_PLANE_KEY');

  if (!baseUrl || !adminPassword || !dataPlaneKey) {
    return;
  }

  const targetOrigin = await validateRoutingTarget(baseUrl).then(
    (target) => target.origin,
    (error) => {
      console.warn(
        '[Routing] Skipping auto-connect: failed to validate target %s — %s',
        baseUrl,
        (error as Error).message ?? String(error),
      );
      return null;
    },
  );
  if (!targetOrigin) return;

  const connectedUserIds = new Set(routingDb.listConnectionUserIds());

  const candidateIds: number[] = [];
  // Iterate through all active users; scan from id 1 upwards until no more user rows exist.
  for (let id = 1; ; id += 1) {
    const user = userDb.getUserById(id);
    if (!user) break;
    if (!connectedUserIds.has(user.id)) {
      candidateIds.push(user.id);
    }
  }

  if (candidateIds.length === 0) {
    console.log('[Routing] All existing users already have a 9router connection; skipping auto-connect.');
    return;
  }

  for (const userId of candidateIds) {
    try {
      await dependencies.routingService.connect(userId, { baseUrl: targetOrigin, adminPassword, dataPlaneKey });
      console.log('[Routing] Auto-connected 9router for user %d (%s)', userId, targetOrigin);
    } catch (error) {
      console.warn(
        '[Routing] Auto-connect failed for user %d — %s',
        userId,
        (error as Error).message ?? String(error),
      );
      // Continue with remaining users; a single failure is not fatal.
    }
  }
}
