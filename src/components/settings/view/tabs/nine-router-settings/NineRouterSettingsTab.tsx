import React, { useEffect } from "react";
import { AlertTriangle, Loader2, ShieldCheck, Wrench } from "lucide-react";
import { useTranslation } from "react-i18next";

import type {
  CreateRoutingApiKeyAccountInput,
  CreateRoutingRouteInput,
  RoutingSettingsView,
  UpdateRoutingAccountInput,
  UpdateRoutingRouteInput,
} from "../../../../../../shared/routing.js";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
} from "../../../../../shared/view/ui";

import {
  type RoutingAccountDraft,
  type RoutingErrorContext,
  type RoutingUiError,
  upstreamDetailsState,
} from "./routingState.js";
import UpstreamsRoutesSection from "./UpstreamsRoutesSection.js";
import { useNineRouterSettings } from "./useNineRouterSettings.js";

export type NineRouterSettingsTabViewProps = {
  settings: RoutingSettingsView;
  loading: boolean;
  error: RoutingUiError | null;
  errorContext?: RoutingErrorContext | null;
  activeMutation: string | null;
  routesLoading?: boolean;
  routesError?: boolean;
  onRetryRoutes: () => void;
  accountDraft: RoutingAccountDraft;
  upstreamDetailsLoading?: boolean;
  upstreamDetailsError?: boolean;
  onAccountFieldChange: (
    field: keyof RoutingAccountDraft,
    value: string | number | boolean | undefined,
  ) => void;
  onExpandUpstreamDetails: () => void;
  onRetryUpstreamDetails: () => void;
  onCreateAccount: (input: CreateRoutingApiKeyAccountInput) => Promise<boolean>;
  onUpdateAccount: (
    id: string,
    input: UpdateRoutingAccountInput,
  ) => Promise<boolean>;
  onTestAccount: (id: string) => Promise<boolean>;
  onDeleteAccount: (id: string) => Promise<boolean>;
  onCreateRoute: (input: CreateRoutingRouteInput) => Promise<boolean>;
  onUpdateRoute: (
    id: string,
    input: UpdateRoutingRouteInput,
  ) => Promise<boolean>;
  onDeleteRoute: (id: string) => Promise<boolean>;
};

function errorCode(
  settings: RoutingSettingsView,
  error: RoutingUiError | null,
): string {
  return error?.code || settings.runtime.lastError?.code || "";
}

export function isNineRouterRuntimeReady(
  settings: RoutingSettingsView,
): boolean {
  return settings.runtime.status === "ready";
}

export function NineRouterSettingsTabView({
  settings,
  loading,
  error,
  errorContext = null,
  activeMutation,
  routesLoading = false,
  routesError = false,
  onRetryRoutes,
  accountDraft,
  upstreamDetailsLoading = false,
  upstreamDetailsError = false,
  onAccountFieldChange,
  onExpandUpstreamDetails,
  onRetryUpstreamDetails,
  onCreateAccount,
  onUpdateAccount,
  onTestAccount,
  onDeleteAccount,
  onCreateRoute,
  onUpdateRoute,
  onDeleteRoute,
}: NineRouterSettingsTabViewProps) {
  const { t } = useTranslation("settings");
  const code = errorCode(settings, error).toUpperCase();
  const unauthorized =
    code.includes("UNAUTHORIZED") ||
    code.includes("INVALID_CREDENTIAL") ||
    code.includes("AUTH_FAILED");
  const incompatible = code.includes("VERSION") || code.includes("CAPABILITY");
  const runtimeUnavailable = settings.runtime.status === "unavailable";
  const detailErrorOwnsMessage =
    errorContext === "details" && (routesError || upstreamDetailsError);
  const showRouteError =
    routesError && !unauthorized && !incompatible && !runtimeUnavailable;
  const runtimeReady = isNineRouterRuntimeReady(settings);
  const knownStateError =
    unauthorized ||
    incompatible ||
    runtimeUnavailable ||
    detailErrorOwnsMessage;

  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <h2 className="text-lg font-semibold tracking-tight text-foreground">
          {t("nineRouter.title")}
        </h2>
        <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
          {t("nineRouter.description")}
        </p>
      </div>

      {loading && (
        <div
          role="status"
          className="flex items-center gap-2 text-sm text-muted-foreground"
        >
          <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" />
          {t("nineRouter.loading")}
        </div>
      )}

      <Alert className="border-border bg-muted/40">
        <ShieldCheck className="h-4 w-4" />
        <AlertTitle>{t("nineRouter.runtime.title")}</AlertTitle>
        <AlertDescription>
          <div className="mt-2 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="space-y-1">
              <p>{t(`nineRouter.runtime.status.${settings.runtime.status}`)}</p>
              <p className="text-xs text-muted-foreground">
                {t("nineRouter.runtime.version")}:{" "}
                {settings.runtime.version ?? t("nineRouter.runtime.unknown")}
              </p>
              {settings.runtime.lastError && (
                <p>{settings.runtime.lastError.message}</p>
              )}
            </div>
          </div>
        </AlertDescription>
      </Alert>

      {runtimeUnavailable && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>
            {t("nineRouter.alerts.runtimeUnavailable.title")}
          </AlertTitle>
          <AlertDescription>
            {t("nineRouter.alerts.runtimeUnavailable.description")}
          </AlertDescription>
        </Alert>
      )}

      {unauthorized && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>{t("nineRouter.alerts.unauthorized.title")}</AlertTitle>
          <AlertDescription>
            {t("nineRouter.alerts.unauthorized.description")}
          </AlertDescription>
        </Alert>
      )}

      {incompatible && (
        <Alert>
          <Wrench className="h-4 w-4" />
          <AlertTitle>{t("nineRouter.alerts.incompatible.title")}</AlertTitle>
          <AlertDescription>
            {t("nineRouter.alerts.incompatible.description")}
          </AlertDescription>
        </Alert>
      )}

      {error && !knownStateError && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>{t("nineRouter.alerts.operation.title")}</AlertTitle>
          <AlertDescription>{error.message}</AlertDescription>
        </Alert>
      )}

      <UpstreamsRoutesSection
        configured={runtimeReady}
        connectionStatus={runtimeReady ? "connected" : "offline"}
        capabilities={settings.runtime.capabilities}
        accountSummary={settings.accountSummary}
        routeSummary={settings.routeSummary}
        accounts={settings.accounts ?? []}
        models={settings.models ?? []}
        routes={settings.routes ?? []}
        loading={upstreamDetailsLoading}
        detailsError={upstreamDetailsError}
        activeMutation={activeMutation}
        accountDraft={accountDraft}
        onAccountFieldChange={onAccountFieldChange}
        onExpand={onExpandUpstreamDetails}
        onRetry={onRetryUpstreamDetails}
        onCreateAccount={onCreateAccount}
        onUpdateAccount={onUpdateAccount}
        onTestAccount={onTestAccount}
        onDeleteAccount={onDeleteAccount}
        onCreateRoute={onCreateRoute}
        onUpdateRoute={onUpdateRoute}
        onDeleteRoute={onDeleteRoute}
      />
    </div>
  );
}

export default function NineRouterSettingsTab() {
  const controller = useNineRouterSettings();
  const { ensureRouteDetails } = controller;
  const upstreamDetails = upstreamDetailsState(controller.detailStatus);
  const canReadRoutes =
    isNineRouterRuntimeReady(controller.settings) &&
    controller.settings.runtime.capabilities.readRoutes;
  useEffect(() => {
    if (canReadRoutes) void ensureRouteDetails();
  }, [canReadRoutes, ensureRouteDetails]);

  return (
    <NineRouterSettingsTabView
      settings={controller.settings}
      loading={controller.loading}
      error={controller.error}
      errorContext={controller.errorContext}
      activeMutation={controller.activeMutation}
      routesLoading={controller.detailStatus.routes === "loading"}
      routesError={controller.detailStatus.routes === "error"}
      onRetryRoutes={() => {
        void controller.retryRouteDetails();
      }}
      accountDraft={controller.accountDraft}
      upstreamDetailsLoading={upstreamDetails.loading}
      upstreamDetailsError={upstreamDetails.error}
      onAccountFieldChange={controller.setAccountField}
      onExpandUpstreamDetails={() => {
        void controller.ensureUpstreamDetails();
      }}
      onRetryUpstreamDetails={() => {
        void controller.retryUpstreamDetails();
      }}
      onCreateAccount={async (input) =>
        Boolean(await controller.createAccount(input))
      }
      onUpdateAccount={async (id, input) =>
        Boolean(await controller.updateAccount(id, input))
      }
      onTestAccount={async (id) => Boolean(await controller.testAccount(id))}
      onDeleteAccount={async (id) =>
        Boolean(await controller.deleteAccount(id))
      }
      onCreateRoute={async (input) =>
        Boolean(await controller.createRoute(input))
      }
      onUpdateRoute={async (id, input) =>
        Boolean(await controller.updateRoute(id, input))
      }
      onDeleteRoute={async (id) => Boolean(await controller.deleteRoute(id))}
    />
  );
}
