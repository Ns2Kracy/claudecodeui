import { AlertTriangle, Loader2, RefreshCw } from "lucide-react";
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
import ProviderConnections from "./ProviderConnections.js";

type ProviderAccountsSectionProps = {
	configured: boolean;
	connectionStatus: "connected" | "offline";
	capabilities: RoutingCapabilities;
	accounts: RoutingAccountView[];
	models: RoutingModelView[];
	loading: boolean;
	detailsError: boolean;
	activeMutation: string | null;
	onRetry: () => void;
	onUpdateAccount: (
		id: string,
		input: UpdateRoutingAccountInput,
	) => Promise<boolean>;
	onTestAccount: (id: string) => Promise<boolean>;
	onDeleteAccount: (id: string) => Promise<boolean>;
};

export default function ProviderAccountsSection({
	configured,
	connectionStatus,
	capabilities,
	accounts,
	models,
	loading,
	detailsError,
	activeMutation,
	onRetry,
	onUpdateAccount,
	onTestAccount,
	onDeleteAccount,
}: ProviderAccountsSectionProps) {
	const { t } = useTranslation("settings");
	const canMutate = connectionStatus === "connected";

	return (
		<SettingsSection
			title={t("nineRouter.management.title")}
			description={t("nineRouter.management.description")}
		>
			<SettingsCard>
				<div className="space-y-6 p-4">
					{!configured && (
						<p className="text-sm text-muted-foreground">
							{t("nineRouter.management.connectFirst")}
						</p>
					)}
					{configured && !capabilities.readAccounts && (
						<div className="flex gap-2 text-sm text-muted-foreground">
							<AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
							<p>{t("nineRouter.management.unavailable")}</p>
						</div>
					)}
					{configured && capabilities.readAccounts && loading && (
						<div
							role="status"
							className="flex items-center gap-2 text-sm text-muted-foreground"
						>
							<Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" />
							{t("nineRouter.management.loading")}
						</div>
					)}
					{configured && capabilities.readAccounts && detailsError && (
						<div
							role="alert"
							className="flex flex-col gap-3 rounded-md border border-destructive/30 bg-destructive/5 p-3 sm:flex-row sm:items-center sm:justify-between"
						>
							<span className="text-sm text-foreground">
								{t("nineRouter.management.loadFailed")}
							</span>
							<Button
								type="button"
								size="sm"
								variant="outline"
								onClick={onRetry}
								disabled={loading}
							>
								<RefreshCw className="h-4 w-4" />
								{t("nineRouter.management.actions.retry")}
							</Button>
						</div>
					)}
					{configured &&
						capabilities.readAccounts &&
						!loading &&
						!detailsError && (
							<div className="space-y-5">
								<ProviderConnections
									disabled={!canMutate}
									onConnected={async () => {
										onRetry();
									}}
								/>
								<div className="border-t border-border" />
								<AccountEditor
									accounts={accounts}
									models={models}
									canWrite={canMutate && capabilities.writeApiKeyAccounts}
									canTest={canMutate && capabilities.testAccounts}
									activeMutation={activeMutation}
									onUpdate={onUpdateAccount}
									onTest={onTestAccount}
									onDelete={onDeleteAccount}
								/>
							</div>
						)}
				</div>
			</SettingsCard>
		</SettingsSection>
	);
}
