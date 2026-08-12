import assert from "node:assert/strict";
import test from "node:test";

import { emptyRoutingSettingsView } from "../../../../shared/routing.js";
import { createRoutingService } from "../routing.service.js";

function createHarness(
	state: "ready" | "unavailable" = "ready",
	origin = "http://127.0.0.1:20128",
) {
	const calls: string[] = [];
	const codexInputs: Array<{ baseUrl: string; apiKey: string }> = [];
	const client = {
		validateConnection: async () => {
			throw new Error("unused");
		},
		listModels: async () => [{ id: "m1", provider: "openai", name: "M1" }],
		getProvider: async (id: string) => ({
			id,
			provider: "openai",
			name: "Primary",
			authType: "oauth",
			priority: null,
			active: true,
			status: "healthy" as const,
			lastError: null,
			expiresAt: null,
		}),
		listProviderModels: async (id: string) => ({
			provider: "openai",
			connectionId: id,
			models: [{ id: "openai/gpt-4o", provider: "openai", name: "GPT-4o" }],
		}),
		startOAuth: async () => ({
			provider: "codex",
			authUrl: "https://example.test/auth",
			state: "state",
			redirectUri: "http://localhost/callback",
			codeVerifier: "verifier",
		}),
		exchangeOAuth: async () => ({
			id: "a3",
			provider: "codex",
			name: "Codex",
			authType: "oauth",
			priority: null,
			active: true,
			status: "healthy" as const,
			lastError: null,
			expiresAt: null,
		}),
		startDeviceCode: async () => ({
			provider: "codex",
			deviceCode: "device",
			codeVerifier: "verifier",
			userCode: "ABCD",
			verificationUri: "https://example.test/device",
			verificationUriComplete: null,
			expiresIn: null,
			interval: null,
		}),
		pollDeviceCode: async () => ({
			provider: "codex",
			pending: true,
			account: null,
		}),
		listProviderNodes: async () => [
			{
				id: "node1",
				type: "openai-compatible" as const,
				name: "Local",
				prefix: "openai",
				baseUrl: "https://node.test",
				apiType: "chat" as const,
				createdAt: null,
				updatedAt: null,
			},
		],
		createProviderNode: async (input: any) => ({
			id: "node2",
			type: input.type,
			name: input.name,
			prefix: input.prefix,
			baseUrl: input.baseUrl ?? "https://node.test",
			apiType: input.apiType ?? null,
			createdAt: null,
			updatedAt: null,
		}),
		validateProviderNode: async () => ({ valid: true, message: null }),
		updateProviderNode: async (id: string, input: any) => ({
			id,
			type: "openai-compatible" as const,
			name: input.name,
			prefix: input.prefix,
			baseUrl: input.baseUrl,
			apiType: input.apiType ?? null,
			createdAt: null,
			updatedAt: null,
		}),
		deleteProviderNode: async () => undefined,
		listAccounts: async () => [
			{
				id: "a1",
				provider: "openai",
				name: "Primary",
				authType: "apikey",
				priority: 1,
				active: true,
				status: "healthy" as const,
				lastError: null,
				expiresAt: null,
			},
		],
		createApiKeyAccount: async (input: any) => ({
			id: "a2",
			provider: input.provider,
			name: input.name,
			authType: "apikey",
			priority: input.priority ?? null,
			active: input.active ?? true,
			status: "unknown" as const,
			lastError: null,
			expiresAt: null,
		}),
		updateAccount: async (id: string) => ({
			id,
			provider: "openai",
			name: "Updated",
			authType: "apikey",
			priority: null,
			active: true,
			status: "healthy" as const,
			lastError: null,
			expiresAt: null,
		}),
		deleteAccount: async () => undefined,
		testAccount: async () => ({ healthy: true, error: null, refreshed: false }),
	};
	const runtime = {
		getStatus: () => ({
			state,
			origin,
			version: "0.5.45",
			lastError:
				state === "ready"
					? null
					: {
							code: "ROUTING_STARTUP_TIMEOUT" as const,
							message: "startup timed out",
							retryable: true,
						},
		}),
		getInternalCredentials: () => ({
			jwtSecret: "jwt",
			initialPassword: "admin",
			apiKeySecret: "hmac-secret",
			dataPlaneKey: "sk-cloudcli-abc123-deadbeef",
			machineIdSalt: "salt",
			dataDir: "/db/9router",
		}),
	};
	const service = createRoutingService({
		runtime,
		clientFactory: () => {
			calls.push("client");
			return client;
		},
		codexConfig: {
			applyCustomProvider: async (input) => {
				codexInputs.push(input);
				return { provider: "Custom" as const };
			},
		},
		now: () => new Date("2026-08-04T00:00:00.000Z"),
	});
	return { service, calls, codexInputs };
}

test("settings report sidecar runtime without connection storage", async () => {
	const { service, calls } = createHarness("ready");
	const settings = await service.getSettings(7, {
		accounts: true,
		models: true,
	});
	assert.equal(settings.runtime.mode, "sidecar");
	assert.equal(settings.runtime.status, "ready");
	assert.equal(settings.runtime.version, "0.5.45");
	assert.equal("connection" in settings, false);
	assert.equal(settings.accounts?.length, 1);
	assert.equal(settings.models?.length, 1);
	assert.deepEqual(settings.runtime.capabilities.cursorRuntime, false);
	assert.equal(calls.includes("client"), true);
});

test("unavailable embedded runtime is safe and typed for explicit 9router operations", async () => {
	const { service } = createHarness("unavailable");
	const settings = await service.getSettings(7, { accounts: true });
	assert.equal(settings.runtime.status, "unavailable");
	assert.deepEqual(
		settings.runtime.capabilities,
		emptyRoutingSettingsView().runtime.capabilities,
	);
	await assert.rejects(
		() => service.listAccounts(7),
		(error: any) =>
			error.code === "ROUTING_RUNTIME_UNAVAILABLE" && error.statusCode === 409,
	);
});

test("applies ready sidecar credentials to Codex without returning secrets", async () => {
	const { service, codexInputs } = createHarness("ready");
	const result = await service.applyToCodex(7);
	assert.deepEqual(result, { provider: "Custom" });
	assert.deepEqual(codexInputs, [
		{
			baseUrl: "http://127.0.0.1:20128/api/v1",
			apiKey: "sk-cloudcli-abc123-deadbeef",
		},
	]);
	assert.equal(JSON.stringify(result).includes("sk-cloudcli"), false);
});

test("does not write Codex config while the sidecar is unavailable", async () => {
	const { service, codexInputs } = createHarness("unavailable");
	await assert.rejects(
		() => service.applyToCodex(7),
		(error: any) =>
			error.code === "ROUTING_RUNTIME_UNAVAILABLE" && error.statusCode === 409,
	);
	assert.deepEqual(codexInputs, []);
});

test("does not invent a Codex endpoint when a ready runtime has no origin", async () => {
	const { service, codexInputs } = createHarness("ready", "");
	await assert.rejects(
		() => service.applyToCodex(7),
		(error: any) =>
			error.code === "ROUTING_CONFIGURATION_INVALID" &&
			error.statusCode === 500,
	);
	assert.deepEqual(codexInputs, []);
});

test("provider management workflows delegate through sanitized 9router client contract", async () => {
	const { service } = createHarness("ready");
	assert.deepEqual(await service.getProvider(7, "a1"), {
		id: "a1",
		provider: "openai",
		name: "Primary",
		authType: "oauth",
		priority: null,
		active: true,
		status: "healthy",
		lastError: null,
		expiresAt: null,
	});
	assert.deepEqual(await service.listProviderModels(7, "a1"), {
		provider: "openai",
		connectionId: "a1",
		models: [{ id: "openai/gpt-4o", provider: "openai", name: "GPT-4o" }],
	});
	assert.equal((await service.listProviderNodes(7))[0].id, "node1");
});
