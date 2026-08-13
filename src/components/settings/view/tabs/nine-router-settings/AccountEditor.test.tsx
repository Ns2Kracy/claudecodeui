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

const accounts = [
	{
		id: "codex-1",
		provider: "codex",
		name: "work@example.com",
		authType: "oauth",
		priority: null,
		active: true,
		status: "unknown" as const,
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
		status: "healthy" as const,
		lastError: null,
		expiresAt: null,
	},
];

type RenderOptions = {
	activeMutation?: string | null;
	defaultPendingDisableId?: string | null;
	defaultExpandedTestId?: string | null;
	defaultOpenMenuId?: string | null;
	defaultTestResults?: Record<
		string,
		{
			result: { healthy: boolean; error: string | null; refreshed: boolean };
			completedAt: string;
			durationMs: number;
		}
	>;
};

async function renderAccountEditor(
	options: RenderOptions = {},
): Promise<string> {
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
				accounts,
				models: [
					{ id: "gpt-a", provider: "codex", name: "GPT A" },
					{ id: "gpt-b", provider: "codex", name: "GPT B" },
					{ id: "gpt-c", provider: "openai", name: "GPT C" },
				],
				canWrite: true,
				canTest: true,
				activeMutation: options.activeMutation ?? null,
				onUpdate: async () => true,
				onTest: async () => ({
					healthy: true,
					error: null,
					refreshed: false,
				}),
				onDelete: async () => true,
				defaultPendingDisableId: options.defaultPendingDisableId,
				defaultExpandedTestId: options.defaultExpandedTestId,
				defaultOpenMenuId: options.defaultOpenMenuId,
				defaultTestResults: options.defaultTestResults,
			}),
		),
	);
}

test("account facts have explicit labels and secondary actions are not persistent", async () => {
	const markup = await renderAccountEditor();

	const oauthStart = markup.indexOf("work@example.com");
	const apiKeyStart = markup.indexOf("Production");
	assert.ok(oauthStart >= 0 && apiKeyStart > oauthStart);
	assert.match(markup, /Connection status/);
	assert.match(markup, /Health status/);
	assert.match(markup, /Authentication/);
	assert.match(markup.slice(oauthStart, apiKeyStart), /Enabled/);
	assert.match(markup.slice(oauthStart, apiKeyStart), /Not tested/);
	assert.match(markup.slice(oauthStart, apiKeyStart), /OAuth/);
	assert.match(markup.slice(apiKeyStart), /Healthy/);
	assert.match(markup.slice(apiKeyStart), /API key/);
	assert.match(markup, /2 models/);
	assert.match(markup, /1 model/);
	assert.match(markup, />Test</);
	assert.match(markup, /aria-label="Account options for work@example.com"/);
	for (const persistentAction of [">Edit<", ">Disable<", ">Delete<"])
		assert.equal(markup.includes(persistentAction), false);
});

test("secondary actions live inside the account options menu", async () => {
	const markup = await renderAccountEditor({ defaultOpenMenuId: "openai-1" });

	assert.match(markup, /role="menuitemcheckbox"/);
	assert.match(markup, /aria-checked="true"/);
	assert.match(markup, />Account enabled</);
	assert.match(markup, />Edit account</);
	assert.match(markup, />Delete account</);
});

test("testing state is visible on the account-local primary action", async () => {
	const markup = await renderAccountEditor({
		activeMutation: "account:test:codex-1",
	});

	assert.match(markup, />Testing</);
	assert.match(markup, /aria-busy="true"/);
});

test("completed account tests show latency and expandable details", async () => {
	const markup = await renderAccountEditor({
		defaultExpandedTestId: "codex-1",
		defaultTestResults: {
			"codex-1": {
				result: { healthy: true, error: null, refreshed: true },
				completedAt: "2026-08-13T09:30:00.000Z",
				durationMs: 126,
			},
		},
	});

	assert.match(markup, /Test successful · 126 ms/);
	assert.match(markup, /Hide details/);
	assert.match(markup, /Credentials refreshed/);
	assert.match(markup, /2026-08-13T09:30:00.000Z/);
});

test("failed account tests expose the provider error reason", async () => {
	const markup = await renderAccountEditor({
		defaultExpandedTestId: "codex-1",
		defaultTestResults: {
			"codex-1": {
				result: {
					healthy: false,
					error: "OAuth token expired",
					refreshed: false,
				},
				completedAt: "2026-08-13T09:30:00.000Z",
				durationMs: 408,
			},
		},
	});

	assert.match(markup, /Test failed · 408 ms/);
	assert.match(markup, /OAuth token expired/);
	assert.match(markup, /Unhealthy/);
});

test("disabling an account requires an inline impact confirmation", async () => {
	const markup = await renderAccountEditor({
		defaultPendingDisableId: "codex-1",
	});

	assert.match(markup, /Disable work@example.com?/);
	assert.match(
		markup,
		/Models from this account will no longer be used for new requests. Existing sessions are not affected./,
	);
	assert.match(markup, />Confirm disable</);
	assert.match(markup, />Cancel</);
});
