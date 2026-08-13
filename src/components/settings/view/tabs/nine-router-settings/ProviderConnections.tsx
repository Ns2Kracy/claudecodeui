import { useEffect, useRef, useState } from "react";
import { ExternalLink, Loader2 } from "lucide-react";

import type { RoutingDeviceCodeChallengeView } from "../../../../../../shared/routing.js";
import { Button } from "../../../../../shared/view/ui";

import {
	connectApiKeyProvider,
	type ApiKeyProviderDraft,
} from "./apiKeyProvider.js";
import { NINE_ROUTER_PROVIDER_PROFILES } from "./ProviderCatalog.js";
import ProviderConnectionDialog, {
	isAllowedOAuthUrl,
} from "./ProviderConnectionDialog.js";
import ProviderIcon from "./ProviderIcon.js";
import { parseProviderOAuthCallback } from "./providerOAuthCallback.js";
import { routingApi, RoutingApiError } from "./routingApi.js";

type ProviderConnectionsProps = {
	disabled: boolean;
	onConnected: () => Promise<void> | void;
};

type SafeError = {
	code: string;
	message: string;
	status: number;
	retryable: boolean;
};

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
}: ProviderConnectionsProps) {
	const [selectedId, setSelectedId] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<SafeError | null>(null);
	const [challenge, setChallenge] =
		useState<RoutingDeviceCodeChallengeView | null>(null);
	const [deviceStatus, setDeviceStatus] = useState<
		"idle" | "pending" | "success"
	>("idle");
	const popupRef = useRef<Window | null>(null);
	const oauthRef = useRef<{
		provider: string;
		transactionId: string;
		redirectUri: string;
	} | null>(null);
	const profiles = NINE_ROUTER_PROVIDER_PROFILES;
	const codex = profiles.find((item) => item.id === "codex")!;
	const apiKeyProfiles = profiles.filter((item) => item.group === "api_key");
	const profile = profiles.find((item) => item.id === selectedId) ?? null;

	useEffect(() => {
		const receiveCallback = (event: MessageEvent) => {
			const transaction = oauthRef.current;
			if (!transaction) return;
			const callback = parseProviderOAuthCallback(
				event,
				popupRef.current,
				transaction.redirectUri,
			);
			if (!callback) return;
			setBusy(true);
			void routingApi
				.exchangeOAuth(transaction.provider, {
					transactionId: transaction.transactionId,
					...callback,
				})
				.then(async () => {
					setError(null);
					await onConnected();
				})
				.catch((nextError) => setError(safeError(nextError)))
				.finally(() => {
					oauthRef.current = null;
					popupRef.current?.close();
					popupRef.current = null;
					setBusy(false);
				});
		};
		window.addEventListener("message", receiveCallback);
		return () => window.removeEventListener("message", receiveCallback);
	}, [onConnected]);

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

	const startOAuth = (provider: string) =>
		run(async () => {
			const started = await routingApi.startOAuth(provider);
			if (!isAllowedOAuthUrl(started.authUrl))
				throw new Error("9Router returned an unsafe OAuth URL.");
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
			<section
				aria-labelledby="codex-oauth-title"
				className="flex flex-col gap-4 border-b border-border pb-6 sm:flex-row sm:items-center sm:justify-between"
			>
				<div className="flex min-w-0 gap-3">
					<span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-foreground text-background">
						<ProviderIcon icon={codex.icon} label="Codex" className="h-6 w-6" />
					</span>
					<div>
						<h4
							id="codex-oauth-title"
							className="text-sm font-semibold text-foreground"
						>
							Codex OAuth
						</h4>
						<p className="mt-1 max-w-xl text-sm leading-relaxed text-muted-foreground">
							Sign in with ChatGPT. OAuth credentials stay in 9Router and are
							never stored by CloudCLI.
						</p>
					</div>
				</div>
				<Button
					type="button"
					className="shrink-0"
					disabled={disabled || busy}
					onClick={() => void startOAuth(codex.id)}
				>
					{busy && selectedId === null ? (
						<Loader2 className="animate-spin motion-reduce:animate-none" />
					) : (
						<ExternalLink />
					)}
					Continue with ChatGPT
				</Button>
			</section>

			<section aria-labelledby="api-key-providers-title" className="space-y-3">
				<div>
					<h4
						id="api-key-providers-title"
						className="text-sm font-semibold text-foreground"
					>
						API Key authentication
					</h4>
					<p className="mt-1 text-xs leading-relaxed text-muted-foreground">
						Choose a provider and confirm its API endpoint.
					</p>
				</div>
				<div
					className="flex flex-wrap gap-2"
					role="list"
					aria-label="API Key providers"
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

			{profile && (
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
