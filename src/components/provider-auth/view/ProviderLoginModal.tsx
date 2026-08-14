import { useCallback, useEffect, useRef, useState } from "react";
import { ExternalLink, Loader2, X } from "lucide-react";

import {
	routingApi,
	RoutingApiError,
} from "../../settings/view/tabs/nine-router-settings/routingApi.js";
import { isAllowedOAuthUrl } from "../../settings/view/tabs/nine-router-settings/ProviderConnectionDialog.js";
import type { RoutingOAuthStartView } from "../../../../shared/routing.js";
import type { LLMProvider } from "../../../types/app";

type ProviderLoginModalProps = {
	isOpen: boolean;
	onClose: () => void;
	provider?: LLMProvider;
	onComplete?: (exitCode: number) => void;
	customCommand?: string;
	isAuthenticated?: boolean;
};

type StartCodexRoutingOAuthDependencies = {
	startOAuth(provider: string): Promise<RoutingOAuthStartView>;
	openPopup(url: string): Window | null;
};

export type CodexRoutingOAuthSession = {
	popup: Window;
	transactionId: string;
};

/** Starts Codex OAuth through the same-origin 9Router API after validating the upstream URL. */
export async function startCodexRoutingOAuth(
	dependencies: StartCodexRoutingOAuthDependencies,
): Promise<CodexRoutingOAuthSession> {
	const started = await dependencies.startOAuth("codex");
	if (!isAllowedOAuthUrl(started.authUrl)) {
		throw new Error();
	}

	const popup = dependencies.openPopup(started.authUrl);
	if (!popup) {
		throw new Error("OAuth popup was blocked. Allow popups and try again.");
	}

	return { popup, transactionId: started.transactionId };
}

export function parseCodexOAuthCallback(
	event: MessageEvent,
	popup: Window | null,
): { state: string; code: string } | null {
	if (
		event.origin !== window.location.origin ||
		event.source !== popup ||
		!event.data ||
		event.data.type !== "routing-oauth-callback" ||
		typeof event.data.url !== "string"
	) {
		return null;
	}

	let callback: URL;
	try {
		callback = new URL(event.data.url);
	} catch {
		return null;
	}
	if (
		callback.origin !== window.location.origin ||
		callback.pathname !== "/api/routing/oauth/codex/callback"
	) {
		return null;
	}

	const state = callback.searchParams.get("state");
	const code = callback.searchParams.get("code");
	return state && code ? { state, code } : null;
}

function errorMessage(error: unknown): string {
	if (error instanceof RoutingApiError || error instanceof Error) {
		return error.message;
	}
	return "";
}

export default function ProviderLoginModal({
	isOpen,
	onClose,
	provider: _provider = "codex",
	onComplete,
	customCommand: _customCommand,
	isAuthenticated = false,
}: ProviderLoginModalProps) {
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const popupRef = useRef<Window | null>(null);
	const transactionRef = useRef<string | null>(null);

	const closePopup = useCallback(() => {
		popupRef.current?.close();
		popupRef.current = null;
		transactionRef.current = null;
	}, []);

	useEffect(() => closePopup, [closePopup]);

	useEffect(() => {
		if (!isOpen) {
			closePopup();
			setBusy(false);
			setError(null);
		}
	}, [closePopup, isOpen]);

	useEffect(() => {
		const receiveCallback = (event: MessageEvent) => {
			const transactionId = transactionRef.current;
			const callback = parseCodexOAuthCallback(event, popupRef.current);
			if (!transactionId || !callback) return;

			setBusy(true);
			void routingApi
				.exchangeOAuth("codex", { transactionId, ...callback })
				.then(() => {
					setError(null);
					onComplete?.(0);
				})
				.catch((caughtError) => {
					setError(errorMessage(caughtError));
					onComplete?.(1);
				})
				.finally(() => {
					closePopup();
					setBusy(false);
				});
		};

		window.addEventListener("message", receiveCallback);
		return () => window.removeEventListener("message", receiveCallback);
	}, [closePopup, onComplete]);

	const beginOAuth = async () => {
		if (busy) return;
		setBusy(true);
		setError(null);
		try {
			const session = await startCodexRoutingOAuth({
				startOAuth: routingApi.startOAuth,
				openPopup: (url: string) =>
					window.open(
						url,
						"cloudcli-9router-oauth",
						"popup,width=720,height=760",
					),
			});
			popupRef.current = session.popup;
			transactionRef.current = session.transactionId;
		} catch (caughtError) {
			setError(errorMessage(caughtError));
			onComplete?.(1);
		} finally {
			setBusy(false);
		}
	};

	if (!isOpen) return null;

	return (
		<div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 max-md:items-stretch max-md:justify-stretch">
			<div
				role="dialog"
				aria-modal="true"
				aria-labelledby="codex-login-title"
				className="flex w-full max-w-lg flex-col rounded-lg border border-border bg-background shadow-xl max-md:h-full max-md:max-w-none max-md:rounded-none md:m-4"
			>
				<div className="flex items-center justify-between border-b border-border p-4">
					<h3
						id="codex-login-title"
						className="text-lg font-semibold text-foreground"
					>
						Codex Login
					</h3>
					<button
						type="button"
						onClick={onClose}
						className="text-muted-foreground transition-colors hover:text-foreground"
						aria-label="Close login modal"
					>
						<X className="h-6 w-6" />
					</button>
				</div>

				<div className="space-y-5 p-6">
					{isAuthenticated ? (
						<p role="status" className="sr-only" />
					) : (
						<>
							{error && (
								<div
									role="alert"
									className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
								>
									{error}
								</div>
							)}

							<button
								type="button"
								onClick={() => void beginOAuth()}
								disabled={busy}
								className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
							>
								{busy ? (
									<Loader2
										className="h-4 w-4 animate-spin"
										aria-hidden="true"
									/>
								) : (
									<ExternalLink className="h-4 w-4" aria-hidden="true" />
								)}
								{busy
									? "Connecting…"
									: error
										? "Try OAuth again"
										: "Continue with OAuth"}
							</button>
						</>
					)}
				</div>
			</div>
		</div>
	);
}
