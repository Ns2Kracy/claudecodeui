import assert from "node:assert/strict";
import test from "node:test";

import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import ProviderLoginModal, {
	parseCodexOAuthCallback,
	startCodexRoutingOAuth,
} from "./ProviderLoginModal.js";

(globalThis as typeof globalThis & { React: typeof React }).React = React;

test("Codex login modal starts authorization", async () => {
	const calls: string[] = [];
	const popup = { close() {} } as Window;
	const result = await startCodexRoutingOAuth({
		startOAuth: async (provider) => {
			calls.push(provider);
			return {
				provider,
				transactionId: "transaction-1",
				authUrl: "https://auth.example.test/authorize",
				redirectUri: "http://127.0.0.1/api/routing/oauth/codex/callback",
				expiresAt: "2030-01-01T00:00:00.000Z",
			};
		},
		openPopup: (url) => {
			calls.push(url);
			return popup;
		},
	});

	assert.deepEqual(calls, ["codex", "https://auth.example.test/authorize"]);
	assert.equal(result.popup, popup);
	assert.equal(result.transactionId, "transaction-1");
});

test("Codex routed login rejects unsafe authorization URLs", async () => {
	await assert.rejects(
		() =>
			startCodexRoutingOAuth({
				startOAuth: async () => ({
					provider: "codex",
					transactionId: "transaction-1",
					authUrl: "javascript:alert(1)",
					redirectUri: "http://127.0.0.1/callback",
					expiresAt: "2030-01-01T00:00:00.000Z",
				}),
				openPopup: () => null,
			}),
		Error,
	);
});

test("Codex routed login accepts only its same-origin callback", () => {
	const previousWindow = globalThis.window;
	const popup = {} as Window;
	Object.defineProperty(globalThis, "window", {
		configurable: true,
		value: { location: { origin: "http://127.0.0.1:3001" } },
	});
	try {
		const event = {
			origin: "http://127.0.0.1:3001",
			source: popup,
			data: {
				type: "routing-oauth-callback",
				url: "http://127.0.0.1:3001/api/routing/oauth/codex/callback?state=s&code=c",
			},
		} as MessageEvent;

		assert.deepEqual(parseCodexOAuthCallback(event, popup), {
			state: "s",
			code: "c",
		});
		assert.equal(
			parseCodexOAuthCallback({ ...event, origin: "https://evil.test" }, popup),
			null,
		);
	} finally {
		Object.defineProperty(globalThis, "window", {
			configurable: true,
			value: previousWindow,
		});
	}
});

test("Codex login modal keeps its shell but no longer renders a CLI login command", () => {
	const markup = renderToStaticMarkup(
		createElement(ProviderLoginModal, {
			isOpen: true,
			onClose() {},
			provider: "codex",
		}),
	);

	assert.match(markup, /Codex Login/);
	assert.doesNotMatch(markup, /9Router/);
	assert.match(markup, /Continue with OAuth/);
	assert.equal(markup.includes("codex login"), false);
});
