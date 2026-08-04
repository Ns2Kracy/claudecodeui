import { sessionsService } from '@/modules/providers/services/sessions.service.js';
import { routingRuntimeService } from '@/modules/routing/index.js';
import type { LLMProvider } from '@/shared/types.js';

type ProviderSessionRoutingServiceDependencies = {
  createAppSession: typeof sessionsService.createAppSession;
  snapshotSessionBinding: typeof routingRuntimeService.snapshotSessionBinding;
  rollbackSession(
    sessionId: string,
    options: { force: true; deletedFromDisk: false },
  ): Promise<unknown>;
};

/**
 * Used by provider session tests to verify that allocation and routing
 * snapshotting behave as one application operation without touching the real DB.
 */
export function createProviderSessionRoutingService(
  dependencies: ProviderSessionRoutingServiceDependencies,
) {
  return {
    async createAppSession(
      userId: number,
      provider: LLMProvider,
      projectPath: string,
    ) {
      const session = dependencies.createAppSession(provider, projectPath);

      try {
        await dependencies.snapshotSessionBinding(userId, session.sessionId, provider);
      } catch (error) {
        await dependencies.rollbackSession(session.sessionId, {
          force: true,
          deletedFromDisk: false,
        });
        throw error;
      }

      return session;
    },
  };
}

/** Used by provider routes to allocate a session with its sticky routing snapshot. */
export const providerSessionRoutingService = createProviderSessionRoutingService({
  createAppSession: (provider, projectPath) =>
    sessionsService.createAppSession(provider, projectPath),
  snapshotSessionBinding: (userId, sessionId, provider) =>
    routingRuntimeService.snapshotSessionBinding(userId, sessionId, provider),
  rollbackSession: (sessionId, options) =>
    sessionsService.deleteOrArchiveSessionById(sessionId, options),
});
