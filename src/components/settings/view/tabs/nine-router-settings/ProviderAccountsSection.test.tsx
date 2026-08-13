import assert from "node:assert/strict";
import test from "node:test";

import { createInstance } from "i18next";
import React, { createElement } from "react";
import { I18nextProvider } from "react-i18next";
import { renderToStaticMarkup } from "react-dom/server";

import { emptyRoutingSettingsView } from "../../../../../../shared/routing.js";
import englishSettings from "../../../../../i18n/locales/en/settings.json" with {
	type: "json",
};

import ProviderAccountsSection from "./ProviderAccountsSection.js";

(globalThis as typeof globalThis & { React: typeof React }).React = React;

async function renderAccounts(
	options: {
		configured?: boolean;
		loading?: boolean;
		detailsError?: boolean;
	} = {},
): Promise<string> {
	const settings = emptyRoutingSettingsView();
	settings.runtime.capabilities.readAccounts = true;
	settings.runtime.capabilities.writeApiKeyAccounts = true;
	settings.runtime.capabilities.testAccounts = true;
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
		createElement(
			I18nextProvider,
			{ i18n },
			createElement(ProviderAccountsSection, {
				configured: options.configured ?? true,
				connectionStatus: "connected",
				capabilities: settings.runtime.capabilities,
				accounts: [],
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

test("open Codex account surface exposes Provider Router connection methods", async () => {
	const markup = await renderAccounts();

	assert.match(markup, /Provider accounts/);
	assert.equal(markup.includes("Manage provider accounts"), false);
	assert.match(markup, /Connect Codex/);
	assert.match(markup, /Continue with ChatGPT/);
	assert.match(markup, /Popular API keys/);
	assert.match(markup, /OpenAI Compatible/);
	assert.match(markup, /Connected accounts/);
	assert.equal(markup.includes("Add account"), false);
});

test("provider detail failures stay inside the account retry surface", async () => {
	const markup = await renderAccounts({ detailsError: true });

	assert.match(markup, /Could not load provider accounts and models/);
	assert.match(markup, /Retry/);
	assert.equal(markup.includes("Provider Router operation failed"), false);
});
