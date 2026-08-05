import type { IRoutingNineRouterClient } from '@/shared/interfaces.js';
import type {
  RoutingClientCredentials,
  RoutingRepository,
  RuntimeRoutingConfiguration,
} from '@/shared/types.js';
import { AppError } from '@/shared/utils.js';

import type { RoutingAgent } from '../../../shared/routing.js';

import type { NineRouterInternalCredentials, NineRouterSidecarStatus } from './nine-router-sidecar.service.js';

type RuntimeCredentialsProvider = {
  getStatus(): NineRouterSidecarStatus;
  getInternalCredentials(): NineRouterInternalCredentials;
};

type RoutingRuntimeServiceDependencies = {
  repository: RoutingRepository;
  runtime: RuntimeCredentialsProvider;
  clientFactory(credentials: RoutingClientCredentials): Pick<IRoutingNineRouterClient, 'getRoute'>;
};

function runtimeUnsupported(): AppError {
  return new AppError('This agent cannot use 9router', { code: 'ROUTING_RUNTIME_UNSUPPORTED', statusCode: 400 });
}

function runtimeUnavailable(): AppError {
  return new AppError('The embedded 9router runtime is unavailable', { code: 'ROUTING_RUNTIME_UNAVAILABLE', statusCode: 409 });
}

function safeOperationFailure(): AppError {
  return new AppError('The 9router runtime configuration could not be resolved', { code: 'ROUTING_OPERATION_FAILED', statusCode: 502 });
}

function safeRuntimeError(error: unknown): AppError {
  if (error instanceof AppError) {
    return new AppError('The 9router runtime configuration could not be resolved', { code: error.code, statusCode: error.statusCode });
  }
  return safeOperationFailure();
}

/**
 * Used by provider session creation and run dispatch for sticky per-session
 * routing. Explicit 9router bindings fail safely when the embedded runtime is
 * unavailable instead of falling back to native execution.
 */
export function createRoutingRuntimeService(dependencies: RoutingRuntimeServiceDependencies) {
  function runtimeClient(): { client: Pick<IRoutingNineRouterClient, 'getRoute'>; credentials: RoutingClientCredentials } {
    const status = dependencies.runtime.getStatus();
    if (status.state !== 'ready') throw runtimeUnavailable();
    const internal = dependencies.runtime.getInternalCredentials();
    const credentials = {
      baseUrl: status.origin ?? 'http://127.0.0.1:20128',
      adminPassword: internal.initialPassword,
      dataPlaneKey: internal.dataPlaneKey,
    };
    return { client: dependencies.clientFactory(credentials), credentials };
  }

  return {
    async snapshotSessionBinding(userId: number, sessionId: string, provider: RoutingAgent): Promise<void> {
      dependencies.repository.snapshotSessionBinding(userId, sessionId, provider);
    },

    async resolveForRun(userId: number, sessionId: string, provider: RoutingAgent): Promise<RuntimeRoutingConfiguration> {
      const binding = dependencies.repository.getSessionBinding(userId, sessionId);
      if (!binding || binding.provider !== provider || binding.source === 'native') return { source: 'native' };
      if (provider === 'cursor') throw runtimeUnsupported();
      if (!binding.routeId) throw runtimeUnavailable();

      try {
        const { client, credentials } = runtimeClient();
        const route = await client.getRoute(binding.routeId);
        return {
          source: '9router',
          baseUrl: credentials.baseUrl,
          openAiBaseUrl: `${credentials.baseUrl}/v1`,
          apiKey: credentials.dataPlaneKey,
          routeId: route.id,
          routeName: route.name,
        };
      } catch (error) {
        throw safeRuntimeError(error);
      }
    },
  };
}
