import type { IRoutingNineRouterClient } from '@/shared/interfaces.js';
import type {
  RoutingClientCredentials,
  RoutingRepository,
  RoutingSettingsDetails,
  RoutingStoredConnection,
} from '@/shared/types.js';
import { AppError } from '@/shared/utils.js';

import type {
  CreateRoutingApiKeyAccountInput,
  CreateRoutingRouteInput,
  RoutingAgent,
  RoutingBindingView,
  RoutingCapabilities,
  RoutingConnectionView,
  RoutingSettingsView,
  RoutingUsageAlertPeriod,
  RoutingUsagePeriod,
  UpdateRoutingAccountInput,
  UpdateRoutingBindingInput,
  UpdateRoutingConnectionInput,
  UpdateRoutingRouteInput,
  UpdateRoutingUsageAlertInput,
  ValidateRoutingConnectionInput,
} from '../../../shared/routing.js';
import {
  emptyRoutingSettingsView,
  ROUTING_AGENTS,
} from '../../../shared/routing.js';

import type { RoutingSecretStore } from './routing-secret-store.js';
import { validateRoutingTarget } from './routing-target-policy.js';

type RoutingServiceDependencies = {
  repository: RoutingRepository;
  secretStore: RoutingSecretStore;
  validateTarget: typeof validateRoutingTarget;
  clientFactory(credentials: RoutingClientCredentials): IRoutingNineRouterClient;
  now?: () => Date;
};

type ValidatedConnection = {
  origin: string;
  adminPassword: string;
  dataPlaneKey: string;
  version: string;
  knownVersion: boolean;
  capabilities: RoutingCapabilities;
};

function safeOperationFailure(): AppError {
  return new AppError('The 9router operation failed', {
    code: 'ROUTING_OPERATION_FAILED',
    statusCode: 502,
  });
}

function notConfigured(): AppError {
  return new AppError('9router is not configured', {
    code: 'ROUTING_NOT_CONFIGURED',
    statusCode: 409,
  });
}

function credentialRequired(): AppError {
  return new AppError('Both 9router credentials are required', {
    code: 'ROUTING_CREDENTIAL_REQUIRED',
    statusCode: 400,
  });
}

function secureStorageUnavailable(): AppError {
  return new AppError('Secure routing credential storage is unavailable', {
    code: 'ROUTING_SECURE_STORAGE_UNAVAILABLE',
    statusCode: 503,
  });
}

function runtimeUnsupported(): AppError {
  return new AppError('This agent cannot use 9router', {
    code: 'ROUTING_RUNTIME_UNSUPPORTED',
    statusCode: 400,
  });
}

function routeRequired(): AppError {
  return new AppError('A valid 9router route is required', {
    code: 'ROUTING_ROUTE_REQUIRED',
    statusCode: 400,
  });
}

function safeAppError(error: unknown): AppError {
  return error instanceof AppError ? error : safeOperationFailure();
}

function connectionStatusFromError(error: AppError): RoutingConnectionView['status'] {
  return error.code === 'ROUTING_UNREACHABLE' || error.code === 'ROUTING_UPSTREAM_TIMEOUT'
    ? 'offline'
    : 'degraded';
}

function runtimeCapability(
  provider: RoutingAgent,
): keyof Pick<
  RoutingCapabilities,
  'claudeRuntime' | 'codexRuntime' | 'openCodeRuntime' | 'cursorRuntime'
> {
  switch (provider) {
    case 'claude':
      return 'claudeRuntime';
    case 'codex':
      return 'codexRuntime';
    case 'opencode':
      return 'openCodeRuntime';
    case 'cursor':
      return 'cursorRuntime';
  }
}

function connectionView(
  connection: RoutingStoredConnection,
  secureStorageAvailable: boolean,
): RoutingConnectionView {
  const defaults = emptyRoutingSettingsView().connection;
  return {
    configured: true,
    baseUrl: connection.baseUrl,
    status: connection.lastErrorCode ? 'degraded' : 'connected',
    version: connection.upstreamVersion,
    hasAdminCredential: Boolean(connection.adminSecretCiphertext),
    hasDataPlaneKey: Boolean(connection.dataPlaneKeyCiphertext),
    secureStorageAvailable,
    lastCheckedAt: connection.lastCheckedAt,
    lastError: connection.lastErrorCode
      ? {
          code: connection.lastErrorCode,
          message: 'The previous 9router connection check failed',
          retryable: true,
        }
      : null,
    capabilities: connection.capabilities
      ? { ...connection.capabilities, cursorRuntime: false }
      : { ...defaults.capabilities },
  };
}

function validatedConnectionView(
  validation: ValidatedConnection,
  secureStorageAvailable: boolean,
  configured: boolean,
  checkedAt: string,
): RoutingConnectionView {
  return {
    configured,
    baseUrl: validation.origin,
    status: 'connected',
    version: validation.version,
    hasAdminCredential: configured,
    hasDataPlaneKey: configured,
    secureStorageAvailable,
    lastCheckedAt: checkedAt,
    lastError: null,
    capabilities: { ...validation.capabilities, cursorRuntime: false },
  };
}

function bindingView(
  provider: RoutingAgent,
  source: 'native' | '9router',
  routeId: string | null,
  routeName: string | null,
): RoutingBindingView {
  return {
    provider,
    source,
    routeId,
    routeName,
    supported: provider !== 'cursor',
  };
}

/**
 * Used by routing module assembly and focused tests to build the user-scoped
 * application workflow. Remote validation completes before encrypted metadata
 * is persisted, and every returned shape is safe for authenticated HTTP routes.
 */
export function createRoutingService(dependencies: RoutingServiceDependencies) {
  const now = dependencies.now ?? (() => new Date());

  function openCredentials(
    userId: number,
    connection: RoutingStoredConnection,
  ): RoutingClientCredentials {
    return {
      baseUrl: connection.baseUrl,
      adminPassword: dependencies.secretStore.open(
        userId,
        'admin-password',
        connection.adminSecretCiphertext,
      ),
      dataPlaneKey: dependencies.secretStore.open(
        userId,
        'data-plane-key',
        connection.dataPlaneKeyCiphertext,
      ),
    };
  }

  function clientForUser(userId: number): IRoutingNineRouterClient {
    const connection = dependencies.repository.getConnection(userId);
    if (!connection) {
      throw notConfigured();
    }
    try {
      return dependencies.clientFactory(openCredentials(userId, connection));
    } catch (error) {
      throw safeAppError(error);
    }
  }

  async function callSafely<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      throw safeAppError(error);
    }
  }

  function resolveSecret(
    userId: number,
    purpose: 'admin-password' | 'data-plane-key',
    replacement: string | undefined,
    existingEnvelope: string | undefined,
  ): string {
    if (replacement !== undefined) {
      if (!replacement) {
        throw credentialRequired();
      }
      return replacement;
    }
    if (!existingEnvelope) {
      throw credentialRequired();
    }
    return dependencies.secretStore.open(userId, purpose, existingEnvelope);
  }

  async function validateInputConnection(
    userId: number,
    input: ValidateRoutingConnectionInput,
  ): Promise<ValidatedConnection> {
    if (input.clearAdminPassword || input.clearDataPlaneKey) {
      throw credentialRequired();
    }
    const target = await callSafely(() => dependencies.validateTarget(input.baseUrl));
    const existing = dependencies.repository.getConnection(userId);
    let adminPassword: string;
    let dataPlaneKey: string;
    try {
      adminPassword = resolveSecret(
        userId,
        'admin-password',
        input.adminPassword,
        existing?.adminSecretCiphertext,
      );
      dataPlaneKey = resolveSecret(
        userId,
        'data-plane-key',
        input.dataPlaneKey,
        existing?.dataPlaneKeyCiphertext,
      );
    } catch (error) {
      throw safeAppError(error);
    }

    let client: IRoutingNineRouterClient;
    try {
      client = dependencies.clientFactory({
        baseUrl: target.origin,
        adminPassword,
        dataPlaneKey,
      });
    } catch (error) {
      throw safeAppError(error);
    }
    const validation = await callSafely(() => client.validateConnection());
    return {
      origin: target.origin,
      adminPassword,
      dataPlaneKey,
      version: validation.version,
      knownVersion: validation.knownVersion,
      capabilities: { ...validation.capabilities, cursorRuntime: false },
    };
  }

  return {
    async getSettings(
      userId: number,
      details: RoutingSettingsDetails = {},
    ): Promise<RoutingSettingsView> {
      const settings = emptyRoutingSettingsView();
      settings.connection.secureStorageAvailable = dependencies.secretStore.available;
      const connection = dependencies.repository.getConnection(userId);
      if (!connection) {
        return settings;
      }

      settings.connection = connectionView(connection, dependencies.secretStore.available);
      for (const stored of dependencies.repository.getProviderDefaults(userId)) {
        if (!ROUTING_AGENTS.includes(stored.provider)) continue;
        settings.bindings[stored.provider] =
          stored.provider === 'cursor'
            ? bindingView('cursor', 'native', null, null)
            : bindingView(stored.provider, stored.source, stored.routeId, stored.routeName);
      }
      settings.usageAlerts = dependencies.repository.listAlerts(userId).map((alert) => ({
        period: alert.period,
        enabled: alert.enabled,
        thresholdMicrousd: alert.thresholdMicrousd,
      }));

      const capabilities = settings.connection.capabilities;
      if (!capabilities.readAccounts && !capabilities.readRoutes && !capabilities.readUsage) {
        return settings;
      }

      try {
        const client = clientForUser(userId);
        if (capabilities.readAccounts) {
          const accounts = await client.listAccounts();
          settings.accountSummary = {
            total: accounts.length,
            degraded: accounts.filter((account) =>
              ['cooling', 'limited', 'failed'].includes(account.status),
            ).length,
          };
          if (details.accounts) settings.accounts = accounts;
        }
        if (capabilities.readRoutes) {
          const routes = await client.listRoutes();
          settings.routeSummary = { total: routes.length };
          if (details.routes) settings.routes = routes;
          if (details.models) settings.models = await client.listModels();
        }
        if (capabilities.readUsage && details.usage) {
          settings.usage = await client.getUsage(details.usage);
        }
      } catch (error) {
        const safeError = safeAppError(error);
        settings.connection.status = connectionStatusFromError(safeError);
        settings.connection.lastError = {
          code: safeError.code,
          message: safeError.message,
          retryable: safeError.statusCode >= 500,
        };
      }
      return settings;
    },

    async connect(
      userId: number,
      input: UpdateRoutingConnectionInput,
    ): Promise<RoutingConnectionView> {
      if (!dependencies.secretStore.available) {
        throw secureStorageUnavailable();
      }
      const validation = await validateInputConnection(userId, input);
      const checkedAt = now().toISOString();
      let adminSecretCiphertext: string;
      let dataPlaneKeyCiphertext: string;
      try {
        adminSecretCiphertext = dependencies.secretStore.seal(
          userId,
          'admin-password',
          validation.adminPassword,
        );
        dataPlaneKeyCiphertext = dependencies.secretStore.seal(
          userId,
          'data-plane-key',
          validation.dataPlaneKey,
        );
      } catch (error) {
        throw safeAppError(error);
      }
      dependencies.repository.upsertConnection(userId, {
        baseUrl: validation.origin,
        adminSecretCiphertext,
        dataPlaneKeyCiphertext,
        upstreamVersion: validation.version,
        capabilities: validation.capabilities,
        lastCheckedAt: checkedAt,
        lastErrorCode: null,
      });
      return validatedConnectionView(
        validation,
        dependencies.secretStore.available,
        true,
        checkedAt,
      );
    },

    async validateConnection(
      userId: number,
      input: ValidateRoutingConnectionInput,
    ): Promise<RoutingConnectionView> {
      const validation = await validateInputConnection(userId, input);
      return validatedConnectionView(
        validation,
        dependencies.secretStore.available,
        false,
        now().toISOString(),
      );
    },

    async disconnect(userId: number): Promise<void> {
      dependencies.repository.deleteConnectionAndSettings(userId);
    },

    async setProviderBinding(
      userId: number,
      provider: RoutingAgent,
      input: UpdateRoutingBindingInput,
    ): Promise<RoutingBindingView> {
      if (input.source === 'native') {
        dependencies.repository.setProviderDefault(userId, provider, { source: 'native' });
        return bindingView(provider, 'native', null, null);
      }
      if (provider === 'cursor') {
        throw runtimeUnsupported();
      }
      if (typeof input.routeId !== 'string' || !input.routeId) {
        throw routeRequired();
      }
      const connection = dependencies.repository.getConnection(userId);
      if (!connection) {
        throw notConfigured();
      }
      if (connection.capabilities?.[runtimeCapability(provider)] !== true) {
        throw runtimeUnsupported();
      }
      const client = clientForUser(userId);
      const route = await callSafely(() => client.getRoute(input.routeId as string));
      dependencies.repository.setProviderDefault(userId, provider, {
        source: '9router',
        routeId: route.id,
        routeName: route.name,
      });
      return bindingView(provider, '9router', route.id, route.name);
    },

    async listModels(userId: number) {
      const client = clientForUser(userId);
      return callSafely(() => client.listModels());
    },

    async listAccounts(userId: number) {
      const client = clientForUser(userId);
      return callSafely(() => client.listAccounts());
    },

    async createApiKeyAccount(userId: number, input: CreateRoutingApiKeyAccountInput) {
      const client = clientForUser(userId);
      return callSafely(() => client.createApiKeyAccount(input));
    },

    async updateAccount(userId: number, id: string, input: UpdateRoutingAccountInput) {
      const client = clientForUser(userId);
      return callSafely(() => client.updateAccount(id, input));
    },

    async deleteAccount(userId: number, id: string): Promise<void> {
      const client = clientForUser(userId);
      await callSafely(() => client.deleteAccount(id));
    },

    async testAccount(userId: number, id: string) {
      const client = clientForUser(userId);
      return callSafely(() => client.testAccount(id));
    },

    async listRoutes(userId: number) {
      const client = clientForUser(userId);
      return callSafely(() => client.listRoutes());
    },

    async getRoute(userId: number, id: string) {
      const client = clientForUser(userId);
      return callSafely(() => client.getRoute(id));
    },

    async createRoute(userId: number, input: CreateRoutingRouteInput) {
      const client = clientForUser(userId);
      return callSafely(() => client.createRoute(input));
    },

    async updateRoute(userId: number, id: string, input: UpdateRoutingRouteInput) {
      const client = clientForUser(userId);
      return callSafely(() => client.updateRoute(id, input));
    },

    async deleteRoute(userId: number, id: string): Promise<void> {
      const client = clientForUser(userId);
      await callSafely(() => client.deleteRoute(id));
    },

    async getUsage(userId: number, period: RoutingUsagePeriod) {
      const client = clientForUser(userId);
      return callSafely(() => client.getUsage(period));
    },

    async setUsageAlert(
      userId: number,
      period: RoutingUsageAlertPeriod,
      input: UpdateRoutingUsageAlertInput,
    ) {
      dependencies.repository.upsertAlert(userId, { period, ...input });
      return { period, ...input };
    },
  };
}
