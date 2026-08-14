import { Loader2, RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";

import type {
	RoutingAccountView,
	RoutingCapabilities,
	RoutingModelView,
	UpdateRoutingAccountInput,
} from "../../../../../../shared/routing.js";
import { Button } from "../../../../../shared/view/ui";
import SettingsCard from "../../SettingsCard";
import SettingsSection from "../../SettingsSection";

import AccountEditor from "./AccountEditor.js";
import type { RoutingAccountTestResult } from "./routingApi.js";
import ProviderConnections from "./ProviderConnections.js";

type ProviderAccountsSectionProps = {
	connectionStatus: "connected" | "offline";
	capabilities: RoutingCapabilities;
	accounts: RoutingAccountView[];
	models: RoutingModelView[];
	loading: boolean;
	hasLoadedDetails: boolean;
	refreshing: boolean;
	detailsError: boolean;
	activeMutation: string | null;
	onRetry: () => void;
	onUpdateAccount: (
		id: string,
		input: UpdateRoutingAccountInput,
	) => Promise<boolean>;
	onTestAccount: (id: string) => Promise<RoutingAccountTestResult | null>;
	onDeleteAccount: (id: string) => Promise<boolean>;
};

function isApiKeyAccount(account: RoutingAccountView): boolean {
	return account.authType.toLowerCase().includes("api");
}

export default function ProviderAccountsSection({
	connectionStatus,
	capabilities,
	accounts,
	models,
	loading,
	hasLoadedDetails,
	refreshing,
	detailsError,
	activeMutation,
	onRetry,
	onUpdateAccount,
	onTestAccount,
	onDeleteAccount,
}: ProviderAccountsSectionProps) {
	const { t } = useTranslation("settings");
	const canMutate = connectionStatus === "connected";
	const oauthAccounts = accounts.filter((account) => !isApiKeyAccount(account));
	const apiKeyAccounts = accounts.filter(isApiKeyAccount);
	const accountEditorProps = {
		models,
		canWrite: canMutate && capabilities.writeApiKeyAccounts,
		canTest: canMutate && capabilities.testAccounts,
		activeMutation,
		onUpdate: onUpdateAccount,
		onTest: onTestAccount,
		onDelete: onDeleteAccount,
	};

	return (
		<SettingsSection
			title={t("nineRouter.management.title")}
			description={t("nineRouter.management.description")}
		>
			{loading && !hasLoadedDetails && (
					<SettingsCard>
						<div
							role="status"
							className="flex items-center gap-2 p-4 text-sm text-muted-foreground"
						>
							<Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" />
							{t("nineRouter.management.loading")}
						</div>
					</SettingsCard>
				)}
			{detailsError && (
				<SettingsCard>
					<div
						role="alert"
						className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between"
					>
						<span className="text-sm text-foreground">
							{t("nineRouter.management.loadFailed")}
						</span>
						<Button
							type="button"
							size="sm"
							variant="outline"
							onClick={onRetry}
							disabled={loading || refreshing}
						>
							<RefreshCw className="h-4 w-4" />
							{t("nineRouter.management.actions.retry")}
						</Button>
					</div>
				</SettingsCard>
			)}
			{hasLoadedDetails && (
				<div className="space-y-4" aria-busy={refreshing}>
					{refreshing && (
						<div
							role="status"
							className="flex items-center gap-2 text-xs text-muted-foreground"
						>
							<Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" />
							{t("nineRouter.management.refreshing")}
						</div>
					)}
					<SettingsCard>
						<div className="space-y-5 p-4">
							<ProviderConnections
								mode="oauth"
								hasCodexAccount={oauthAccounts.some(
									(account) => account.provider === "codex",
								)}
								disabled={!canMutate}
								onConnected={onRetry}
							/>
							<div className="border-t border-border" />
							<AccountEditor
								{...accountEditorProps}
								accounts={oauthAccounts}
								title={t(
									"nineRouter.management.authentication.oauth.accountsTitle",
								)}
								description={t(
									"nineRouter.management.authentication.oauth.accountsDescription",
								)}
								emptyMessage={t(
									"nineRouter.management.authentication.oauth.empty",
								)}
							/>
						</div>
					</SettingsCard>

					<SettingsCard>
						<div className="space-y-5 p-4">
							<ProviderConnections
								mode="apiKey"
								disabled={!canMutate}
								onConnected={onRetry}
							/>
							<div className="border-t border-border" />
							<AccountEditor
								{...accountEditorProps}
								accounts={apiKeyAccounts}
								title={t(
									"nineRouter.management.authentication.apiKey.accountsTitle",
								)}
								description={t(
									"nineRouter.management.authentication.apiKey.accountsDescription",
								)}
								emptyMessage={t(
									"nineRouter.management.authentication.apiKey.empty",
								)}
							/>
						</div>
					</SettingsCard>
				</div>
			)}
		</SettingsSection>
	);
}
