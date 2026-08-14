import { useId, useState } from "react";
import {
	CheckCircle2,
	ChevronDown,
	Loader2,
	MoreHorizontal,
	Pencil,
	Power,
	RefreshCw,
	Trash2,
	XCircle,
} from "lucide-react";
import { useTranslation } from "react-i18next";

import type {
	RoutingAccountView,
	RoutingModelView,
	UpdateRoutingAccountInput,
} from "../../../../../../shared/routing.js";
import {
	ActionMenu,
	Badge,
	Button,
	Input,
} from "../../../../../shared/view/ui";

import {
	collectAccountTestRecord,
	type AccountTestRecord,
} from "./accountTestFeedback.js";
import { NINE_ROUTER_PROVIDER_PROFILES } from "./ProviderCatalog.js";
import ProviderIcon from "./ProviderIcon.js";
import type { RoutingAccountTestResult } from "./routingApi.js";

type AccountEditorProps = {
	accounts: RoutingAccountView[];
	models: RoutingModelView[];
	canWrite: boolean;
	canTest: boolean;
	activeMutation: string | null;
	onUpdate: (id: string, input: UpdateRoutingAccountInput) => Promise<boolean>;
	onTest: (id: string) => Promise<RoutingAccountTestResult | null>;
	onDelete: (id: string) => Promise<boolean>;
	defaultEditingId?: string | null;
	defaultDeleteId?: string | null;
	defaultPendingDisableId?: string | null;
	defaultExpandedTestId?: string | null;
	defaultOpenMenuId?: string | null;
	defaultTestResults?: Record<string, AccountTestRecord>;
	title?: string;
	description?: string;
	emptyMessage?: string;
};

type EditDraft = { name: string; priority: string; apiKey: string };

const statusTone: Record<RoutingAccountView["status"], string> = {
	healthy:
		"border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
	cooling:
		"border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
	limited:
		"border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
	failed: "border-destructive/30 bg-destructive/10 text-destructive",
	unknown: "border-border bg-muted text-muted-foreground",
};

function isApiKeyAccount(account: RoutingAccountView): boolean {
	return account.authType.toLowerCase().includes("api");
}

function authLabel(account: RoutingAccountView): string {
	return isApiKeyAccount(account)
		? "API key"
		: account.authType.toLowerCase() === "oauth"
			? "OAuth"
			: account.authType;
}

function editDraftFor(account: RoutingAccountView): EditDraft {
	return {
		name: account.name,
		priority: account.priority === null ? "" : String(account.priority),
		apiKey: "",
	};
}

function priorityFrom(value: string): number | undefined {
	if (!value.trim()) return undefined;
	const priority = Number(value);
	return Number.isSafeInteger(priority) ? priority : undefined;
}

export default function AccountEditor({
	accounts,
	models,
	canWrite,
	canTest,
	activeMutation,
	onUpdate,
	onTest,
	onDelete,
	defaultEditingId = null,
	defaultDeleteId = null,
	defaultPendingDisableId = null,
	defaultExpandedTestId = null,
	defaultOpenMenuId = null,
	defaultTestResults = {},
	title = "Connected accounts",
	description = "",
	emptyMessage = "No accounts connected yet.",
}: AccountEditorProps) {
	const { t } = useTranslation("settings");
	const headingId = useId();
	const initialEditingAccount =
		accounts.find((account) => account.id === defaultEditingId) ?? null;
	const [editingId, setEditingId] = useState<string | null>(
		initialEditingAccount?.id ?? null,
	);
	const [editDraft, setEditDraft] = useState<EditDraft>(() =>
		initialEditingAccount
			? editDraftFor(initialEditingAccount)
			: { name: "", priority: "", apiKey: "" },
	);
	const [deleteId, setDeleteId] = useState<string | null>(defaultDeleteId);
	const [pendingDisableId, setPendingDisableId] = useState<string | null>(
		defaultPendingDisableId,
	);
	const [testingId, setTestingId] = useState<string | null>(null);
	const [testResults, setTestResults] =
		useState<Record<string, AccountTestRecord>>(defaultTestResults);
	const [expandedTestId, setExpandedTestId] = useState<string | null>(
		defaultExpandedTestId,
	);
	const busy = activeMutation !== null;
	const modelCount = (provider: string) =>
		models.filter((model) => model.provider === provider).length;
	const statusLabel = (account: RoutingAccountView) =>
		account.status === "unknown"
			? t("nineRouter.management.accounts.status.notTested")
			: t(`nineRouter.management.accounts.status.${account.status}`);

	const saveAccount = async (id: string) => {
		const submittedDraft = { ...editDraft };
		const input: UpdateRoutingAccountInput = {
			name: submittedDraft.name.trim(),
		};
		const priority = priorityFrom(submittedDraft.priority);
		if (priority !== undefined) input.priority = priority;
		if (submittedDraft.apiKey) input.apiKey = submittedDraft.apiKey;
		setEditDraft((current) => ({ ...current, apiKey: "" }));
		if (await onUpdate(id, input)) setEditingId(null);
		else setEditDraft(submittedDraft);
	};

	const testAccount = async (id: string) => {
		setTestingId(id);
		try {
			const record = await collectAccountTestRecord(
				() => onTest(id),
				t("nineRouter.management.accounts.testResult.transportFailure"),
			);
			setTestResults((current) => ({ ...current, [id]: record }));
		} finally {
			setTestingId((current) => (current === id ? null : current));
		}
	};

	return (
		<section aria-labelledby={headingId} className="space-y-3">
			<div>
				<h3 id={headingId} className="text-sm font-semibold text-foreground">
					{title}
				</h3>
				<p className="mt-1 text-xs leading-relaxed text-muted-foreground">
					{description}
				</p>
			</div>

			{accounts.length === 0 ? (
				<div className="border-y border-dashed border-border py-5 text-sm text-muted-foreground">
					{emptyMessage}
				</div>
			) : (
				<div className="divide-y divide-border border-y border-border">
					{accounts.map((account) => {
						const profile = NINE_ROUTER_PROVIDER_PROFILES.find(
							(item) => item.id === account.provider,
						);
						const providerName = profile?.name ?? account.provider;
						const count = modelCount(account.provider);
						const editing = editingId === account.id;
						const deleting = deleteId === account.id;
						const pendingDisable = pendingDisableId === account.id;
						const testing =
							testingId === account.id ||
							activeMutation === `account:test:${account.id}`;
						const testRecord = testResults[account.id];
						const testDetailsExpanded = expandedTestId === account.id;

						return (
							<article key={account.id} className="space-y-3 py-4">
								<div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
									<div className="flex min-w-0 gap-3">
										<span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-border bg-muted/40 text-foreground">
											<ProviderIcon
												icon={profile?.icon ?? "compatible"}
												label={providerName}
											/>
										</span>
										<div className="min-w-0 space-y-2">
											<div>
												<p className="truncate text-sm font-medium text-foreground">
													{account.name}
												</p>
												<p className="mt-0.5 text-xs text-muted-foreground">
													{providerName} · {count}{" "}
													{count === 1 ? "model" : "models"}
													{account.priority !== null
														? ` · Priority ${account.priority}`
														: ""}
												</p>
											</div>
											<dl className="flex flex-wrap gap-x-5 gap-y-2">
												<div>
													<dt className="text-[11px] text-muted-foreground">
														{t(
															"nineRouter.management.accounts.facts.connection",
														)}
													</dt>
													<dd className="mt-0.5 text-xs font-medium text-foreground">
														{t(
															account.active
																? "nineRouter.management.accounts.facts.enabled"
																: "nineRouter.management.accounts.facts.disabled",
														)}
													</dd>
												</div>
												<div>
													<dt className="text-[11px] text-muted-foreground">
														{t("nineRouter.management.accounts.facts.health")}
													</dt>
													<dd className="mt-0.5">
														<Badge
															variant="outline"
															className={statusTone[account.status]}
														>
															{statusLabel(account)}
														</Badge>
													</dd>
												</div>
												<div>
													<dt className="text-[11px] text-muted-foreground">
														{t(
															"nineRouter.management.accounts.facts.authentication",
														)}
													</dt>
													<dd className="mt-0.5 text-xs font-medium text-foreground">
														{authLabel(account)}
													</dd>
												</div>
											</dl>
											{account.lastError && (
												<p className="text-xs text-destructive">
													{account.lastError}
												</p>
											)}
										</div>
									</div>

									<div className="flex shrink-0 gap-1 sm:justify-end">
										{canTest && (
											<Button
												type="button"
												size="sm"
												variant="outline"
												onClick={() => void testAccount(account.id)}
												disabled={busy || testing}
												aria-busy={testing}
											>
												{testing ? (
													<Loader2 className="animate-spin motion-reduce:animate-none" />
												) : (
													<RefreshCw />
												)}
												{t(
													testing
														? "nineRouter.management.accounts.actions.testing"
														: "nineRouter.management.accounts.actions.test",
												)}
											</Button>
										)}
										{canWrite && (
											<ActionMenu
												label={t(
													"nineRouter.management.accounts.actions.options",
													{
														name: account.name,
													},
												)}
												ariaLabel={t(
													"nineRouter.management.accounts.actions.options",
													{
														name: account.name,
													},
												)}
												icon={MoreHorizontal}
												iconOnly
												portal={defaultOpenMenuId !== account.id}
												variant="ghost"
												size="icon"
												triggerClassName="h-9 w-9 text-muted-foreground"
												disabled={busy}
												defaultOpen={defaultOpenMenuId === account.id}
												items={[
													{
														key: "enabled",
														label: t(
															"nineRouter.management.accounts.actions.enabled",
														),
														description: t(
															"nineRouter.management.accounts.actions.enabledDescription",
														),
														icon: Power,
														checked: account.active,
														onSelect: () => {
															if (account.active)
																setPendingDisableId(account.id);
															else void onUpdate(account.id, { active: true });
														},
													},
													...(isApiKeyAccount(account)
														? [
																{
																	key: "edit",
																	label: t(
																		"nineRouter.management.accounts.actions.edit",
																	),
																	icon: Pencil,
																	disabled: editing,
																	onSelect: () => {
																		setEditDraft(editDraftFor(account));
																		setEditingId(account.id);
																	},
																},
															]
														: []),
													{
														key: "delete",
														label: t(
															"nineRouter.management.accounts.actions.delete",
														),
														icon: Trash2,
														isDanger: true,
														showDividerBefore: true,
														disabled: deleting,
														onSelect: () => setDeleteId(account.id),
													},
												]}
											/>
										)}
									</div>
								</div>

								{testRecord && (
									<div
										role="status"
										aria-live="polite"
										className={
											testRecord.result.healthy
												? "border-l-2 border-emerald-500/50 pl-3"
												: "border-l-2 border-destructive/50 pl-3"
										}
									>
										<div className="flex flex-wrap items-center justify-between gap-2">
											<div className="flex min-w-0 items-center gap-2 text-sm">
												{testRecord.result.healthy ? (
													<CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
												) : (
													<XCircle className="h-4 w-4 shrink-0 text-destructive" />
												)}
												<span className="font-medium text-foreground">
													{t(
														testRecord.result.healthy
															? "nineRouter.management.accounts.testResult.success"
															: "nineRouter.management.accounts.testResult.failure",
														{ duration: testRecord.durationMs },
													)}
												</span>
												{testRecord.result.error && (
													<span className="truncate text-xs text-destructive">
														{testRecord.result.error}
													</span>
												)}
											</div>
											<Button
												type="button"
												size="sm"
												variant="ghost"
												onClick={() =>
													setExpandedTestId((current) =>
														current === account.id ? null : account.id,
													)
												}
												aria-expanded={testDetailsExpanded}
											>
												{t(
													testDetailsExpanded
														? "nineRouter.management.accounts.testResult.hideDetails"
														: "nineRouter.management.accounts.testResult.viewDetails",
												)}
												<ChevronDown
													className={`transition-transform ${
														testDetailsExpanded ? "rotate-180" : ""
													}`}
												/>
											</Button>
										</div>
										{testDetailsExpanded && (
											<dl className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
												<div>
													<dt className="text-muted-foreground">
														{t(
															"nineRouter.management.accounts.testResult.completedAt",
														)}
													</dt>
													<dd className="mt-0.5 text-foreground">
														<time dateTime={testRecord.completedAt}>
															{new Date(
																testRecord.completedAt,
															).toLocaleString()}
														</time>
													</dd>
												</div>
												<div>
													<dt className="text-muted-foreground">
														{t(
															"nineRouter.management.accounts.testResult.duration",
														)}
													</dt>
													<dd className="mt-0.5 text-foreground">
														{testRecord.durationMs} ms
													</dd>
												</div>
												<div>
													<dt className="text-muted-foreground">
														{t(
															"nineRouter.management.accounts.testResult.health",
														)}
													</dt>
													<dd className="mt-0.5 text-foreground">
														{t(
															testRecord.result.healthy
																? "nineRouter.management.accounts.testResult.healthy"
																: "nineRouter.management.accounts.testResult.unhealthy",
														)}
													</dd>
												</div>
												<div>
													<dt className="text-muted-foreground">
														{t(
															"nineRouter.management.accounts.testResult.credentials",
														)}
													</dt>
													<dd className="mt-0.5 text-foreground">
														{t(
															testRecord.result.refreshed
																? "nineRouter.management.accounts.testResult.refreshed"
																: "nineRouter.management.accounts.testResult.notRefreshed",
														)}
													</dd>
												</div>
												<div className="sm:col-span-2">
													<dt className="text-muted-foreground">
														{t(
															"nineRouter.management.accounts.testResult.error",
														)}
													</dt>
													<dd className="mt-0.5 break-words text-foreground">
														{testRecord.result.error ??
															t(
																"nineRouter.management.accounts.testResult.noError",
															)}
													</dd>
												</div>
											</dl>
										)}
									</div>
								)}

								{pendingDisable && (
									<div
										role="alert"
										className="flex flex-col gap-3 border-l-2 border-amber-500/50 pl-3 sm:flex-row sm:items-center sm:justify-between"
									>
										<div>
											<p className="text-sm font-medium text-foreground">
												{t("nineRouter.management.accounts.disable.title", {
													name: account.name,
												})}
											</p>
											<p className="mt-1 text-xs leading-relaxed text-muted-foreground">
												{t("nineRouter.management.accounts.disable.impact")}
											</p>
										</div>
										<div className="flex shrink-0 justify-end gap-2">
											<Button
												type="button"
												size="sm"
												variant="ghost"
												onClick={() => setPendingDisableId(null)}
												disabled={busy}
											>
												{t("nineRouter.management.accounts.disable.cancel")}
											</Button>
											<Button
												type="button"
												size="sm"
												variant="outline"
												onClick={() =>
													void onUpdate(account.id, { active: false }).then(
														(updated) => {
															if (updated) setPendingDisableId(null);
														},
													)
												}
												disabled={busy}
											>
												{t("nineRouter.management.accounts.disable.confirm")}
											</Button>
										</div>
									</div>
								)}

								{editing && (
									<div className="grid gap-3 border-l-2 border-primary/40 pl-3 sm:grid-cols-3">
										<Input
											aria-label="Account name"
											value={editDraft.name}
											maxLength={256}
											onChange={(event) =>
												setEditDraft((current) => ({
													...current,
													name: event.target.value,
												}))
											}
											disabled={busy}
										/>
										<Input
											aria-label="Priority"
											type="number"
											value={editDraft.priority}
											onChange={(event) =>
												setEditDraft((current) => ({
													...current,
													priority: event.target.value,
												}))
											}
											disabled={busy}
										/>
										<Input
											aria-label="Replacement API key"
											type="password"
											autoComplete="off"
											value={editDraft.apiKey}
											placeholder="Keep current key"
											onChange={(event) =>
												setEditDraft((current) => ({
													...current,
													apiKey: event.target.value,
												}))
											}
											disabled={busy}
										/>
										<div className="flex justify-end gap-2 sm:col-span-3">
											<Button
												type="button"
												size="sm"
												variant="ghost"
												onClick={() => {
													setEditDraft((current) => ({
														...current,
														apiKey: "",
													}));
													setEditingId(null);
												}}
												disabled={busy}
											>
												Cancel
											</Button>
											<Button
												type="button"
												size="sm"
												onClick={() => void saveAccount(account.id)}
												disabled={busy || !editDraft.name.trim()}
											>
												Save
											</Button>
										</div>
									</div>
								)}

								{deleting && (
									<div
										role="alert"
										className="flex flex-col gap-3 border-l-2 border-destructive/50 pl-3 sm:flex-row sm:items-center sm:justify-between"
									>
										<p className="text-sm text-foreground">
											Delete {account.name}? This cannot be undone.
										</p>
										<div className="flex justify-end gap-2">
											<Button
												type="button"
												size="sm"
												variant="ghost"
												onClick={() => setDeleteId(null)}
												disabled={busy}
											>
												Cancel
											</Button>
											<Button
												type="button"
												size="sm"
												variant="destructive"
												onClick={() =>
													void onDelete(account.id).then((deleted) => {
														if (deleted) setDeleteId(null);
													})
												}
												disabled={busy}
											>
												Delete account
											</Button>
										</div>
									</div>
								)}
							</article>
						);
					})}
				</div>
			)}
		</section>
	);
}
