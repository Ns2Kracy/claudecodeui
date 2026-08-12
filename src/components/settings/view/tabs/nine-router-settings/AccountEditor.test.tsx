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

test("offers an API-key provider before any account or model exists", async () => {
	const i18n = createInstance();
	await i18n.init({
		lng: "en",
		fallbackLng: "en",
		ns: ["settings"],
		defaultNS: "settings",
		resources: { en: { settings: englishSettings } },
		interpolation: { escapeValue: false },
	});

	const markup = renderToStaticMarkup(
		createElement(
			I18nextProvider,
			{ i18n },
			createElement(AccountEditor, {
				accounts: [],
				models: [],
				canWrite: true,
				canTest: true,
				activeMutation: null,
				draft: { provider: "", name: "", apiKey: "", active: true },
				onDraftFieldChange: () => {},
				onCreate: async () => true,
				onUpdate: async () => true,
				onTest: async () => true,
				onDelete: async () => true,
				defaultAdding: true,
			}),
		),
	);

	assert.match(markup, /<option value="openai">openai<\/option>/);
	assert.equal(markup.includes("No provider catalog is available"), false);
});
