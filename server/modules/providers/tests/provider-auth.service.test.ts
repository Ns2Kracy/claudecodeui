import assert from "node:assert/strict";
import test from "node:test";

import { createProviderAuthService } from "@/modules/providers/services/provider-auth.service.js";
import type { RoutingAccountView } from "../../../../shared/routing.js";

const account = (
	overrides: Partial<RoutingAccountView> = {},
): RoutingAccountView => ({
	id: "account-1",
	provider: "codex",
	name: "OpenAI Account",
	authType: "oauth",
	priority: null,
	active: true,
	status: "healthy",
	lastError: null,
	expiresAt: null,
	...overrides,
});

test("Codex auth status comes from usable 9Router accounts", async () => {
	const service = createProviderAuthService({
		listRoutingAccounts: async () => [
			account({ provider: "anthropic" }),
			account({ id: "account-2", provider: "openai", name: "Work OpenAI" }),
		],
		getCodexInstallationStatus: async () => true,
	});

	assert.deepEqual(await service.getProviderAuthStatus("codex"), {
		installed: true,
		provider: "codex",
		authenticated: true,
		email: "Work OpenAI",
		method: "9router:oauth",
	});
});

test("inactive and failed routed accounts do not authenticate Codex", async () => {
	const service = createProviderAuthService({
		listRoutingAccounts: async () => [
			account({ active: false }),
			account({ provider: "openai", status: "failed" }),
		],
		getCodexInstallationStatus: async () => true,
	});

	assert.deepEqual(await service.getProviderAuthStatus("codex"), {
		installed: true,
		provider: "codex",
		authenticated: false,
		email: null,
		method: null,
	});
});

test("routing failure fails Codex authentication closed", async () => {
	const service = createProviderAuthService({
		listRoutingAccounts: async () => {
			throw new Error("sidecar unavailable");
		},
		getCodexInstallationStatus: async () => true,
	});

	assert.deepEqual(await service.getProviderAuthStatus("codex"), {
		installed: true,
		provider: "codex",
		authenticated: false,
		email: null,
		method: null,
	});
});
