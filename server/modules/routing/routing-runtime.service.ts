import type { IRoutingNineRouterClient } from '@/shared/interfaces.js';
import type {
  RoutingClientCredentials,
  RoutingRepository,
  RuntimeRoutingConfiguration,
} from '@/shared/types.js';
import { AppError } from '@/shared/utils.js';

import type { RoutingAgent } from '../../../shared/routing.js';

import type { RoutingSecretStore } from './routing-secret-store.js';

type RoutingRuntimeServiceDependencies = {
  repository: RoutingRepository;
  secretStore: RoutingSecretStore;
  clientFactory(credentials: RoutingClientCredentials): Pick<IRoutingNineRouterClient, 'getRoute'>;
};

function runtimeUnsupported(): AppError {
  return new AppError('This agent cannot use 9router', {
    code: 'ROUTING_RUNTIME_UNSUPPORTED',
    statusCode: 400,
  });
}

function runtimeUnavailable(): AppError {
  return new AppError('The routed session configuration is unavailable', {
    code: 'ROUTING_RUNTIME_UNAVAILABLE',
    statusCode: 409,
  });
}

function safeOperationFailure(): AppError {
  return new AppError('The 9router runtime configuration could not be resolved', {
    code: 'ROUTING_OPERATION_FAILED',
    statusCode: 502,
  });
}

function safeRuntimeError(error: unknown): AppError {
  if (error instanceof AppError) {
    return new AppError('The 9router runtime configuration could not be resolved', {
      code: error.code,
      statusCode: error.statusCode,
    });
  }
  return safeOperationFailure();
}

/**
 * Used by provider session creation and run dispatch to snapshot model-source
 * defaults once, then resolve only server-owned user/session bindings. Native
 * paths never decrypt credentials or construct a 9router client.
 */
export function createRoutingRuntimeService(
  dependencies: RoutingRuntimeServiceDependencies,
) {
  return {
    async snapshotSessionBinding(
      userId: number,
      sessionId: string,
      provider: RoutingAgent,
    ): Promise<void> {
      dependencies.repository.snapshotSessionBinding(userId, sessionId, provider);
    },

    async resolveForRun(
      userId: number,
      sessionId: string,
      provider: RoutingAgent,
    ): Promise<RuntimeRoutingConfiguration> {
      const binding = dependencies.repository.getSessionBinding(userId, sessionId);
      if (!binding || binding.provider !== provider || binding.source === 'native') {
        return { source: 'native' };
      }
      if (provider === 'cursor') {
        throw runtimeUnsupported();
      }
      if (!binding.routeId) {
        throw runtimeUnavailable();
      }

      const connection = dependencies.repository.getConnection(userId);
      if (!connection) {
        throw runtimeUnavailable();
      }

      try {
        const adminPassword = dependencies.secretStore.open(
          userId,
          'admin-password',
          connection.adminSecretCiphertext,
        );
        const apiKey = dependencies.secretStore.open(
          userId,
          'data-plane-key',
          connection.dataPlaneKeyCiphertext,
        );
        const client = dependencies.clientFactory({
          baseUrl: connection.baseUrl,
          adminPassword,
          dataPlaneKey: apiKey,
        });
        const route = await client.getRoute(binding.routeId);
        return {
          source: '9router',
          baseUrl: connection.baseUrl,
          openAiBaseUrl: `${connection.baseUrl}/v1`,
          apiKey,
          routeId: route.id,
          routeName: route.name,
        };
      } catch (error) {
        throw safeRuntimeError(error);
      }
    },
  };
}
