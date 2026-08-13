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
