import assert from "node:assert/strict";
import test from "node:test";

import { createInstance } from "i18next";
import React, { createElement } from "react";
import { I18nextProvider } from "react-i18next";
import { renderToStaticMarkup } from "react-dom/server";

import {
	emptyRoutingSettingsView,
	type RoutingAccountView,
} from "../../../../../../shared/routing.js";
import englishSettings from "../../../../../i18n/locales/en/settings.json" with {
	type: "json",
};
import chineseSettings from "../../../../../i18n/locales/zh-CN/settings.json" with {
	type: "json",
};

import ProviderAccountsSection from "./ProviderAccountsSection.js";

(globalThis as typeof globalThis & { React: typeof React }).React = React;

async function renderAccounts(
	options: {
		loading?: boolean;
		detailsError?: boolean;
		hasLoadedDetails?: boolean;
		refreshing?: boolean;
		accounts?: RoutingAccountView[];
		models?: Array<{ id: string; provider: string; name: string }>;
		selectedModel?: string;
		language?: "en" | "zh-CN";
	} = {},
): Promise<string> {
	const settings = emptyRoutingSettingsView();
	settings.runtime.capabilities.readAccounts = true;
	settings.runtime.capabilities.writeApiKeyAccounts = true;
	settings.runtime.capabilities.testAccounts = true;
	const i18n = createInstance();
	await i18n.init({
		lng: options.language ?? "en",
		fallbackLng: "en",
		ns: ["settings"],
		defaultNS: "settings",
		resources: {
			en: { settings: englishSettings },
			"zh-CN": { settings: chineseSettings },
		},
		interpolation: { escapeValue: false },
	});

	return renderToStaticMarkup(
		createElement(
			I18nextProvider,
			{ i18n },
			createElement(ProviderAccountsSection, {
				connectionStatus: "connected",
				capabilities: settings.runtime.capabilities,
				accounts: options.accounts ?? [],
				models: options.models ?? [],
				selectedModel: options.selectedModel ?? "",
				onSelectModel: () => {},
				loading: options.loading ?? false,
				hasLoadedDetails: options.hasLoadedDetails ?? true,
				refreshing: options.refreshing ?? false,
				detailsError: options.detailsError ?? false,
				activeMutation: null,
				onRetry: () => {},
				onUpdateAccount: async () => true,
				onTestAccount: async () => ({
					healthy: true,
					error: null,
					refreshed: false,
				}),
				onDeleteAccount: async () => true,
			}),
		),
	);
}

const codexAccount: RoutingAccountView = {
	id: "codex-1",
	provider: "codex",
	name: "work@example.com",
	authType: "oauth",
	priority: null,
	active: true,
	status: "unknown",
	lastError: null,
	expiresAt: null,
};

const apiKeyAccount: RoutingAccountView = {
	id: "deepseek-1",
	provider: "deepseek",
	name: "Production key",
	authType: "apikey",
	priority: null,
	active: true,
	status: "unknown",
	lastError: null,
	expiresAt: null,
};

test("provider authentication hides OAuth and renders only API-key accounts", async () => {
	const markup = await renderAccounts({
		accounts: [codexAccount, apiKeyAccount],
	});

	assert.equal(markup.includes("Codex OAuth"), false);
	assert.equal(markup.includes("Continue with ChatGPT"), false);
	assert.equal(markup.includes("work@example.com"), false);
	assert.match(markup, /API Key authentication/);
	assert.match(markup, /Production key/);
	assert.match(markup, /Not tested/);
});

test("API-key authentication localizes connected and untested states", async () => {
	const markup = await renderAccounts({
		accounts: [codexAccount, apiKeyAccount],
		language: "zh-CN",
	});

	assert.equal(markup.includes("添加另一个 ChatGPT 账户"), false);
	assert.equal(markup.includes("work@example.com"), false);
	assert.match(markup, /连接状态/);
	assert.match(markup, /已启用/);
	assert.match(markup, /健康状态/);
	assert.match(markup, /认证方式/);
	assert.match(markup, /测试/);
	assert.match(markup, /API Key 认证/);
	assert.match(markup, /未测试/);
});

test("empty account surface exposes only API-key authentication", async () => {
	const markup = await renderAccounts();

	assert.match(markup, /Provider accounts/);
	assert.equal(markup.includes("Codex OAuth"), false);
	assert.equal(markup.includes("Continue with ChatGPT"), false);
	assert.match(markup, /API Key authentication/);
	assert.equal(markup.includes("Popular API keys"), false);
	assert.match(markup, /OpenAI Compatible/);
});

test("agent configuration shows the selected default model", async () => {
	const markup = await renderAccounts({
		models: [
			{ id: "openai/gpt-5", provider: "openai", name: "GPT-5" },
			{ id: "deepseek/chat", provider: "deepseek", name: "DeepSeek Chat" },
		],
		selectedModel: "openai/gpt-5",
	});

	assert.match(markup, /Default model/);
	const chineseMarkup = await renderAccounts({
		models: [{ id: "openai/gpt-5", provider: "openai", name: "GPT-5" }],
		selectedModel: "openai/gpt-5",
		language: "zh-CN",
	});
	assert.match(chineseMarkup, /默认模型/);
	assert.ok(
		markup.includes('<option value="openai/gpt-5" selected="">GPT-5</option>'),
	);
});

test("background refresh keeps cached account content visible", async () => {
	const markup = await renderAccounts({
		accounts: [apiKeyAccount],
		hasLoadedDetails: true,
		refreshing: true,
	});
	assert.match(markup, /Production key/);
	assert.match(markup, /Refreshing provider accounts/);
	assert.match(markup, /aria-busy="true"/);
	assert.equal(
		markup.includes("Loading provider accounts and models..."),
		false,
	);
});

test("background refresh failure keeps cached accounts with an inline retry", async () => {
	const markup = await renderAccounts({
		accounts: [apiKeyAccount],
		hasLoadedDetails: true,
		detailsError: true,
	});
	assert.match(markup, /Production key/);
	assert.match(markup, /Could not load provider accounts and models/);
	assert.match(markup, /Retry/);
});

test("account loading never shows the runtime-ready gate", async () => {
	const markup = await renderAccounts({
		loading: true,
		hasLoadedDetails: false,
	});

	assert.match(markup, /Loading provider accounts and models/);
	assert.equal(
		markup.includes(
			"The built-in Provider Router runtime must be ready before provider accounts can load.",
		),
		false,
	);
});

test("provider detail failures stay inside the account retry surface", async () => {
	const markup = await renderAccounts({ detailsError: true });

	assert.match(markup, /Could not load provider accounts and models/);
	assert.match(markup, /Retry/);
	assert.equal(markup.includes("Provider Router operation failed"), false);
});
