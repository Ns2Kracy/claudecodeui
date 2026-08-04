import { getConnection } from '@/modules/database/connection.js';
import type {
  RoutingBindingPersistenceInput,
  RoutingConnectionPersistenceInput,
  RoutingRepository,
  RoutingStoredAlert,
  RoutingStoredBinding,
  RoutingStoredConnection,
} from '@/shared/types.js';

import type {
  RoutingAgent,
  RoutingCapabilities,
  RoutingUsageAlertPeriod,
} from '../../../../shared/routing.js';

type RoutingConnectionRow = {
  user_id: number;
  base_url: string;
  admin_secret_ciphertext: string;
  data_plane_key_ciphertext: string;
  upstream_version: string | null;
  capabilities_json: string | null;
  last_checked_at: string | null;
  last_error_code: string | null;
};

type RoutingBindingRow = {
  provider: RoutingAgent;
  source: RoutingStoredBinding['source'];
  route_id: string | null;
  route_name: string | null;
};

type RoutingAlertRow = {
  period: RoutingUsageAlertPeriod;
  threshold_microusd: number;
  enabled: number;
  last_notified_period_key: string | null;
};

function normalizeCapabilities(value: string | null): RoutingCapabilities | null {
  if (!value) {
    return null;
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return null;
    }
    const capabilities = parsed as Record<string, unknown>;
    return {
      readAccounts: capabilities.readAccounts === true,
      writeApiKeyAccounts: capabilities.writeApiKeyAccounts === true,
      testAccounts: capabilities.testAccounts === true,
      readRoutes: capabilities.readRoutes === true,
      writeRoutes: capabilities.writeRoutes === true,
      readUsage: capabilities.readUsage === true,
      claudeRuntime: capabilities.claudeRuntime === true,
      codexRuntime: capabilities.codexRuntime === true,
      openCodeRuntime: capabilities.openCodeRuntime === true,
      cursorRuntime: false,
    };
  } catch {
    return null;
  }
}

function normalizeConnection(row: RoutingConnectionRow | undefined): RoutingStoredConnection | null {
  if (!row) {
    return null;
  }

  return {
    userId: row.user_id,
    baseUrl: row.base_url,
    adminSecretCiphertext: row.admin_secret_ciphertext,
    dataPlaneKeyCiphertext: row.data_plane_key_ciphertext,
    upstreamVersion: row.upstream_version,
    capabilities: normalizeCapabilities(row.capabilities_json),
    lastCheckedAt: row.last_checked_at,
    lastErrorCode: row.last_error_code,
  };
}

function normalizeBinding(row: RoutingBindingRow | undefined): RoutingStoredBinding | null {
  if (!row) {
    return null;
  }

  return {
    provider: row.provider,
    source: row.source,
    routeId: row.route_id,
    routeName: row.route_name,
  };
}

function normalizeAlert(row: RoutingAlertRow): RoutingStoredAlert {
  return {
    period: row.period,
    thresholdMicrousd: row.threshold_microusd,
    enabled: row.enabled === 1,
    lastNotifiedPeriodKey: row.last_notified_period_key,
  };
}

function normalizedRouteFields(binding: RoutingBindingPersistenceInput): {
  routeId: string | null;
  routeName: string | null;
} {
  if (binding.source === 'native') {
    return { routeId: null, routeName: null };
  }
  return {
    routeId: binding.routeId ?? null,
    routeName: binding.routeName ?? null,
  };
}

function assertIntegerMicrousd(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError('Routing alert threshold must be a non-negative integer micro-USD value');
  }
}

/**
 * Used by the routing application module to persist encrypted connection metadata,
 * sticky provider/session bindings, and advisory usage alert settings per user.
 */
export const routingDb: RoutingRepository = {
  getConnection(userId: number): RoutingStoredConnection | null {
    const row = getConnection()
      .prepare(
        `SELECT user_id, base_url, admin_secret_ciphertext, data_plane_key_ciphertext,
                upstream_version, capabilities_json, last_checked_at, last_error_code
         FROM routing_connections
         WHERE user_id = ?`,
      )
      .get(userId) as RoutingConnectionRow | undefined;
    return normalizeConnection(row);
  },

  upsertConnection(userId: number, connection: RoutingConnectionPersistenceInput): void {
    getConnection()
      .prepare(
        `INSERT INTO routing_connections (
           user_id, base_url, admin_secret_ciphertext, data_plane_key_ciphertext,
           upstream_version, capabilities_json, last_checked_at, last_error_code
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(user_id) DO UPDATE SET
           base_url = excluded.base_url,
           admin_secret_ciphertext = excluded.admin_secret_ciphertext,
           data_plane_key_ciphertext = excluded.data_plane_key_ciphertext,
           upstream_version = excluded.upstream_version,
           capabilities_json = excluded.capabilities_json,
           last_checked_at = excluded.last_checked_at,
           last_error_code = excluded.last_error_code,
           updated_at = CURRENT_TIMESTAMP`,
      )
      .run(
        userId,
        connection.baseUrl,
        connection.adminSecretCiphertext,
        connection.dataPlaneKeyCiphertext,
        connection.upstreamVersion,
        connection.capabilities ? JSON.stringify(connection.capabilities) : null,
        connection.lastCheckedAt,
        connection.lastErrorCode,
      );
  },

  deleteConnectionAndSettings(userId: number): void {
    const db = getConnection();
    db.transaction(() => {
      db.prepare('DELETE FROM routing_bindings WHERE user_id = ?').run(userId);
      db.prepare('DELETE FROM routing_usage_alerts WHERE user_id = ?').run(userId);
      db.prepare('DELETE FROM routing_connections WHERE user_id = ?').run(userId);
    })();
  },

  listConnectionUserIds(): number[] {
    const rows = getConnection()
      .prepare('SELECT user_id FROM routing_connections ORDER BY user_id')
      .all() as Array<{ user_id: number }>;
    return rows.map((row) => row.user_id);
  },

  getProviderDefaults(userId: number): RoutingStoredBinding[] {
    const rows = getConnection()
      .prepare(
        `SELECT provider, source, route_id, route_name
         FROM routing_bindings
         WHERE user_id = ? AND scope = 'provider' AND scope_id = ''
         ORDER BY provider`,
      )
      .all(userId) as RoutingBindingRow[];
    return rows.map((row) => normalizeBinding(row) as RoutingStoredBinding);
  },

  getProviderDefault(userId: number, provider: RoutingAgent): RoutingStoredBinding | null {
    const row = getConnection()
      .prepare(
        `SELECT provider, source, route_id, route_name
         FROM routing_bindings
         WHERE user_id = ? AND provider = ? AND scope = 'provider' AND scope_id = ''`,
      )
      .get(userId, provider) as RoutingBindingRow | undefined;
    return normalizeBinding(row);
  },

  setProviderDefault(
    userId: number,
    provider: RoutingAgent,
    binding: RoutingBindingPersistenceInput,
  ): void {
    const route = normalizedRouteFields(binding);
    getConnection()
      .prepare(
        `INSERT INTO routing_bindings (
           user_id, provider, scope, scope_id, source, route_id, route_name
         ) VALUES (?, ?, 'provider', '', ?, ?, ?)
         ON CONFLICT(user_id, provider, scope, scope_id) DO UPDATE SET
           source = excluded.source,
           route_id = excluded.route_id,
           route_name = excluded.route_name,
           updated_at = CURRENT_TIMESTAMP`,
      )
      .run(userId, provider, binding.source, route.routeId, route.routeName);
  },

  snapshotSessionBinding(
    userId: number,
    sessionId: string,
    provider: RoutingAgent,
  ): RoutingStoredBinding {
    const db = getConnection();
    return db.transaction(() => {
      const current = db
        .prepare(
          `SELECT provider, source, route_id, route_name
           FROM routing_bindings
           WHERE user_id = ? AND provider = ? AND scope = 'provider' AND scope_id = ''`,
        )
        .get(userId, provider) as RoutingBindingRow | undefined;
      const binding = normalizeBinding(current) ?? {
        provider,
        source: 'native' as const,
        routeId: null,
        routeName: null,
      };

      db.prepare(
        `INSERT INTO routing_bindings (
           user_id, provider, scope, scope_id, source, route_id, route_name
         ) VALUES (?, ?, 'session', ?, ?, ?, ?)
         ON CONFLICT(user_id, provider, scope, scope_id) DO NOTHING`,
      ).run(
        userId,
        provider,
        sessionId,
        binding.source,
        binding.routeId,
        binding.routeName,
      );

      const snapshot = db
        .prepare(
          `SELECT provider, source, route_id, route_name
           FROM routing_bindings
           WHERE user_id = ? AND provider = ? AND scope = 'session' AND scope_id = ?`,
        )
        .get(userId, provider, sessionId) as RoutingBindingRow | undefined;
      const normalized = normalizeBinding(snapshot);
      if (!normalized) {
        throw new Error('Failed to persist routing session binding');
      }
      return normalized;
    })();
  },

  getSessionBinding(userId: number, sessionId: string): RoutingStoredBinding | null {
    const row = getConnection()
      .prepare(
        `SELECT provider, source, route_id, route_name
         FROM routing_bindings
         WHERE user_id = ? AND scope = 'session' AND scope_id = ?
         ORDER BY created_at
         LIMIT 1`,
      )
      .get(userId, sessionId) as RoutingBindingRow | undefined;
    return normalizeBinding(row);
  },

  deleteSessionBinding(userId: number, sessionId: string): void {
    getConnection()
      .prepare(
        `DELETE FROM routing_bindings
         WHERE user_id = ? AND scope = 'session' AND scope_id = ?`,
      )
      .run(userId, sessionId);
  },

  listAlerts(userId: number): RoutingStoredAlert[] {
    const rows = getConnection()
      .prepare(
        `SELECT period, threshold_microusd, enabled, last_notified_period_key
         FROM routing_usage_alerts
         WHERE user_id = ?
         ORDER BY CASE period WHEN 'daily' THEN 0 ELSE 1 END`,
      )
      .all(userId) as RoutingAlertRow[];
    return rows.map(normalizeAlert);
  },

  upsertAlert(
    userId: number,
    alert: Omit<RoutingStoredAlert, 'lastNotifiedPeriodKey'>,
  ): void {
    assertIntegerMicrousd(alert.thresholdMicrousd);
    getConnection()
      .prepare(
        `INSERT INTO routing_usage_alerts (
           user_id, period, threshold_microusd, enabled
         ) VALUES (?, ?, ?, ?)
         ON CONFLICT(user_id, period) DO UPDATE SET
           threshold_microusd = excluded.threshold_microusd,
           enabled = excluded.enabled,
           updated_at = CURRENT_TIMESTAMP`,
      )
      .run(userId, alert.period, alert.thresholdMicrousd, alert.enabled ? 1 : 0);
  },

  markAlertNotified(
    userId: number,
    period: RoutingUsageAlertPeriod,
    periodKey: string,
  ): void {
    getConnection()
      .prepare(
        `UPDATE routing_usage_alerts
         SET last_notified_period_key = ?, updated_at = CURRENT_TIMESTAMP
         WHERE user_id = ? AND period = ?`,
      )
      .run(periodKey, userId, period);
  },
};
