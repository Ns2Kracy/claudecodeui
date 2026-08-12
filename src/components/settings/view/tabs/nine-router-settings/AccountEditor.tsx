import React, { useMemo, useState } from "react";
import {
	KeyRound,
	Loader2,
	Pencil,
	Plus,
	Power,
	RefreshCw,
	Trash2,
	X,
} from "lucide-react";
import { useTranslation } from "react-i18next";

import type {
	CreateRoutingApiKeyAccountInput,
	RoutingAccountView,
	RoutingModelView,
	UpdateRoutingAccountInput,
} from "../../../../../../shared/routing.js";
import { Badge, Button, Input } from "../../../../../shared/view/ui";

import { NINE_ROUTER_PROVIDER_PROFILES } from "./ProviderCatalog.js";
import type { RoutingAccountDraft } from "./routingState.js";

type AccountEditorProps = {
	accounts: RoutingAccountView[];
	models: RoutingModelView[];
	canWrite: boolean;
	canTest: boolean;
	activeMutation: string | null;
	draft: RoutingAccountDraft;
	onDraftFieldChange: (
		field: keyof RoutingAccountDraft,
		value: string | number | boolean | undefined,
	) => void;
	onCreate: (input: CreateRoutingApiKeyAccountInput) => Promise<boolean>;
	onUpdate: (id: string, input: UpdateRoutingAccountInput) => Promise<boolean>;
	onTest: (id: string) => Promise<boolean>;
	onDelete: (id: string) => Promise<boolean>;
	defaultAdding?: boolean;
	defaultEditingId?: string | null;
	defaultDeleteId?: string | null;
};

type EditDraft = {
	name: string;
	priority: string;
	apiKey: string;
};

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
	draft,
	onDraftFieldChange,
	onCreate,
	onUpdate,
	onTest,
	onDelete,
	defaultAdding = false,
	defaultEditingId = null,
	defaultDeleteId = null,
}: AccountEditorProps) {
	const { t } = useTranslation("settings");
	const [adding, setAdding] = useState(defaultAdding);
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
	const busy = activeMutation !== null;
	const providers = useMemo(() => {
		const knownApiKeyProviders = NINE_ROUTER_PROVIDER_PROFILES.filter(
			(profile) => profile.methods.includes("api_key"),
		).map((profile) => profile.id);
		return [
			...new Set([
				...knownApiKeyProviders,
				...accounts.map((account) => account.provider).filter(Boolean),
				...models.map((model) => model.provider).filter(Boolean),
			]),
		].sort((a, b) => a.localeCompare(b));
	}, [accounts, models]);
	const groupedAccounts = useMemo(() => {
		const groups = new Map<string, RoutingAccountView[]>();
		for (const account of accounts) {
			const current = groups.get(account.provider) ?? [];
			current.push(account);
			groups.set(account.provider, current);
		}
		return [...groups.entries()].sort(([first], [second]) =>
			first.localeCompare(second),
		);
	}, [accounts]);

	const createAccount = async () => {
		const input: CreateRoutingApiKeyAccountInput = {
			provider: draft.provider.trim(),
			name: draft.name.trim(),
			apiKey: draft.apiKey,
			active: true,
		};
		if (draft.priority !== undefined) input.priority = draft.priority;
		if (await onCreate(input)) setAdding(false);
	};

	const saveAccount = async (id: string) => {
		const submittedDraft = { ...editDraft };
		const input: UpdateRoutingAccountInput = {
			name: submittedDraft.name.trim(),
		};
		const priority = priorityFrom(submittedDraft.priority);
		if (priority !== undefined) input.priority = priority;
		if (submittedDraft.apiKey) input.apiKey = submittedDraft.apiKey;
		setEditDraft((current) => ({ ...current, apiKey: "" }));
		if (await onUpdate(id, input)) {
			setEditingId(null);
		} else {
			setEditDraft(submittedDraft);
		}
	};

	const canCreate =
		canWrite &&
		Boolean(draft.provider.trim() && draft.name.trim() && draft.apiKey) &&
		!busy;

	return (
		<section aria-labelledby="nine-router-accounts-title" className="space-y-4">
			<div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
				<div className="space-y-1">
					<h3
						id="nine-router-accounts-title"
						className="text-sm font-semibold text-foreground"
					>
						{t("nineRouter.management.accounts.title")}
					</h3>
					<p className="text-xs leading-relaxed text-muted-foreground">
						{t("nineRouter.management.accounts.description")}
					</p>
				</div>
				<Button
					type="button"
					size="sm"
					variant="outline"
					onClick={() => setAdding(true)}
					disabled={!canWrite || busy || adding}
				>
					<Plus className="h-4 w-4" />
					{t("nineRouter.management.accounts.add")}
				</Button>
			</div>

			{adding && (
				<div className="space-y-4 rounded-lg border border-border bg-background p-4">
					<div className="flex items-center justify-between gap-3">
						<div>
							<h4 className="text-sm font-medium text-foreground">
								{t("nineRouter.management.accounts.addTitle")}
							</h4>
							<p className="text-xs text-muted-foreground">
								{t("nineRouter.management.accounts.apiKeyOnly")}
							</p>
						</div>
						<Button
							type="button"
							size="sm"
							variant="ghost"
							aria-label={t("nineRouter.management.actions.cancel")}
							onClick={() => {
								onDraftFieldChange("apiKey", "");
								setAdding(false);
							}}
							disabled={busy}
						>
							<X className="h-4 w-4" />
						</Button>
					</div>

					<div className="grid gap-4 sm:grid-cols-2">
						<div className="space-y-2">
							<label
								htmlFor="nine-router-account-provider"
								className="text-xs font-medium text-foreground"
							>
								{t("nineRouter.management.accounts.provider")}
							</label>
							<select
								id="nine-router-account-provider"
								value={draft.provider}
								onChange={(event) =>
									onDraftFieldChange("provider", event.target.value)
								}
								disabled={busy || providers.length === 0}
								className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
							>
								<option value="">
									{t("nineRouter.management.accounts.selectProvider")}
								</option>
								{providers.map((provider) => (
									<option key={provider} value={provider}>
										{provider}
									</option>
								))}
							</select>
						</div>
						<div className="space-y-2">
							<label
								htmlFor="nine-router-account-name"
								className="text-xs font-medium text-foreground"
							>
								{t("nineRouter.management.accounts.name")}
							</label>
							<Input
								id="nine-router-account-name"
								value={draft.name}
								maxLength={256}
								onChange={(event) =>
									onDraftFieldChange("name", event.target.value)
								}
								disabled={busy}
							/>
						</div>
						<div className="space-y-2">
							<label
								htmlFor="nine-router-account-key"
								className="text-xs font-medium text-foreground"
							>
								{t("nineRouter.management.accounts.apiKey")}
							</label>
							<Input
								id="nine-router-account-key"
								type="password"
								autoComplete="off"
								value={draft.apiKey}
								onChange={(event) =>
									onDraftFieldChange("apiKey", event.target.value)
								}
								disabled={busy}
							/>
						</div>
						<div className="space-y-2">
							<label
								htmlFor="nine-router-account-priority"
								className="text-xs font-medium text-foreground"
							>
								{t("nineRouter.management.accounts.priority")}
							</label>
							<Input
								id="nine-router-account-priority"
								type="number"
								value={draft.priority ?? ""}
								onChange={(event) =>
									onDraftFieldChange(
										"priority",
										priorityFrom(event.target.value),
									)
								}
								disabled={busy}
							/>
						</div>
					</div>

					{providers.length === 0 && (
						<p
							className="text-xs text-amber-700 dark:text-amber-300"
							role="status"
						>
							{t("nineRouter.management.accounts.noProviders")}
						</p>
					)}

					<div className="flex justify-end">
						<Button
							type="button"
							size="sm"
							onClick={() => {
								void createAccount();
							}}
							disabled={!canCreate}
						>
							{activeMutation === "account:create" ? (
								<Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" />
							) : (
								<KeyRound className="h-4 w-4" />
							)}
							{t("nineRouter.management.actions.save")}
						</Button>
					</div>
				</div>
			)}

			{accounts.length === 0 ? (
				<p className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
					{t("nineRouter.management.accounts.empty")}
				</p>
			) : (
				<div className="space-y-4">
					{groupedAccounts.map(([provider, providerAccounts]) => (
						<div key={provider} className="space-y-2">
							<h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
								{provider}
							</h4>
							<div className="divide-y divide-border rounded-lg border border-border bg-background">
								{providerAccounts.map((account) => {
									const editing = editingId === account.id;
									const deleting = deleteId === account.id;
									const testingAccount =
										activeMutation === `account:test:${account.id}`;
									return (
										<div key={account.id} className="space-y-3 p-3">
											<div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
												<div className="min-w-0 space-y-1.5">
													<div className="flex flex-wrap items-center gap-2">
														<span className="text-sm font-medium text-foreground">
															{account.name}
														</span>
														<Badge
															variant="outline"
															className={statusTone[account.status]}
														>
															{t(
																`nineRouter.management.accounts.status.${account.status}`,
															)}
														</Badge>
														<Badge variant="outline">{account.authType}</Badge>
														{!account.active && (
															<Badge variant="outline">
																{t("nineRouter.management.accounts.disabled")}
															</Badge>
														)}
													</div>
													<p className="text-xs text-muted-foreground">
														{t("nineRouter.management.accounts.priority")}:{" "}
														{account.priority ??
															t(
																"nineRouter.management.accounts.defaultPriority",
															)}
														{" · "}
														{t("nineRouter.management.accounts.expires")}:{" "}
														{account.expiresAt?.slice(0, 10) ??
															t("nineRouter.management.accounts.never")}
													</p>
													{account.lastError && (
														<p className="text-xs text-destructive">
															{account.lastError}
														</p>
													)}
												</div>

												<div className="flex flex-wrap gap-1.5">
													{canTest && (
														<Button
															type="button"
															size="sm"
															variant="ghost"
															onClick={() => {
																void onTest(account.id);
															}}
															disabled={busy}
														>
															{testingAccount ? (
																<Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" />
															) : (
																<RefreshCw className="h-3.5 w-3.5" />
															)}
															{t("nineRouter.management.actions.test")}
														</Button>
													)}
													{canWrite && (
														<Button
															type="button"
															size="sm"
															variant="ghost"
															onClick={() => {
																void onUpdate(account.id, {
																	active: !account.active,
																});
															}}
															disabled={busy}
														>
															<Power className="h-3.5 w-3.5" />
															{account.active
																? t("nineRouter.management.actions.disable")
																: t("nineRouter.management.actions.enable")}
														</Button>
													)}
													{canWrite && isApiKeyAccount(account) && (
														<Button
															type="button"
															size="sm"
															variant="ghost"
															onClick={() => {
																setEditDraft(editDraftFor(account));
																setEditingId(account.id);
															}}
															disabled={busy || editing}
														>
															<Pencil className="h-3.5 w-3.5" />
															{t("nineRouter.management.actions.edit")}
														</Button>
													)}
													{canWrite && (
														<Button
															type="button"
															size="sm"
															variant="ghost"
															onClick={() => {
																if (editing) {
																	setEditDraft((current) => ({
																		...current,
																		apiKey: "",
																	}));
																	setEditingId(null);
																}
																setDeleteId(account.id);
															}}
															disabled={busy || deleting}
														>
															<Trash2 className="h-3.5 w-3.5" />
															{t("nineRouter.management.actions.delete")}
														</Button>
													)}
												</div>
											</div>

											{editing && (
												<div className="grid gap-3 border-t border-border pt-3 sm:grid-cols-3">
													<Input
														aria-label={t(
															"nineRouter.management.accounts.name",
														)}
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
														aria-label={t(
															"nineRouter.management.accounts.priority",
														)}
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
														aria-label={t(
															"nineRouter.management.accounts.replacementKey",
														)}
														type="password"
														autoComplete="off"
														value={editDraft.apiKey}
														placeholder={t(
															"nineRouter.management.accounts.keepKey",
														)}
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
															{t("nineRouter.management.actions.cancel")}
														</Button>
														<Button
															type="button"
															size="sm"
															onClick={() => {
																void saveAccount(account.id);
															}}
															disabled={busy || !editDraft.name.trim()}
														>
															{activeMutation ===
																`account:update:${account.id}` && (
																<Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" />
															)}
															{t("nineRouter.management.actions.save")}
														</Button>
													</div>
												</div>
											)}

											{deleting && (
												<div
													role="alert"
													className="flex flex-col gap-3 rounded-md border border-destructive/30 bg-destructive/5 p-3 sm:flex-row sm:items-center sm:justify-between"
												>
													<p className="text-sm text-foreground">
														{t("nineRouter.management.accounts.confirmDelete", {
															name: account.name,
														})}
													</p>
													<div className="flex justify-end gap-2">
														<Button
															type="button"
															size="sm"
															variant="ghost"
															onClick={() => setDeleteId(null)}
															disabled={busy}
														>
															{t("nineRouter.management.actions.cancel")}
														</Button>
														<Button
															type="button"
															size="sm"
															variant="destructive"
															onClick={() => {
																void onDelete(account.id).then((deleted) => {
																	if (deleted) setDeleteId(null);
																});
															}}
															disabled={busy}
														>
															{t("nineRouter.management.actions.confirmDelete")}
														</Button>
													</div>
												</div>
											)}
										</div>
									);
								})}
							</div>
						</div>
					))}
				</div>
			)}
		</section>
	);
}
