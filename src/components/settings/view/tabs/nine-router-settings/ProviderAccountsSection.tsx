import { useState } from "react";
import {
	AlertTriangle,
	ChevronDown,
	Loader2,
	Network,
	RefreshCw,
} from "lucide-react";
import { useTranslation } from "react-i18next";

import type {
	RoutingAccountView,
	RoutingCapabilities,
	RoutingModelView,
	UpdateRoutingAccountInput,
} from "../../../../../../shared/routing.js";
import {
	Badge,
	Button,
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "../../../../../shared/view/ui";
import SettingsCard from "../../SettingsCard";
import SettingsSection from "../../SettingsSection";

import AccountEditor from "./AccountEditor.js";
import ProviderConnections from "./ProviderConnections.js";

type ProviderAccountsSectionProps = {
	configured: boolean;
	connectionStatus: "connected" | "offline";
	capabilities: RoutingCapabilities;
	accountSummary: { total: number; degraded: number };
	accounts: RoutingAccountView[];
	models: RoutingModelView[];
	loading: boolean;
	detailsError: boolean;
	activeMutation: string | null;
	onExpand: () => void;
	onRetry: () => void;
	onUpdateAccount: (
		id: string,
		input: UpdateRoutingAccountInput,
	) => Promise<boolean>;
	onTestAccount: (id: string) => Promise<boolean>;
	onDeleteAccount: (id: string) => Promise<boolean>;
	defaultOpen?: boolean;
};

export default function ProviderAccountsSection({
	configured,
	connectionStatus,
	capabilities,
	accountSummary,
	accounts,
	models,
	loading,
	detailsError,
	activeMutation,
	onExpand,
	onRetry,
	onUpdateAccount,
	onTestAccount,
	onDeleteAccount,
	defaultOpen = false,
}: ProviderAccountsSectionProps) {
	const { t } = useTranslation("settings");
	const [open, setOpen] = useState(defaultOpen);
	const canMutate = connectionStatus === "connected";

	return (
		<SettingsSection
			title={t("nineRouter.management.title")}
			description={t("nineRouter.management.description")}
		>
			<Collapsible
				open={open}
				onOpenChange={(nextOpen) => {
					setOpen(nextOpen);
					if (nextOpen) onExpand();
				}}
			>
				<SettingsCard>
					<CollapsibleTrigger className="flex w-full items-center gap-3 p-4 text-left hover:bg-accent/30 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring">
						<span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-md border border-border bg-background text-muted-foreground">
							<Network className="h-4 w-4" />
						</span>
						<span className="min-w-0 flex-1">
							<span className="block text-sm font-medium text-foreground">
								{t("nineRouter.management.disclosure")}
							</span>
							<span className="mt-1 flex flex-wrap gap-1.5">
								<Badge variant="outline">
									{t("nineRouter.management.summary.accounts", {
										count: accountSummary.total,
									})}
								</Badge>
								{accountSummary.degraded > 0 && (
									<Badge
										variant="outline"
										className="border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300"
									>
										{t("nineRouter.management.summary.degraded", {
											count: accountSummary.degraded,
										})}
									</Badge>
								)}
							</span>
						</span>
						<ChevronDown
							className={`h-4 w-4 flex-shrink-0 text-muted-foreground transition-transform duration-200 ${open ? "rotate-180" : ""}`}
						/>
					</CollapsibleTrigger>

					{open && (
						<CollapsibleContent>
							<div className="space-y-6 border-t border-border p-4">
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
						</CollapsibleContent>
					)}
				</SettingsCard>
			</Collapsible>
		</SettingsSection>
	);
}
