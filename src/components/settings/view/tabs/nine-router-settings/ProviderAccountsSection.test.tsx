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
		configured?: boolean;
		loading?: boolean;
		detailsError?: boolean;
		accounts?: RoutingAccountView[];
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
				configured: options.configured ?? true,
				connectionStatus: "connected",
				capabilities: settings.runtime.capabilities,
				accounts: options.accounts ?? [],
				models: [],
				loading: options.loading ?? false,
				detailsError: options.detailsError ?? false,
				activeMutation: null,
				onRetry: () => {},
				onUpdateAccount: async () => true,
				onTestAccount: async () => true,
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

test("provider authentication renders OAuth and API keys in separate cards", async () => {
	const markup = await renderAccounts({
		accounts: [codexAccount, apiKeyAccount],
	});

	const oauthStart = markup.indexOf("Codex OAuth");
	const apiKeyStart = markup.indexOf("API Key authentication");
	assert.ok(oauthStart >= 0 && apiKeyStart > oauthStart);
	const oauthCard = markup.slice(oauthStart, apiKeyStart);
	const apiKeyCard = markup.slice(apiKeyStart);
	assert.match(oauthCard, /work@example\.com/);
	assert.equal(oauthCard.includes("Production key"), false);
	assert.match(oauthCard, /Connected/);
	assert.match(oauthCard, /Add another ChatGPT account/);
	assert.match(apiKeyCard, /Production key/);
	assert.equal(apiKeyCard.includes("work@example.com"), false);
	assert.match(apiKeyCard, /Not tested/);
});

test("authentication sections localize connected and untested states", async () => {
	const markup = await renderAccounts({
		accounts: [codexAccount, apiKeyAccount],
		language: "zh-CN",
	});

	assert.match(markup, /已连接/);
	assert.match(markup, /添加另一个 ChatGPT 账户/);
	assert.match(markup, /API Key 认证/);
	assert.match(markup, /未测试/);
});

test("empty account surface exposes both Provider Router connection methods", async () => {
	const markup = await renderAccounts();

	assert.match(markup, /Provider accounts/);
	assert.match(markup, /Codex OAuth/);
	assert.match(markup, /Continue with ChatGPT/);
	assert.match(markup, /API Key authentication/);
	assert.equal(markup.includes("Popular API keys"), false);
	assert.match(markup, /OpenAI Compatible/);
});

test("provider detail failures stay inside the account retry surface", async () => {
	const markup = await renderAccounts({ detailsError: true });

	assert.match(markup, /Could not load provider accounts and models/);
	assert.match(markup, /Retry/);
	assert.equal(markup.includes("Provider Router operation failed"), false);
});
