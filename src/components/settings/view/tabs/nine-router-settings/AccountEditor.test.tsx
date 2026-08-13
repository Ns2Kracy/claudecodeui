import assert from "node:assert/strict";
import test from "node:test";

import { createInstance } from "i18next";
import React, { createElement } from "react";
import { I18nextProvider } from "react-i18next";
import { renderToStaticMarkup } from "react-dom/server";

import englishSettings from "../../../../../i18n/locales/en/settings.json" with {
	type: "json",
};

import AccountEditor from "./AccountEditor.js";

(globalThis as typeof globalThis & { React: typeof React }).React = React;

async function renderAccountEditor(): Promise<string> {
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
			createElement(AccountEditor, {
				accounts: [
					{
						id: "codex-1",
						provider: "codex",
						name: "work@example.com",
						authType: "oauth",
						priority: null,
						active: true,
						status: "unknown",
						lastError: null,
						expiresAt: null,
					},
					{
						id: "openai-1",
						provider: "openai",
						name: "Production",
						authType: "apikey",
						priority: 1,
						active: true,
						status: "unknown",
						lastError: null,
						expiresAt: null,
					},
				],
				models: [
					{ id: "gpt-a", provider: "codex", name: "GPT A" },
					{ id: "gpt-b", provider: "codex", name: "GPT B" },
					{ id: "gpt-c", provider: "openai", name: "GPT C" },
				],
				canWrite: true,
				canTest: true,
				activeMutation: null,
				onUpdate: async () => true,
				onTest: async () => true,
				onDelete: async () => true,
			}),
		),
	);
}

test("unknown account status uses authentication-specific language", async () => {
	const markup = await renderAccountEditor();

	const oauthStart = markup.indexOf("work@example.com");
	const apiKeyStart = markup.indexOf("Production");
	assert.ok(oauthStart >= 0 && apiKeyStart > oauthStart);
	assert.match(markup.slice(oauthStart, apiKeyStart), /Connected/);
	assert.match(markup.slice(apiKeyStart), /Not tested/);
	assert.equal(markup.includes(">Unknown<"), false);
	assert.match(markup, /2 models/);
	assert.match(markup, /1 model/);
	for (const action of ["Test", "Edit", "Disable", "Delete"])
		assert.match(markup, new RegExp(action));
});
