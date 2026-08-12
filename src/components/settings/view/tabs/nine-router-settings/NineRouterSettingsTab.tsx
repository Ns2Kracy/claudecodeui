import React from "react";
import { AlertTriangle, Loader2, ShieldCheck, Wrench } from "lucide-react";
import { useTranslation } from "react-i18next";

import type {
	CreateRoutingApiKeyAccountInput,
	RoutingSettingsView,
	UpdateRoutingAccountInput,
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
import ProviderAccountsSection from "./ProviderAccountsSection.js";
import { useNineRouterSettings } from "./useNineRouterSettings.js";

export type NineRouterSettingsTabViewProps = {
	settings: RoutingSettingsView;
	loading: boolean;
	error: RoutingUiError | null;
	errorContext?: RoutingErrorContext | null;
	activeMutation: string | null;
	codexApplied: boolean;
	onApplyToCodex: () => Promise<boolean>;
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
	codexApplied,
	onApplyToCodex,
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
		errorContext === "details" && upstreamDetailsError;
	const runtimeReady = isNineRouterRuntimeReady(settings);
	const applyingToCodex = activeMutation === "codex:apply";
	const knownStateError =
		unauthorized ||
		incompatible ||
		runtimeUnavailable ||
		detailErrorOwnsMessage;

	return (
		<div className="space-y-8">
			{loading && (
				<div
					role="status"
					className="flex items-center gap-2 text-sm text-muted-foreground"
				>
					<Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" />
					{t("nineRouter.loading")}
				</div>
			)}

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

			<section className="space-y-3 rounded-lg border border-border p-4">
				<div className="space-y-1">
					<h3 className="text-sm font-medium">{t("nineRouter.codex.title")}</h3>
					<p className="text-sm text-muted-foreground">
						{t("nineRouter.codex.description")}
					</p>
				</div>
				<Button
					type="button"
					disabled={!runtimeReady || applyingToCodex}
					onClick={() => void onApplyToCodex()}
				>
					{applyingToCodex && (
						<Loader2 className="mr-2 h-4 w-4 animate-spin motion-reduce:animate-none" />
					)}
					{t(
						applyingToCodex
							? "nineRouter.codex.applying"
							: "nineRouter.codex.apply",
					)}
				</Button>
				{codexApplied && (
					<Alert role="status">
						<ShieldCheck className="h-4 w-4" />
						<AlertTitle>{t("nineRouter.codex.successTitle")}</AlertTitle>
						<AlertDescription>
							{t("nineRouter.codex.successDescription")}
						</AlertDescription>
					</Alert>
				)}
			</section>

			<ProviderAccountsSection
				configured={runtimeReady}
				connectionStatus={runtimeReady ? "connected" : "offline"}
				capabilities={settings.runtime.capabilities}
				accountSummary={settings.accountSummary}
				accounts={settings.accounts ?? []}
				models={settings.models ?? []}
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
			/>
		</div>
	);
}

export default function NineRouterSettingsTab() {
	const controller = useNineRouterSettings();
	const upstreamDetails = upstreamDetailsState(controller.detailStatus);

	return (
		<NineRouterSettingsTabView
			settings={controller.settings}
			loading={controller.loading}
			error={controller.error}
			errorContext={controller.errorContext}
			activeMutation={controller.activeMutation}
			codexApplied={controller.codexApplied}
			onApplyToCodex={async () => Boolean(await controller.applyToCodex())}
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
		/>
	);
}
