import React from 'react';
import { Loader2, LockKeyhole, RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import {
  ROUTING_AGENTS,
  type RoutingAgent,
  type RoutingBindingView,
  type RoutingCapabilities,
  type RoutingRouteView,
  type UpdateRoutingBindingInput,
} from '../../../../../../shared/routing.js';
import { Button } from '../../../../../shared/view/ui';
import SettingsCard from '../../SettingsCard';
import SettingsSection from '../../SettingsSection';

type ModelSourceSectionProps = {
  configured: boolean;
  capabilities: RoutingCapabilities;
  bindings: Record<RoutingAgent, RoutingBindingView>;
  routes: RoutingRouteView[];
  routesLoading: boolean;
  routesError: boolean;
  activeMutation: string | null;
  onSetBinding: (provider: RoutingAgent, input: UpdateRoutingBindingInput) => void;
  onRetryRoutes: () => void;
};

function runtimeAvailable(provider: RoutingAgent, capabilities: RoutingCapabilities): boolean {
  switch (provider) {
    case 'claude':
      return capabilities.claudeRuntime;
    case 'codex':
      return capabilities.codexRuntime;
    case 'opencode':
      return capabilities.openCodeRuntime;
    case 'cursor':
      return false;
    default:
      return false;
  }
}

export default function ModelSourceSection({
  configured,
  capabilities,
  bindings,
  routes,
  routesLoading,
  routesError,
  activeMutation,
  onSetBinding,
  onRetryRoutes,
}: ModelSourceSectionProps) {
  const { t } = useTranslation('settings');

  return (
    <SettingsSection
      title={t('nineRouter.modelSource.title')}
      description={t('nineRouter.modelSource.description')}
    >
      <SettingsCard divided>
        {ROUTING_AGENTS.map((provider) => {
          const binding = bindings[provider];
          const isCursor = provider === 'cursor';
          const availableRoutes = binding.routeId && !routes.some((route) => route.id === binding.routeId)
            ? [{
                id: binding.routeId,
                name: binding.routeName || binding.routeId,
                kind: null,
                models: [],
              }, ...routes]
            : routes;
          const canRoute = configured
            && runtimeAvailable(provider, capabilities)
            && availableRoutes.length > 0
            && !isCursor;
          const mutating = activeMutation === `binding:${provider}`;
          const routed = binding.source === '9router';

          return (
            <div key={provider} className="space-y-3 p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0 space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-foreground">
                      {t(`nineRouter.modelSource.agents.${provider}`)}
                    </span>
                    {isCursor && <LockKeyhole className="h-3.5 w-3.5 text-muted-foreground" />}
                  </div>
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    {isCursor
                      ? t('nineRouter.modelSource.cursorUnsupported')
                      : t('nineRouter.modelSource.nativePreserved')}
                  </p>
                </div>

                <div className="inline-flex w-full rounded-md border border-input bg-background p-0.5 sm:w-auto">
                  <Button
                    type="button"
                    size="sm"
                    variant={!routed ? 'secondary' : 'ghost'}
                    className="h-8 flex-1 px-3 shadow-none sm:flex-none"
                    aria-pressed={!routed}
                    disabled={mutating}
                    onClick={() => onSetBinding(provider, { source: 'native' })}
                  >
                    {mutating && !routed && (
                      <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" />
                    )}
                    {t('nineRouter.modelSource.native')}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant={routed ? 'secondary' : 'ghost'}
                    className="h-8 flex-1 px-3 shadow-none sm:flex-none"
                    aria-pressed={routed}
                    disabled={!canRoute || mutating}
                    onClick={() => {
                      const routeId = binding.routeId || availableRoutes[0]?.id;
                      if (routeId) onSetBinding(provider, { source: '9router', routeId });
                    }}
                  >
                    {mutating && routed && (
                      <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" />
                    )}
                    {t('nineRouter.modelSource.router')}
                  </Button>
                </div>
              </div>

              {routed && !isCursor && (
                <div className="space-y-2 sm:max-w-sm">
                  <label htmlFor={`nine-router-route-${provider}`} className="text-xs font-medium text-foreground">
                    {t('nineRouter.modelSource.route')}
                  </label>
                  <select
                    id={`nine-router-route-${provider}`}
                    value={binding.routeId ?? ''}
                    onChange={(event) => onSetBinding(provider, {
                      source: '9router',
                      routeId: event.target.value,
                    })}
                    disabled={mutating || availableRoutes.length === 0}
                    className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {availableRoutes.map((route) => (
                      <option key={route.id} value={route.id}>{route.name}</option>
                    ))}
                  </select>
                </div>
              )}

            </div>
          );
        })}
      </SettingsCard>

      {configured && routesLoading && routes.length === 0 && (
        <p className="flex items-center gap-2 text-xs text-muted-foreground" role="status">
          <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" />
          {t('nineRouter.modelSource.loadingRoutes')}
        </p>
      )}

      {configured && routesError && (
        <div className="flex flex-wrap items-center gap-2 text-xs text-destructive" role="alert">
          <span>{t('nineRouter.modelSource.routeLoadFailed')}</span>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-7 px-2"
            onClick={onRetryRoutes}
            disabled={routesLoading}
          >
            <RefreshCw className="h-3.5 w-3.5" />
            {t('nineRouter.modelSource.retryRoutes')}
          </Button>
        </div>
      )}

      {configured && !routesLoading && !routesError && routes.length === 0 && (
        <p className="text-xs text-muted-foreground">
          {t('nineRouter.modelSource.noRoutes')}
        </p>
      )}

      <p className="text-xs leading-relaxed text-muted-foreground">
        {t('nineRouter.modelSource.noFallback')}
      </p>
    </SettingsSection>
  );
}
