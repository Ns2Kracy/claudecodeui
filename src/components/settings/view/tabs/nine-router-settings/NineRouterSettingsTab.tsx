import React, { useEffect } from 'react';
import { AlertTriangle, KeyRound, Loader2, ShieldCheck, WifiOff, Wrench } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type {
  RoutingAgent,
  RoutingSettingsView,
  UpdateRoutingBindingInput,
} from '../../../../../../shared/routing.js';
import { Alert, AlertDescription, AlertTitle } from '../../../../../shared/view/ui';

import ConnectionSection from './ConnectionSection.js';
import ModelSourceSection from './ModelSourceSection.js';
import {
  connectionDraftAfterCancel,
  type RoutingConnectionDraft,
  type RoutingUiError,
} from './routingState.js';
import { useNineRouterSettings } from './useNineRouterSettings.js';

export type NineRouterSettingsTabViewProps = {
  settings: RoutingSettingsView;
  loading: boolean;
  error: RoutingUiError | null;
  activeMutation: string | null;
  connectionDraft: RoutingConnectionDraft;
  routesLoading?: boolean;
  routesError?: boolean;
  onConnectionFieldChange: (field: keyof RoutingConnectionDraft, value: string) => void;
  onCancelConnectionEdit: () => void;
  onConnect: () => Promise<boolean>;
  onValidateConnection: () => void;
  onDisconnect: () => void;
  onSetBinding: (provider: RoutingAgent, input: UpdateRoutingBindingInput) => void;
  onRetryRoutes: () => void;
};

function errorCode(
  settings: RoutingSettingsView,
  error: RoutingUiError | null,
): string {
  return error?.code || settings.connection.lastError?.code || '';
}

export function NineRouterSettingsTabView({
  settings,
  loading,
  error,
  activeMutation,
  connectionDraft,
  routesLoading = false,
  routesError = false,
  onConnectionFieldChange,
  onCancelConnectionEdit,
  onConnect,
  onValidateConnection,
  onDisconnect,
  onSetBinding,
  onRetryRoutes,
}: NineRouterSettingsTabViewProps) {
  const { t } = useTranslation('settings');
  const code = errorCode(settings, error).toUpperCase();
  const unauthorized = code.includes('UNAUTHORIZED')
    || code.includes('INVALID_CREDENTIAL')
    || code.includes('AUTH_FAILED');
  const incompatible = code.includes('VERSION') || code.includes('CAPABILITY');
  const offline = settings.connection.status === 'offline';
  const showRouteError = routesError && !unauthorized && !incompatible && !offline;
  const secureStorageUnavailable = !loading && !settings.connection.secureStorageAvailable;
  const knownStateError = unauthorized || incompatible || offline || routesError;

  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <h2 className="text-lg font-semibold tracking-tight text-foreground">
          {t('nineRouter.title')}
        </h2>
        <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
          {t('nineRouter.description')}
        </p>
      </div>

      <Alert className="border-primary/20 bg-primary/5">
        <ShieldCheck className="h-4 w-4" />
        <AlertTitle>{t('nineRouter.preservation.title')}</AlertTitle>
        <AlertDescription>
          <p>{t('nineRouter.preservation.nativeLogin')}</p>
          <p>{t('nineRouter.preservation.usageAdvisory')}</p>
        </AlertDescription>
      </Alert>

      {loading && (
        <div role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" />
          {t('nineRouter.loading')}
        </div>
      )}

      {secureStorageUnavailable && (
        <Alert variant="destructive">
          <KeyRound className="h-4 w-4" />
          <AlertTitle>{t('nineRouter.alerts.secureStorage.title')}</AlertTitle>
          <AlertDescription>{t('nineRouter.alerts.secureStorage.description')}</AlertDescription>
        </Alert>
      )}

      {offline && (
        <Alert variant="destructive">
          <WifiOff className="h-4 w-4" />
          <AlertTitle>{t('nineRouter.alerts.offline.title')}</AlertTitle>
          <AlertDescription>{t('nineRouter.alerts.offline.description')}</AlertDescription>
        </Alert>
      )}

      {unauthorized && (
        <Alert variant="destructive">
          <KeyRound className="h-4 w-4" />
          <AlertTitle>{t('nineRouter.alerts.unauthorized.title')}</AlertTitle>
          <AlertDescription>{t('nineRouter.alerts.unauthorized.description')}</AlertDescription>
        </Alert>
      )}

      {incompatible && (
        <Alert>
          <Wrench className="h-4 w-4" />
          <AlertTitle>{t('nineRouter.alerts.incompatible.title')}</AlertTitle>
          <AlertDescription>{t('nineRouter.alerts.incompatible.description')}</AlertDescription>
        </Alert>
      )}

      {error && !knownStateError && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>{t('nineRouter.alerts.operation.title')}</AlertTitle>
          <AlertDescription>{error.message}</AlertDescription>
        </Alert>
      )}

      <ConnectionSection
        connection={settings.connection}
        draft={connectionDraft}
        activeMutation={activeMutation}
        onFieldChange={onConnectionFieldChange}
        onCancelEdit={onCancelConnectionEdit}
        onConnect={onConnect}
        onValidate={onValidateConnection}
        onDisconnect={onDisconnect}
      />

      <ModelSourceSection
        configured={settings.connection.configured}
        capabilities={settings.connection.capabilities}
        bindings={settings.bindings}
        routes={settings.routes ?? []}
        routesLoading={routesLoading}
        routesError={showRouteError}
        activeMutation={activeMutation}
        onSetBinding={onSetBinding}
        onRetryRoutes={onRetryRoutes}
      />
    </div>
  );
}

export default function NineRouterSettingsTab() {
  const controller = useNineRouterSettings();
  const { ensureRouteDetails } = controller;
  const canReadRoutes = controller.settings.connection.configured
    && controller.settings.connection.capabilities.readRoutes;

  useEffect(() => {
    if (canReadRoutes) void ensureRouteDetails();
  }, [canReadRoutes, ensureRouteDetails]);

  return (
    <NineRouterSettingsTabView
      settings={controller.settings}
      loading={controller.loading}
      error={controller.error}
      activeMutation={controller.activeMutation}
      connectionDraft={controller.connectionDraft}
      routesLoading={controller.detailStatus.routes === 'loading'}
      routesError={controller.detailStatus.routes === 'error'}
      onConnectionFieldChange={controller.setConnectionField}
      onCancelConnectionEdit={() => controller.setConnectionDraft(connectionDraftAfterCancel(
        controller.settings.connection.baseUrl,
      ))}
      onConnect={async () => Boolean(await controller.connect())}
      onValidateConnection={() => { void controller.validateConnection(); }}
      onDisconnect={() => { void controller.disconnect(); }}
      onSetBinding={(provider, input) => { void controller.setBinding(provider, input); }}
      onRetryRoutes={() => { void controller.retryRouteDetails(); }}
    />
  );
}
