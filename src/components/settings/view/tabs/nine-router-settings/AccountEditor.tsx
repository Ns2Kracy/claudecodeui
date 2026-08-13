import { useId, useState } from "react";
import { Loader2, Pencil, Power, RefreshCw, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";

import type {
	RoutingAccountView,
	RoutingModelView,
	UpdateRoutingAccountInput,
} from "../../../../../../shared/routing.js";
import { Badge, Button, Input } from "../../../../../shared/view/ui";

import { NINE_ROUTER_PROVIDER_PROFILES } from "./ProviderCatalog.js";
import ProviderIcon from "./ProviderIcon.js";

type AccountEditorProps = {
	accounts: RoutingAccountView[];
	models: RoutingModelView[];
	canWrite: boolean;
	canTest: boolean;
	activeMutation: string | null;
	onUpdate: (id: string, input: UpdateRoutingAccountInput) => Promise<boolean>;
	onTest: (id: string) => Promise<boolean>;
	onDelete: (id: string) => Promise<boolean>;
	defaultEditingId?: string | null;
	defaultDeleteId?: string | null;
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
	title = "Connected accounts",
	description = "Accounts available to Codex through the Provider Router.",
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
	const busy = activeMutation !== null;
	const modelCount = (provider: string) =>
		models.filter((model) => model.provider === provider).length;
	const statusLabel = (account: RoutingAccountView) =>
		account.status === "unknown"
			? isApiKeyAccount(account)
				? t("nineRouter.management.accounts.status.notTested")
				: t("nineRouter.connection.status.connected")
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
						const testing = activeMutation === `account:test:${account.id}`;

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
										<div className="min-w-0 space-y-1.5">
											<div className="flex flex-wrap items-center gap-2">
												<span className="truncate text-sm font-medium text-foreground">
													{account.name}
												</span>
												<Badge
													variant="outline"
													className={
														account.status === "unknown" &&
														!isApiKeyAccount(account)
															? statusTone.healthy
															: statusTone[account.status]
													}
												>
													{statusLabel(account)}
												</Badge>
												<Badge variant="outline">{authLabel(account)}</Badge>
												{!account.active && (
													<Badge variant="outline">
														{t("nineRouter.management.accounts.disabled")}
													</Badge>
												)}
											</div>
											<p className="text-xs text-muted-foreground">
												{providerName} · {count}{" "}
												{count === 1 ? "model" : "models"}
												{account.priority !== null
													? ` · Priority ${account.priority}`
													: ""}
											</p>
											{account.lastError && (
												<p className="text-xs text-destructive">
													{account.lastError}
												</p>
											)}
										</div>
									</div>

									<div className="flex flex-wrap gap-1 sm:justify-end">
										{canTest && (
											<Button
												type="button"
												size="sm"
												variant="ghost"
												onClick={() => void onTest(account.id)}
												disabled={busy}
											>
												{testing ? (
													<Loader2 className="animate-spin motion-reduce:animate-none" />
												) : (
													<RefreshCw />
												)}
												Test
											</Button>
										)}
										{canWrite && (
											<Button
												type="button"
												size="sm"
												variant="ghost"
												onClick={() =>
													void onUpdate(account.id, { active: !account.active })
												}
												disabled={busy}
											>
												<Power />
												{account.active ? "Disable" : "Enable"}
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
												<Pencil />
												Edit
											</Button>
										)}
										{canWrite && (
											<Button
												type="button"
												size="sm"
												variant="ghost"
												onClick={() => setDeleteId(account.id)}
												disabled={busy || deleting}
											>
												<Trash2 />
												Delete
											</Button>
										)}
									</div>
								</div>

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
