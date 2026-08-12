import assert from "node:assert/strict";
import test from "node:test";

import { createInstance } from "i18next";
import React, { createElement } from "react";
import { I18nextProvider } from "react-i18next";
import { renderToStaticMarkup } from "react-dom/server";

import {
	emptyRoutingSettingsView,
	type RoutingSettingsView,
} from "../../../../../../shared/routing.js";
import englishSettings from "../../../../../i18n/locales/en/settings.json" with {
	type: "json",
};

import {
	NineRouterSettingsTabView,
	isNineRouterRuntimeReady,
} from "./NineRouterSettingsTab.js";
import UpstreamsRoutesSection from "./UpstreamsRoutesSection.js";
import type { RoutingErrorContext } from "./routingState.js";

// npm test compiles TSX with the server's classic JSX transform. Some shared
// settings components use the browser's automatic transform and need this
// runtime binding when rendered through react-dom/server.
(globalThis as typeof globalThis & { React: typeof React }).React = React;

async function renderRoutingView(
	settings: RoutingSettingsView,
	options: {
		error?: {
			code: string;
			message: string;
			status: number;
			retryable: boolean;
		} | null;
		routesError?: boolean;
		upstreamDetailsError?: boolean;
		errorContext?: RoutingErrorContext | null;
		activeMutation?: string | null;
		codexApplied?: boolean;
	} = {},
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
			createElement(NineRouterSettingsTabView, {
				settings,
				loading: false,
				error: options.error ?? null,
				errorContext: options.errorContext,
				activeMutation: options.activeMutation ?? null,
				codexApplied: options.codexApplied ?? false,
				onApplyToCodex: async () => true,
				routesError: options.routesError,
				upstreamDetailsError: options.upstreamDetailsError,
				onRetryRoutes: () => {},
				accountDraft: { provider: "", name: "", apiKey: "", active: true },
				onAccountFieldChange: () => {},
				onExpandUpstreamDetails: () => {},
				onRetryUpstreamDetails: () => {},
				onCreateAccount: async () => true,
				onUpdateAccount: async () => true,
				onTestAccount: async () => true,
				onDeleteAccount: async () => true,
				onCreateRoute: async () => true,
				onUpdateRoute: async () => true,
				onDeleteRoute: async () => true,
			}),
		),
	);
}

test("first render shows router-safe terminology and no obsolete controls", async () => {
	const settings = emptyRoutingSettingsView();
	const markup = await renderRoutingView(settings);

	assert.match(markup, /Provider Router/);
	assert.equal(/9Router/i.test(markup), false);
	assert.equal(markup.includes("Restart runtime"), false);
	assert.equal(markup.includes("Endpoint"), false);
	assert.equal(markup.includes("Admin password"), false);
	assert.equal(markup.includes("Data-plane API key"), false);
	assert.equal(markup.includes("Test and connect"), false);
	assert.equal(markup.includes("Disconnect"), false);
	assert.equal(markup.includes("write-only"), false);
});

test("ready runtime enables provider and route details without source or usage UI", async () => {
	const settings = emptyRoutingSettingsView();
	settings.runtime = {
		...settings.runtime,
		status: "ready",
		version: "0.5.45",
		capabilities: {
			readAccounts: true,
			writeApiKeyAccounts: true,
			testAccounts: true,
			readRoutes: true,
			writeRoutes: true,
			readUsage: false,
			claudeRuntime: true,
			codexRuntime: true,
			openCodeRuntime: true,
			cursorRuntime: false,
		},
	};
	settings.routes = [
		{ id: "route-1", name: "quality-first", kind: null, models: ["model-a"] },
	];
	const markup = await renderRoutingView(settings);

	assert.equal(markup.includes("never-render-admin"), false);
	assert.equal(markup.includes("never-render-key"), false);
	assert.equal(/9Router/i.test(markup), false);
	assert.match(markup, /Upstreams and routes/);
	assert.equal(markup.includes("Native login"), false);
	assert.equal(markup.includes("Usage &amp; limits"), false);
	assert.equal(markup.includes("Advisory alerts"), false);
	assert.equal(markup.includes("Model source"), false);
	assert.equal(markup.includes('role="tablist"'), false);
});

test("Codex provider action reflects runtime, pending, and success states", async () => {
	const offline = emptyRoutingSettingsView();
	const offlineMarkup = await renderRoutingView(offline);
	const offlineButton = offlineMarkup.match(
		/<button[^>]*>Apply to Codex<\/button>/,
	)?.[0];
	assert.ok(offlineButton);
	assert.match(offlineButton, /\sdisabled(?:=|>)/);
	assert.match(
		offlineMarkup,
		/current Codex provider and model stay unchanged/,
	);

	const ready = emptyRoutingSettingsView();
	ready.runtime.status = "ready";
	const readyMarkup = await renderRoutingView(ready);
	assert.match(readyMarkup, /Apply to Codex/);
	const applyButton = readyMarkup.match(
		/<button[^>]*>Apply to Codex<\/button>/,
	)?.[0];
	assert.ok(applyButton);
	assert.equal(/\sdisabled(?:=|>)/.test(applyButton), false);

	const pendingMarkup = await renderRoutingView(ready, {
		activeMutation: "codex:apply",
	});
	const pendingButton = pendingMarkup.match(
		/<button[^>]*>[^]*Applying to Codex[^]*<\/button>/,
	)?.[0];
	assert.ok(pendingButton);
	assert.match(pendingButton, /\sdisabled(?:=|>)/);
	assert.match(pendingButton, /lucide-loader-circle/);

	const successMarkup = await renderRoutingView(ready, { codexApplied: true });
	assert.match(successMarkup, /role="status"/);
	assert.match(successMarkup, /Custom is available in Codex/);
});

test("renders unavailable, unauthorized, and incompatible runtime states inline", async () => {
	const unavailable = emptyRoutingSettingsView();
	unavailable.runtime = {
		...unavailable.runtime,
		status: "unavailable",
		lastError: {
			code: "ROUTING_RUNTIME_UNAVAILABLE",
			message: "Runtime failed",
			retryable: true,
		},
	};

	const unauthorized = emptyRoutingSettingsView();
	unauthorized.runtime.status = "ready";
	const incompatible = emptyRoutingSettingsView();
	incompatible.runtime = {
		...incompatible.runtime,
		status: "degraded",
		version: "99.0.0",
		lastError: {
			code: "ROUTING_VERSION_UNSUPPORTED",
			message: "Unsupported",
			retryable: false,
		},
	};

	const markup = [
		await renderRoutingView(unavailable),
		await renderRoutingView(unauthorized, {
			error: {
				code: "ROUTING_UNAUTHORIZED",
				message: "Unauthorized",
				status: 401,
				retryable: false,
			},
		}),
		await renderRoutingView(incompatible),
	].join("\n");

	assert.match(markup, /Provider Router runtime is unavailable/);
	assert.match(markup, /Provider Router credentials were rejected/);
	assert.match(
		markup,
		/This Provider Router version has limited compatibility/,
	);
});

test("degraded runtime does not render ready-only detail controls", async () => {
	const settings = emptyRoutingSettingsView();
	settings.runtime = {
		...settings.runtime,
		status: "degraded",
		version: "0.5.45",
		capabilities: {
			readAccounts: true,
			writeApiKeyAccounts: true,
			testAccounts: true,
			readRoutes: true,
			writeRoutes: true,
			readUsage: false,
			claudeRuntime: true,
			codexRuntime: true,
			openCodeRuntime: true,
			cursorRuntime: false,
		},
		lastError: {
			code: "ROUTING_PROCESS_FAILED",
			message: "Runtime health check failed",
			retryable: true,
		},
	};
	settings.routes = [
		{ id: "route-1", name: "quality-first", kind: null, models: ["model-a"] },
	];

	const markup = await renderRoutingView(settings);

	assert.equal(/9Router/i.test(markup), false);
	assert.equal(markup.includes("Runtime health check failed"), false);
	assert.equal(markup.includes("Advisory alerts"), false);
	assert.equal(markup.includes("Create API-key account"), false);
	assert.equal(markup.includes("Create route"), false);
});

test("open provider connection section uses localized Provider Router method copy", async () => {
	const settings = emptyRoutingSettingsView();
	settings.runtime = {
		...settings.runtime,
		status: "ready",
		capabilities: {
			...settings.runtime.capabilities,
			readAccounts: true,
			writeApiKeyAccounts: true,
			testAccounts: true,
			readRoutes: true,
			writeRoutes: true,
		},
	};

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
			createElement(UpstreamsRoutesSection, {
				configured: true,
				connectionStatus: "connected",
				capabilities: settings.runtime.capabilities,
				accountSummary: settings.accountSummary,
				routeSummary: settings.routeSummary,
				accounts: [],
				models: [],
				routes: [],
				loading: false,
				detailsError: false,
				activeMutation: null,
				accountDraft: { provider: "", name: "", apiKey: "", active: true },
				onAccountFieldChange: () => {},
				onExpand: () => {},
				onRetry: () => {},
				onCreateAccount: async () => true,
				onUpdateAccount: async () => true,
				onTestAccount: async () => true,
				onDeleteAccount: async () => true,
				onCreateRoute: async () => true,
				onUpdateRoute: async () => true,
				onDeleteRoute: async () => true,
				defaultOpen: true,
			}),
		),
	);

	assert.match(markup, /Connect a provider/);
	assert.match(
		markup,
		/Choose a method supported by the Provider Router runtime/,
	);
	assert.equal(/9Router/i.test(markup), false);
});

test("degraded runtime is not eligible for automatic account or route detail reads", () => {
	const settings = emptyRoutingSettingsView();
	settings.runtime = {
		...settings.runtime,
		status: "degraded",
		capabilities: {
			...settings.runtime.capabilities,
			readAccounts: true,
			readRoutes: true,
			readUsage: false,
		},
	};

	assert.equal(isNineRouterRuntimeReady(settings), false);

	settings.runtime.status = "ready";
	assert.equal(isNineRouterRuntimeReady(settings), true);
});

test("route loading failures are scoped away from obsolete operation alerts", async () => {
	const settings = emptyRoutingSettingsView();
	settings.runtime = {
		...settings.runtime,
		status: "ready",
		capabilities: { ...settings.runtime.capabilities, readRoutes: true },
	};

	const markup = await renderRoutingView(settings, {
		routesError: true,
		upstreamDetailsError: true,
		errorContext: "details",
		error: {
			code: "ROUTING_ROUTES_FAILED",
			message: "Could not load route details",
			status: 502,
			retryable: true,
		},
	});

	assert.equal(markup.includes("9Router operation failed"), false);
	assert.equal(markup.includes("Could not load route details"), false);
	assert.equal(markup.includes("Create a route in 9Router"), false);
});
