import assert from "node:assert/strict";
import test from "node:test";

import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import AgentCategoryContentSection from "./sections/AgentCategoryContentSection.js";
import { SETTINGS_AGENTS } from "./agentsSettingsState.js";

(globalThis as typeof globalThis & { React: typeof React }).React = React;

test("agent settings exposes only Codex", () => {
	assert.deepEqual(SETTINGS_AGENTS, ["codex"]);
});

test("Codex account category renders the Provider Router account manager", () => {
	const markup = renderToStaticMarkup(
		createElement(AgentCategoryContentSection, {
			selectedCategory: "account",
			codexPermissionMode: "default",
			onCodexPermissionModeChange: () => {},
			projects: [],
			ProviderAccountsManagerComponent: () =>
				createElement("div", null, "router-account-manager"),
		}),
	);

	assert.match(markup, /router-account-manager/);
	assert.equal(markup.includes("Codex CLI assistant"), false);
});
