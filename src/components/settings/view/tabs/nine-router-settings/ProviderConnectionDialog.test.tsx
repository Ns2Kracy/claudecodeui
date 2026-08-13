import assert from "node:assert/strict";
import test from "node:test";

import { createInstance } from "i18next";
import React, { createElement, type ReactElement } from "react";
import { I18nextProvider } from "react-i18next";
import { renderToStaticMarkup } from "react-dom/server";

import englishSettings from "../../../../../i18n/locales/en/settings.json" with {
	type: "json",
};

import CustomProviderEditor, {
	validateAndSaveCustomProvider,
	validateCustomProviderDraft,
} from "./CustomProviderEditor.js";
import OAuthDeviceFlow from "./OAuthDeviceFlow.js";
import ProviderConnections from "./ProviderConnections.js";
import { parseProviderOAuthCallback } from "./providerOAuthCallback.js";
import {
	NINE_ROUTER_PROVIDER_PROFILES,
	methodsForProvider,
} from "./ProviderCatalog.js";
import ProviderConnectionDialog, {
	isAllowedOAuthUrl,
} from "./ProviderConnectionDialog.js";

(globalThis as typeof globalThis & { React: typeof React }).React = React;

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

test("provider catalog exposes Codex OAuth, five popular API-key providers, and OpenAI Compatible", () => {
	assert.deepEqual(methodsForProvider("codex"), ["oauth"]);
	assert.deepEqual(
		NINE_ROUTER_PROVIDER_PROFILES.filter(
			(profile) => profile.group === "popular",
		).map((profile) => profile.id),
		["openai", "anthropic", "gemini", "deepseek", "openrouter"],
	);
	assert.deepEqual(methodsForProvider("openai-compatible"), ["custom"]);
	assert.equal(
		NINE_ROUTER_PROVIDER_PROFILES.every(
			(profile) => profile.methods.length > 0 && profile.icon.length > 0,
		),
		true,
	);
});

test("connection chooser prioritizes ChatGPT OAuth and exposes five popular API-key choices", async () => {
	const markup = await render(
		createElement(ProviderConnections, {
			disabled: false,
			onConnected: () => {},
		}),
	);

	assert.match(markup, /Continue with ChatGPT/);
	assert.match(markup, /Connect Codex/);
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

test("OpenAI Compatible keeps endpoint essentials visible and advanced routing fields disclosed", async () => {
	const profile = NINE_ROUTER_PROVIDER_PROFILES.find(
		(item) => item.id === "openai-compatible",
	);
	assert.ok(profile);
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
			onCreateCustomProvider: async () => false,
		}),
	);

	assert.match(markup, /Base URL/);
	assert.match(markup, /API key/);
	assert.match(markup, /Advanced settings/);
	assert.match(markup, /Responses API/);
	assert.match(markup, /Chat Completions/);
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
			onCreateCustomProvider: async () => false,
		}),
	);

	assert.match(markup, /cannot receive this provider’s browser callback/i);
	assert.match(markup, /Use device code instead/);
});

test("custom provider validation runs before save and rejects invalid drafts locally", async () => {
	const invalid = validateCustomProviderDraft({
		name: "",
		prefix: "spaces are invalid",
		type: "openai-compatible",
		apiType: "responses",
		baseUrl: "not-a-url",
		apiKey: "",
		modelId: "",
	});
	assert.ok(invalid.name);
	assert.ok(invalid.prefix);
	assert.ok(invalid.baseUrl);
	assert.ok(invalid.apiKey);

	const calls: string[] = [];
	const saved = await validateAndSaveCustomProvider(
		{
			name: "Internal gateway",
			prefix: "internal",
			type: "openai-compatible",
			apiType: "responses",
			baseUrl: "https://gateway.example.test/v1",
			apiKey: "write-only-key",
			modelId: "",
		},
		{
			validate: async () => {
				calls.push("validate");
				return { valid: true, message: null };
			},
			save: async () => {
				calls.push("save");
				return true;
			},
		},
	);
	assert.equal(saved, true);
	assert.deepEqual(calls, ["validate", "save"]);

	const markup = await render(
		createElement(CustomProviderEditor, {
			busy: false,
			onCreate: async () => false,
		}),
	);
	assert.match(markup, /type="password"/);
	assert.match(markup, /Validate and save/);
});
