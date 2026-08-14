import assert from "node:assert/strict";
import test from "node:test";

import { createRoutingService } from "../routing.service.js";

function createHarness(
	state: "ready" | "unavailable" = "ready",
	origin = "http://127.0.0.1:20128",
) {
	const calls: string[] = [];
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
	let currentState = state;
	const runtime = {
		getStatus: () => ({
			state: currentState,
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
		refresh: async () => {
			calls.push("refresh");
			currentState = "ready";
			return runtime.getStatus();
		},
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
		now: () => new Date("2026-08-04T00:00:00.000Z"),
	});
	return { service, calls };
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
	assert.equal(calls.filter((call) => call === "client").length, 1);
});

test("settings request provider accounts directly despite stale unavailable status", async () => {
	const { service, calls } = createHarness("unavailable");

	const settings = await service.getSettings(7, { accounts: true });

	assert.equal(calls.includes("refresh"), false);
	assert.equal(calls.filter((call) => call === "client").length, 1);
	assert.equal(settings.runtime.status, "ready");
	assert.equal(settings.accounts?.length, 1);
});

test("failed direct account requests report a retryable degraded runtime", async () => {
	const runtime = {
		getStatus: () => ({
			state: "unavailable" as const,
			origin: "http://127.0.0.1:20128",
			version: null,
			lastError: null,
		}),
		getInternalCredentials: () => ({
			initialPassword: "admin",
			dataPlaneKey: "data-plane-key",
		}),
	};
	const service = createRoutingService({
		runtime,
		clientFactory: () =>
			({
				listAccounts: async () => {
					throw new Error("connection failed");
				},
			}) as never,
	});

	const settings = await service.getSettings(7, { accounts: true });

	assert.equal(settings.runtime.status, "degraded");
	assert.equal(settings.runtime.capabilities.readAccounts, true);
	assert.equal(settings.runtime.lastError?.retryable, true);
	assert.equal(settings.accounts, undefined);
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

type CatalogAccount = {
	id: string;
	provider: string;
	name: string;
	authType: "oauth" | "apikey";
	priority: number | null;
	active: boolean;
	status: "healthy";
	lastError: null;
	expiresAt: null;
};

const catalogAccount = (id: string, provider: string): CatalogAccount => ({
	id,
	provider,
	name: provider,
	authType: provider === "codex" ? "oauth" : "apikey",
	priority: null,
	active: true,
	status: "healthy",
	lastError: null,
	expiresAt: null,
});

function createCatalogHarness(options: {
	accounts: CatalogAccount[];
	listProviderModels: (id: string) => Promise<any>;
	now?: () => Date;
	updateAccount?: (id: string) => Promise<any>;
}) {
	const client = {
		listAccounts: async () => options.accounts,
		listProviderModels: options.listProviderModels,
		listModels: async () => {
			const entries = await Promise.all(
				options.accounts.map((account) =>
					options.listProviderModels(account.id),
				),
			);
			return entries.flatMap((entry: any) => entry.models);
		},
		updateAccount:
			options.updateAccount ??
			(async (id: string) => ({ ...options.accounts[0], id })),
	};
	return createRoutingService({
		runtime: {
			getStatus: () => ({
				state: "ready" as const,
				origin: "http://127.0.0.1:20128",
				version: "0.5.45",
				lastError: null,
			}),
			getInternalCredentials: () => ({
				jwtSecret: "jwt",
				initialPassword: "admin",
				apiKeySecret: "hmac-secret",
				dataPlaneKey: "data-plane-key",
				machineIdSalt: "salt",
				dataDir: "/db/9router",
			}),
		},
		clientFactory: () => client as never,
		now: options.now,
	});
}

test("settings keep directly loaded accounts when model loading fails", async () => {
	const account = catalogAccount("codex-1", "codex");
	const service = createCatalogHarness({
		accounts: [account],
		listProviderModels: async () => {
			throw new Error("model lookup failed");
		},
	});

	const settings = await service.getSettings(7, {
		accounts: true,
		models: true,
	});

	assert.deepEqual(settings.accounts, [account]);
	assert.equal(settings.models, undefined);
	assert.equal(settings.runtime.status, "degraded");
});

test("concurrent model catalog reads share one account refresh", async () => {
	const account = catalogAccount("codex-1", "codex");
	let calls = 0;
	let release!: () => void;
	const gate = new Promise<void>((resolve) => {
		release = resolve;
	});
	const service = createCatalogHarness({
		accounts: [account],
		listProviderModels: async (id) => {
			calls += 1;
			await gate;
			return {
				provider: "codex",
				connectionId: id,
				models: [{ id: "codex/gpt-5.4", provider: "codex", name: "GPT 5.4" }],
			};
		},
	});

	const first = service.listModels(1);
	const second = service.listModels(2);
	await new Promise((resolve) => setImmediate(resolve));
	assert.equal(calls, 1);
	release();
	assert.deepEqual(await first, await second);
});

test("an expired account catalog falls back to its last successful snapshot", async () => {
	const account = catalogAccount("codex-1", "codex");
	let currentTime = new Date("2026-08-13T00:00:00.000Z");
	let fail = false;
	const service = createCatalogHarness({
		accounts: [account],
		now: () => currentTime,
		listProviderModels: async (id) => {
			if (fail) throw new Error("headers timeout");
			return {
				provider: "codex",
				connectionId: id,
				models: [{ id: "codex/gpt-5.4", provider: "codex", name: "GPT 5.4" }],
			};
		},
	});

	const initial = await service.listModels(1);
	currentTime = new Date(currentTime.getTime() + 5 * 60 * 1_000 + 1);
	fail = true;
	assert.deepEqual(await service.listModels(1), initial);
});

test("one account model failure does not discard another account catalog", async () => {
	const service = createCatalogHarness({
		accounts: [
			catalogAccount("codex-1", "codex"),
			catalogAccount("deepseek-1", "deepseek"),
		],
		listProviderModels: async (id) => {
			if (id === "codex-1") throw new Error("headers timeout");
			return {
				provider: "deepseek",
				connectionId: id,
				models: [
					{
						id: "deepseek/deepseek-v4-flash",
						provider: "deepseek",
						name: "DeepSeek V4 Flash",
					},
				],
			};
		},
	});

	assert.deepEqual(await service.listModels(1), [
		{
			id: "deepseek/deepseek-v4-flash",
			provider: "deepseek",
			name: "DeepSeek V4 Flash",
		},
	]);
});

test("account updates expire a fresh snapshot without deleting its fallback", async () => {
	const account = catalogAccount("codex-1", "codex");
	let calls = 0;
	const service = createCatalogHarness({
		accounts: [account],
		listProviderModels: async (id) => {
			calls += 1;
			return {
				provider: "codex",
				connectionId: id,
				models: [{ id: "codex/gpt-5.4", provider: "codex", name: "GPT 5.4" }],
			};
		},
	});

	await service.listModels(1);
	await service.listModels(1);
	assert.equal(calls, 1);
	await service.updateAccount(1, account.id, { name: "Updated" });
	await service.listModels(1);
	assert.equal(calls, 2);
});

test("account mutation detaches an in-flight pre-mutation model refresh", async () => {
	const account = catalogAccount("codex-1", "codex");
	let calls = 0;
	const releases: Array<() => void> = [];
	const service = createCatalogHarness({
		accounts: [account],
		listProviderModels: async (id) => {
			calls += 1;
			const call = calls;
			await new Promise<void>((resolve) => {
				releases[call - 1] = resolve;
			});
			return {
				provider: "codex",
				connectionId: id,
				models: [
					{
						id: `codex/gpt-generation-${call}`,
						provider: "codex",
						name: `Generation ${call}`,
					},
				],
			};
		},
	});

	const beforeMutation = service.listModels(1);
	await new Promise((resolve) => setImmediate(resolve));
	assert.equal(calls, 1);

	await service.updateAccount(1, account.id, { name: "Updated" });
	const afterMutation = service.listModels(1);
	await new Promise((resolve) => setImmediate(resolve));
	const callsAfterMutation = calls;

	releases[1]?.();
	releases[0]?.();
	await beforeMutation;
	const refreshed = await afterMutation;

	assert.equal(callsAfterMutation, 2);
	assert.equal(refreshed[0]?.id, "codex/gpt-generation-2");
	assert.equal((await service.listModels(1))[0]?.id, "codex/gpt-generation-2");
});

test("hard refresh bypasses a fresh model snapshot", async () => {
	const account = catalogAccount("codex-1", "codex");
	let calls = 0;
	const service = createCatalogHarness({
		accounts: [account],
		listProviderModels: async (id) => {
			calls += 1;
			return {
				provider: "codex",
				connectionId: id,
				models: [{ id: "codex/gpt-5.4", provider: "codex", name: "GPT 5.4" }],
			};
		},
	});

	await service.listModels(1);
	await service.listModels(1, true);
	assert.equal(calls, 2);
});

test("a successful empty account catalog prevents another failure from failing the aggregate", async () => {
	const service = createCatalogHarness({
		accounts: [
			catalogAccount("codex-1", "codex"),
			catalogAccount("deepseek-1", "deepseek"),
		],
		listProviderModels: async (id) => {
			if (id === "codex-1") throw new Error("headers timeout");
			return { provider: "deepseek", connectionId: id, models: [] };
		},
	});

	assert.deepEqual(await service.listModels(1), []);
});

test("all-account failure throws even when a provider rejects without an error value", async () => {
	const service = createCatalogHarness({
		accounts: [catalogAccount("codex-1", "codex")],
		listProviderModels: async () => Promise.reject(undefined),
	});

	await assert.rejects(() => service.listModels(1));
});

test("the first catalog load still fails when every active account fails", async () => {
	const service = createCatalogHarness({
		accounts: [catalogAccount("codex-1", "codex")],
		listProviderModels: async () => {
			throw new Error("headers timeout");
		},
	});

	await assert.rejects(
		() => service.listModels(1),
		(error: any) => error.code === "ROUTING_OPERATION_FAILED",
	);
});
