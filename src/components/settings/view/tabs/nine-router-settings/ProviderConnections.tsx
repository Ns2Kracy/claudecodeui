import { useCallback, useEffect, useRef, useState } from "react";
import { CheckCircle2, ExternalLink, Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";

import type { RoutingDeviceCodeChallengeView } from "../../../../../../shared/routing.js";
import { Button } from "../../../../../shared/view/ui";

import {
	connectApiKeyProvider,
	type ApiKeyProviderDraft,
} from "./apiKeyProvider.js";
import { NINE_ROUTER_PROVIDER_PROFILES } from "./ProviderCatalog.js";
import ManualOAuthCallbackForm from "./ManualOAuthCallbackForm.js";
import ProviderConnectionDialog, {
	isAllowedOAuthUrl,
} from "./ProviderConnectionDialog.js";
import ProviderIcon from "./ProviderIcon.js";
import {
	parseManualProviderOAuthCallback,
	parseProviderOAuthCallback,
} from "./providerOAuthCallback.js";
import { routingApi, RoutingApiError } from "./routingApi.js";

type ProviderOAuthTransaction = {
	provider: string;
	transactionId: string;
	redirectUri: string;
};

type ProviderConnectionsProps = {
	disabled: boolean;
	onConnected: () => Promise<void> | void;
	mode?: "all" | "oauth" | "apiKey";
	hasCodexAccount?: boolean;
};

type SafeError = {
	code: string;
	message: string;
	status: number;
	retryable: boolean;
};

function claimOAuthTransaction(transactionRef: {
	current: ProviderOAuthTransaction | null;
}): ProviderOAuthTransaction | null {
	const transaction = transactionRef.current;
	transactionRef.current = null;
	return transaction;
}

function safeError(error: unknown): SafeError {
	if (error instanceof RoutingApiError) return error;
	return {
		code: "ROUTING_OPERATION_FAILED",
		message:
			error instanceof Error
				? error.message
				: "The provider could not be connected.",
		status: 0,
		retryable: true,
	};
}

export default function ProviderConnections({
	disabled,
	onConnected,
	mode = "all",
	hasCodexAccount = false,
}: ProviderConnectionsProps) {
	const { t } = useTranslation("settings");
	const [selectedId, setSelectedId] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<SafeError | null>(null);
	const [challenge, setChallenge] =
		useState<RoutingDeviceCodeChallengeView | null>(null);
	const [deviceStatus, setDeviceStatus] = useState<
		"idle" | "pending" | "success"
	>("idle");
	const popupRef = useRef<Window | null>(null);
	const oauthRef = useRef<ProviderOAuthTransaction | null>(null);
	const profiles = NINE_ROUTER_PROVIDER_PROFILES;
	const codex = profiles.find((item) => item.id === "codex")!;
	const apiKeyProfiles = profiles.filter((item) => item.group === "api_key");
	const profile = profiles.find((item) => item.id === selectedId) ?? null;

	useEffect(() => {
		if (!challenge || deviceStatus !== "pending") return undefined;
		let cancelled = false;
		const timer = window.setTimeout(
			async () => {
				try {
					const result = await routingApi.pollDeviceCode(
						challenge.provider,
						challenge.transactionId,
					);
					if (cancelled) return;
					if (result.pending) setChallenge({ ...challenge });
					else {
						setDeviceStatus("success");
						await onConnected();
					}
				} catch (nextError) {
					if (!cancelled) {
						setError(safeError(nextError));
						setDeviceStatus("idle");
					}
				}
			},
			Math.max(1, challenge.interval ?? 5) * 1_000,
		);
		return () => {
			cancelled = true;
			window.clearTimeout(timer);
		};
	}, [challenge, deviceStatus, onConnected]);

	const run = async (operation: () => Promise<void>): Promise<boolean> => {
		if (busy) return false;
		setBusy(true);
		setError(null);
		try {
			await operation();
			return true;
		} catch (nextError) {
			setError(safeError(nextError));
			return false;
		} finally {
			setBusy(false);
		}
	};

	const completeOAuth = useCallback(
		async (callback: { state: string; code: string }): Promise<boolean> => {
			const transaction = claimOAuthTransaction(oauthRef);
			if (!transaction) {
				setError({
					code: "ROUTING_OAUTH_NOT_STARTED",
					message: "Start browser sign-in before submitting a callback URL.",
					status: 0,
					retryable: true,
				});
				return false;
			}
			setBusy(true);
			setError(null);
			try {
				await routingApi.exchangeOAuth(transaction.provider, {
					transactionId: transaction.transactionId,
					...callback,
				});
			} catch (nextError) {
				oauthRef.current = transaction;
				setError(safeError(nextError));
				setBusy(false);
				return false;
			}

			popupRef.current?.close();
			popupRef.current = null;
			try {
				await onConnected();
				return true;
			} catch (nextError) {
				setError(safeError(nextError));
				return false;
			} finally {
				setBusy(false);
			}
		},
		[onConnected],
	);

	useEffect(() => {
		const receiveCallback = (event: MessageEvent) => {
			const transaction = oauthRef.current;
			if (!transaction) return;
			const callback = parseProviderOAuthCallback(
				event,
				popupRef.current,
				transaction.redirectUri,
			);
			if (callback) void completeOAuth(callback);
		};
		window.addEventListener("message", receiveCallback);
		return () => window.removeEventListener("message", receiveCallback);
	}, [completeOAuth]);

	const submitManualOAuth = async (callbackUrl: string): Promise<boolean> => {
		const transaction = oauthRef.current;
		if (!transaction) {
			setError({
				code: "ROUTING_OAUTH_NOT_STARTED",
				message: "Start browser sign-in before submitting a callback URL.",
				status: 0,
				retryable: true,
			});
			return false;
		}
		const parsed = parseManualProviderOAuthCallback(
			callbackUrl,
			transaction.redirectUri,
		);
		if (!parsed.ok) {
			setError({
				code: "ROUTING_OAUTH_CALLBACK_INVALID",
				message: parsed.error,
				status: 0,
				retryable: true,
			});
			return false;
		}
		return completeOAuth(parsed.callback);
	};

	const startOAuth = (provider: string) =>
		run(async () => {
			const started = await routingApi.startOAuth(provider);
			if (!isAllowedOAuthUrl(started.authUrl))
				throw new Error();
			const popup = window.open(
				started.authUrl,
				"cloudcli-9router-oauth",
				"popup,width=720,height=760",
			);
			if (!popup)
				throw new Error("OAuth popup was blocked. Allow popups and try again.");
			popupRef.current = popup;
			oauthRef.current = {
				provider,
				transactionId: started.transactionId,
				redirectUri: started.redirectUri,
			};
		});

	const select = (id: string) => {
		setSelectedId((current) => (current === id ? null : id));
		setError(null);
		setChallenge(null);
		setDeviceStatus("idle");
	};

	return (
		<div className="space-y-6">
			{mode !== "apiKey" && (
				<section
					aria-labelledby="codex-oauth-title"
					className={`space-y-4 ${mode === "all" ? "border-b border-border pb-6" : ""}`}
				>
					<div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
						<div className="flex min-w-0 gap-3">
							<span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-foreground text-background">
								<ProviderIcon
									icon={codex.icon}
									label="Codex"
									className="h-6 w-6"
								/>
							</span>
							<div>
								<h4
									id="codex-oauth-title"
									className="text-sm font-semibold text-foreground"
								>
									{t("nineRouter.management.authentication.oauth.title")}
								</h4>
								<p className="mt-1 max-w-xl text-sm leading-relaxed text-muted-foreground">
									{t("nineRouter.management.authentication.oauth.description")}
								</p>
							</div>
						</div>
						<div className="flex shrink-0 flex-col items-start gap-2 sm:items-end">
							{hasCodexAccount && (
								<span className="inline-flex items-center gap-1.5 text-sm font-medium text-emerald-700 dark:text-emerald-300">
									<CheckCircle2 className="h-4 w-4" />
									{t("nineRouter.management.authentication.oauth.connected")}
								</span>
							)}
							<Button
								type="button"
								variant={hasCodexAccount ? "outline" : "default"}
								className="shrink-0"
								disabled={disabled || busy}
								onClick={() => void startOAuth(codex.id)}
							>
								{busy ? (
									<Loader2 className="animate-spin motion-reduce:animate-none" />
								) : (
									<ExternalLink />
								)}
								{t(
									hasCodexAccount
										? "nineRouter.management.authentication.oauth.addAnother"
										: "nineRouter.management.authentication.oauth.continue",
								)}
							</Button>
						</div>
					</div>
					<ManualOAuthCallbackForm
						busy={busy}
						error={error?.message ?? null}
						onSubmit={submitManualOAuth}
					/>
				</section>
			)}

			{mode !== "oauth" && (
				<section
					aria-labelledby="api-key-providers-title"
					className="space-y-3"
				>
					<div>
						<h4
							id="api-key-providers-title"
							className="text-sm font-semibold text-foreground"
						>
							{t("nineRouter.management.authentication.apiKey.title")}
						</h4>
						<p className="mt-1 text-xs leading-relaxed text-muted-foreground">
							{t("nineRouter.management.authentication.apiKey.description")}
						</p>
					</div>
					<div
						className="flex flex-wrap gap-2"
						role="group"
						aria-label={t(
							"nineRouter.management.authentication.apiKey.providersLabel",
						)}
					>
						{apiKeyProfiles.map((item) => (
							<Button
								key={item.id}
								type="button"
								variant={selectedId === item.id ? "secondary" : "outline"}
								disabled={disabled}
								aria-expanded={selectedId === item.id}
								onClick={() => select(item.id)}
							>
								<ProviderIcon icon={item.icon} label={item.name} />
								{item.name}
							</Button>
						))}
					</div>
				</section>
			)}

			{mode !== "oauth" && profile && (
				<div className="border-l-2 border-primary/50 pl-4">
					<ProviderConnectionDialog
						key={profile.id}
						profile={profile}
						busy={busy}
						error={error}
						deviceChallenge={challenge}
						deviceStatus={deviceStatus}
						onConnectApiKey={(draft: ApiKeyProviderDraft) =>
							run(async () => {
								await connectApiKeyProvider(routingApi, profile, draft);
								setSelectedId(null);
								await onConnected();
							})
						}
						onStartOAuth={startOAuth}
						onStartDeviceCode={(provider) =>
							run(async () => {
								setChallenge(await routingApi.startDeviceCode(provider));
								setDeviceStatus("pending");
							})
						}
						onCancelDeviceCode={async (provider, transactionId) => {
							await run(async () => {
								await routingApi.cancelDeviceCode(provider, transactionId);
								setChallenge(null);
								setDeviceStatus("idle");
							});
						}}
					/>
				</div>
			)}
		</div>
	);
}
