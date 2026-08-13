import assert from "node:assert/strict";
import test from "node:test";

import { createInstance } from "i18next";
import React, { createElement, type ReactElement } from "react";
import { I18nextProvider } from "react-i18next";
import { renderToStaticMarkup } from "react-dom/server";

import englishSettings from "../../../../../i18n/locales/en/settings.json" with {
	type: "json",
};

import ApiKeyProviderEditor from "./ApiKeyProviderEditor.js";
import {
	connectApiKeyProvider,
	draftForApiKeyProfile,
	validateApiKeyProviderDraft,
} from "./apiKeyProvider.js";
import OAuthDeviceFlow from "./OAuthDeviceFlow.js";
import ProviderConnections from "./ProviderConnections.js";
import ProviderIcon from "./ProviderIcon.js";
import { parseProviderOAuthCallback } from "./providerOAuthCallback.js";
import {
	NINE_ROUTER_PROVIDER_PROFILES,
	methodsForProvider,
} from "./ProviderCatalog.js";
import ProviderConnectionDialog, {
	isAllowedOAuthUrl,
} from "./ProviderConnectionDialog.js";

(globalThis as typeof globalThis & { React: typeof React }).React = React;

function accountView(provider: string, name: string) {
	return {
		id: "account-1",
		provider,
		name,
		authType: "apikey",
		priority: null,
		active: true,
		status: "unknown" as const,
		lastError: null,
		expiresAt: null,
	};
}

async function render(element: ReactElement): Promise<string> {
	const i18n = createInstance();
	await i18n.init({
		lng: "en",
		fallbackLng: "en",
		ns: ["settings"],
		defaultNS: "settings",
		resources: { en: { settings: englishSettings } },
		interpolation: { escapeValue: false },
	});
	return renderToStaticMarkup(
		createElement(I18nextProvider, { i18n }, element),
	);
}

test("provider catalog separates Codex OAuth from six peer API-key providers", () => {
	assert.deepEqual(methodsForProvider("codex"), ["oauth"]);
	const apiKeyProfiles = NINE_ROUTER_PROVIDER_PROFILES.filter(
		(profile) => profile.group === "api_key",
	);
	assert.deepEqual(
		apiKeyProfiles.map((profile) => profile.id),
		[
			"openai",
			"anthropic",
			"gemini",
			"deepseek",
			"openrouter",
			"openai-compatible",
		],
	);
	assert.equal(
		apiKeyProfiles.every(
			(profile) =>
				profile.methods.includes("api_key") &&
				typeof profile.defaultBaseUrl === "string",
		),
		true,
	);
});

test("connection chooser prioritizes ChatGPT OAuth and exposes one peer API-key group", async () => {
	const markup = await render(
		createElement(ProviderConnections, {
			disabled: false,
			onConnected: () => {},
		}),
	);

	assert.match(markup, /Continue with ChatGPT/);
	assert.match(markup, /Codex OAuth/);
	assert.match(markup, /API Key authentication/);
	assert.equal(markup.includes("Popular API keys"), false);
	for (const provider of [
		"OpenAI",
		"Anthropic",
		"Google Gemini",
		"DeepSeek",
		"OpenRouter",
	]) {
		assert.match(markup, new RegExp(provider));
	}
	assert.match(markup, /OpenAI Compatible/);
	assert.match(markup, /aria-label="Codex"/);
});

test("API-key profiles expose editable Base URL and endpoint essentials", async () => {
	const profile = NINE_ROUTER_PROVIDER_PROFILES.find(
		(item) => item.id === "openai",
	);
	assert.ok(profile);
	const draft = draftForApiKeyProfile(profile);
	assert.equal(draft.baseUrl, "https://api.openai.com/v1");
	assert.equal(draft.name, "OpenAI");

	const markup = await render(
		createElement(ProviderConnectionDialog, {
			profile,
			busy: false,
			error: null,
			deviceChallenge: null,
			deviceStatus: "idle",
			onConnectApiKey: async () => false,
			onStartOAuth: async () => false,
			onStartDeviceCode: async () => false,
			onCancelDeviceCode: async () => {},
		}),
	);

	assert.match(markup, /Base URL/);
	assert.equal(markup.includes("https://api.openai.com/v1"), true);
	assert.match(markup, /API key/);
});

test("provider identities render local brand SVG assets instead of letter avatars", async () => {
	for (const icon of [
		"openai",
		"anthropic",
		"gemini",
		"deepseek",
		"openrouter",
	] as const) {
		const markup = await render(
			createElement(ProviderIcon, { icon, label: icon }),
		);
		assert.match(markup, new RegExp(`/icons/providers/${icon}\\.svg`));
		assert.equal(/>AI<|>DS<|>OR<|>A<|>G</.test(markup), false);
	}
});

test("Codex OAuth callback accepts only the started localhost redirect and popup source", () => {
	const popup = {} as Window;
	const accepted = parseProviderOAuthCallback(
		{
			origin: "http://127.0.0.1:1455",
			source: popup,
			data: {
				type: "routing-oauth-callback",
				url: "http://127.0.0.1:1455/auth/callback?state=s&code=c",
			},
		} as MessageEvent,
		popup,
		"http://127.0.0.1:1455/auth/callback",
	);
	assert.deepEqual(accepted, { state: "s", code: "c" });
	assert.equal(
		parseProviderOAuthCallback(
			{
				origin: "http://127.0.0.1:1455",
				source: {},
				data: {
					type: "routing-oauth-callback",
					url: "http://127.0.0.1:1455/auth/callback?state=s&code=c",
				},
			} as MessageEvent,
			popup,
			"http://127.0.0.1:1455/auth/callback",
		),
		null,
	);
	assert.equal(
		parseProviderOAuthCallback(
			{
				origin: "http://127.0.0.1:3001",
				source: popup,
				data: {
					type: "routing-oauth-callback",
					url: "http://127.0.0.1:3001/api/routing/oauth/codex/callback?state=s&code=c",
				},
			} as MessageEvent,
			popup,
			"http://127.0.0.1:1455/auth/callback",
		),
		null,
	);
});

test("OAuth launch allowlist accepts HTTPS and loopback HTTP only", () => {
	assert.equal(
		isAllowedOAuthUrl("https://accounts.example.test/authorize"),
		true,
	);
	assert.equal(isAllowedOAuthUrl("http://127.0.0.1:1455/authorize"), true);
	assert.equal(isAllowedOAuthUrl("http://localhost:1455/authorize"), true);
	assert.equal(
		isAllowedOAuthUrl("http://accounts.example.test/authorize"),
		false,
	);
	assert.equal(isAllowedOAuthUrl("javascript:alert(1)"), false);
	assert.equal(
		isAllowedOAuthUrl("https://user:password@example.test/authorize"),
		false,
	);
});

test("device flow renders verification, code, expiry, pending, cancellation, and success states", async () => {
	const challenge = {
		provider: "github",
		transactionId: "transaction",
		userCode: "ABCD-EFGH",
		verificationUri: "https://github.com/login/device",
		verificationUriComplete: null,
		expiresAt: "2030-01-02T03:04:05.000Z",
		interval: 5,
	};
	const pending = await render(
		createElement(OAuthDeviceFlow, {
			challenge,
			status: "pending",
			onCancel: () => {},
		}),
	);
	assert.match(pending, /github\.com\/login\/device/);
	assert.match(pending, /ABCD-EFGH/);
	assert.match(pending, /Expires/);
	assert.match(pending, /Waiting for authorization/);
	assert.match(pending, />Cancel</);

	const success = await render(
		createElement(OAuthDeviceFlow, {
			challenge,
			status: "success",
			onCancel: () => {},
		}),
	);
	assert.match(success, /Provider connected/);
	assert.equal(success.includes("ABCD-EFGH"), false);
});

test("topology errors explain the problem and offer a device-code alternative when supported", async () => {
	const markup = await render(
		createElement(ProviderConnectionDialog, {
			profile: {
				id: "example",
				name: "Example",
				description: "Example provider",
				group: "oauth",
				icon: "openai",
				methods: ["oauth", "device_code"],
			},
			busy: false,
			error: {
				code: "ROUTING_OAUTH_TOPOLOGY_UNSUPPORTED",
				message: "Browser callback unavailable",
				status: 409,
				retryable: false,
			},
			deviceChallenge: null,
			deviceStatus: "idle",
			onConnectApiKey: async () => false,
			onStartOAuth: async () => false,
			onStartDeviceCode: async () => false,
			onCancelDeviceCode: async () => {},
		}),
	);

	assert.match(markup, /cannot receive this provider’s browser callback/i);
	assert.match(markup, /Use device code instead/);
});

test("API-key draft validation rejects invalid values locally", async () => {
	const compatible = NINE_ROUTER_PROVIDER_PROFILES.find(
		(profile) => profile.id === "openai-compatible",
	);
	assert.ok(compatible);
	const invalid = validateApiKeyProviderDraft({
		...draftForApiKeyProfile(compatible),
		name: "",
		prefix: "spaces are invalid",
		baseUrl: "not-a-url",
		apiKey: "",
	});
	assert.ok(invalid.name);
	assert.ok(invalid.prefix);
	assert.ok(invalid.baseUrl);
	assert.ok(invalid.apiKey);

	const markup = await render(
		createElement(ApiKeyProviderEditor, {
			profile: compatible,
			busy: false,
			onConnect: async () => false,
		}),
	);
	assert.match(markup, /type="password"/);
	assert.match(markup, /Validate and connect/);
	assert.match(markup, /Advanced settings/);
});

test("preset endpoints create native provider accounts without provider nodes", async () => {
	const profile = NINE_ROUTER_PROVIDER_PROFILES.find(
		(item) => item.id === "openai",
	);
	assert.ok(profile);
	const calls: Array<[string, unknown]> = [];
	await connectApiKeyProvider(
		{
			validateProviderNode: async (input) => {
				calls.push(["validate", input]);
				return { valid: true, message: null };
			},
			createProviderNode: async (input) => {
				calls.push(["node", input]);
				throw new Error("unexpected provider-node creation");
			},
			createAccount: async (input) => {
				calls.push(["account", input]);
				return accountView(input.provider, input.name);
			},
		},
		profile,
		{ ...draftForApiKeyProfile(profile), apiKey: "write-only-key" },
	);
	assert.deepEqual(calls, [
		[
			"account",
			{ provider: "openai", name: "OpenAI", apiKey: "write-only-key" },
		],
	]);
});

test("edited endpoints validate and create a provider node before its account", async () => {
	const profile = NINE_ROUTER_PROVIDER_PROFILES.find(
		(item) => item.id === "deepseek",
	);
	assert.ok(profile);
	const calls: Array<[string, unknown]> = [];
	await connectApiKeyProvider(
		{
			validateProviderNode: async (input) => {
				calls.push(["validate", input]);
				return { valid: true, message: null };
			},
			createProviderNode: async (input) => {
				calls.push(["node", input]);
				return {
					id: "openai-compatible-chat-node-1",
					type: input.type,
					name: input.name,
					prefix: input.prefix,
					baseUrl: input.baseUrl ?? "https://gateway.example.test/v1",
					apiType:
						input.type === "openai-compatible"
							? (input.apiType ?? "chat")
							: null,
					createdAt: null,
					updatedAt: null,
				};
			},
			createAccount: async (input) => {
				calls.push(["account", input]);
				return accountView(input.provider, input.name);
			},
		},
		profile,
		{
			...draftForApiKeyProfile(profile),
			baseUrl: "https://gateway.example.test/v1",
			apiKey: "write-only-key",
		},
	);
	assert.deepEqual(
		calls.map(([operation]) => operation),
		["validate", "node", "account"],
	);
	assert.deepEqual(calls[0]?.[1], {
		baseUrl: "https://gateway.example.test/v1",
		apiKey: "write-only-key",
		type: "openai-compatible",
	});
	assert.equal((calls[1]?.[1] as { apiKey?: string }).apiKey, undefined);
	assert.deepEqual(calls[2]?.[1], {
		provider: "openai-compatible-chat-node-1",
		name: "DeepSeek",
		apiKey: "write-only-key",
	});
});
