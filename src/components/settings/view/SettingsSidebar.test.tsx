import assert from "node:assert/strict";
import test from "node:test";

import { createInstance } from "i18next";
import React, { createElement } from "react";
import { I18nextProvider } from "react-i18next";
import { renderToStaticMarkup } from "react-dom/server";

import englishSettings from "../../../i18n/locales/en/settings.json" with {
	type: "json",
};

import SettingsSidebar from "./SettingsSidebar.js";

(globalThis as typeof globalThis & { React: typeof React }).React = React;

test("settings navigation omits removed pages", async () => {
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
			createElement(SettingsSidebar, {
				activeTab: "agents",
				onChange: () => {},
			}),
		),
	);

	assert.equal(markup.includes("Providers"), false);
	assert.equal(markup.includes("About"), false);
});
