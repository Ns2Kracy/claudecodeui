export type ManualOAuthCallbackResult =
	| { ok: true; callback: { state: string; code: string } }
	| { ok: false; error: string };

function normalizedLoopbackHost(hostname: string): string | null {
	if (["localhost", "127.0.0.1", "[::1]", "::1"].includes(hostname))
		return "loopback";
	return null;
}

/** Parses a user-pasted OAuth callback without exposing callback secrets in errors. */
export function parseManualProviderOAuthCallback(
	value: string,
	redirectUri: string,
): ManualOAuthCallbackResult {
	let expected: URL;
	let callback: URL;
	try {
		expected = new URL(redirectUri);
		callback = new URL(value.trim());
	} catch {
		return {
			ok: false,
			error: "Paste the full callback URL from your browser.",
		};
	}

	if (callback.searchParams.has("error")) {
		return { ok: false, error: "Authorization was not completed. Try again." };
	}
	if (
		callback.protocol !== "http:" ||
		expected.protocol !== "http:" ||
		!normalizedLoopbackHost(callback.hostname) ||
		!normalizedLoopbackHost(expected.hostname) ||
		expected.port !== "1455" ||
		expected.pathname !== "/auth/callback" ||
		callback.port !== expected.port ||
		callback.pathname !== expected.pathname ||
		callback.username ||
		callback.password
	) {
		return {
			ok: false,
			error: "Paste the localhost callback URL from this sign-in attempt.",
		};
	}

	const state = callback.searchParams.get("state");
	const code = callback.searchParams.get("code");
	return state && code
		? { ok: true, callback: { state, code } }
		: {
				ok: false,
				error: "The callback URL is incomplete. Try signing in again.",
			};
}

export function parseProviderOAuthCallback(
	event: MessageEvent,
	popup: Window | null,
	redirectUri: string,
): { state: string; code: string } | null {
	if (
		event.source !== popup ||
		!event.data ||
		event.data.type !== "routing-oauth-callback" ||
		typeof event.data.url !== "string"
	)
		return null;
	let expected: URL;
	let callback: URL;
	try {
		expected = new URL(redirectUri);
		callback = new URL(event.data.url);
	} catch {
		return null;
	}
	if (
		event.origin !== expected.origin ||
		callback.origin !== expected.origin ||
		callback.pathname !== expected.pathname
	)
		return null;
	const state = callback.searchParams.get("state");
	const code = callback.searchParams.get("code");
	return state && code ? { state, code } : null;
}
