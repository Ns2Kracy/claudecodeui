import assert from "node:assert/strict";
import test from "node:test";

import { providerRegistry } from "@/modules/providers/provider.registry.js";
import { createProviderRuntimeService } from "@/modules/providers/services/provider-runtime.service.js";
import type { IProvider, IProviderRuntime } from "@/shared/interfaces.js";
import type {
	LLMProvider,
	RuntimeRoutingConfiguration,
} from "@/shared/types.js";

function createRuntime(
	overrides: Partial<IProviderRuntime> = {},
): IProviderRuntime {
	return {
		async run() {
			return undefined;
		},
		abort() {
			return false;
		},
		...overrides,
	};
}

function createProvider(id: LLMProvider, runtime: IProviderRuntime): IProvider {
	return {
		id,
		runtime,
		auth: {
			async getStatus() {
				return {
					provider: id,
					installed: true,
					authenticated: true,
					method: "test",
					details: {},
				};
			},
		},
		sessions: {
			normalizeMessage(raw: unknown, sessionId: string | null) {
				return [
					{ kind: "assistant", content: String(raw), sessionId, provider: id },
				];
			},
			async fetchHistory() {
				return {
					messages: [],
					total: 0,
					hasMore: false,
					offset: 0,
					limit: null,
				};
			},
		},
	} as unknown as IProvider;
}

function createService(
	providers: IProvider[],
	resolveRoutingForModel: (
		model: string,
	) => Promise<RuntimeRoutingConfiguration> = async () => ({
		source: "native",
	}),
	models: Array<{ value: string; source: "native" | "9router" }> = [],
) {
	const providerMap = new Map(
		providers.map((provider) => [provider.id, provider]),
	);
	return createProviderRuntimeService({
		listProviders: () => providers,
		resolveProvider(providerName) {
			const provider = providerMap.get(providerName as LLMProvider);
			if (!provider) {
				throw new Error(`Missing provider: ${providerName}`);
			}
			return provider;
		},
		resolveProviderSessionId: (sessionId) =>
			sessionId ? `native-${sessionId}` : null,
		async resolveResumeModel(_provider, _sessionId, requestedModel) {
			return requestedModel?.trim() || undefined;
		},
		async getProviderModels() {
			return {
				models: {
					OPTIONS: models.map(({ value, source }) => ({
						value,
						label: value,
						source,
					})),
					DEFAULT: "default-model",
				},
				cache: {
					updatedAt: new Date(0).toISOString(),
					expiresAt: new Date(0).toISOString(),
					source: "fresh",
				},
			};
		},
		resolveRoutingForModel,
	});
}

test("providerRegistry exposes only the Codex runtime", () => {
	const providers = providerRegistry.listProviders();

	assert.deepEqual(
		providers.map((provider) => provider.id),
		["codex"],
	);
	assert.equal(typeof providers[0]?.runtime.run, "function");
	assert.equal(typeof providers[0]?.runtime.abort, "function");
	for (const removedProvider of ["claude", "cursor", "opencode"]) {
		assert.throws(
			() => providerRegistry.resolveProvider(removedProvider),
			(error: unknown) =>
				error instanceof Error &&
				"code" in error &&
				error.code === "UNSUPPORTED_PROVIDER",
		);
	}
});

test("dispatches runs and aborts through the runtime owned by providerRegistry", async () => {
	const calls: unknown[][] = [];
	const runtime = createRuntime({
		async run(command, options, writer, context) {
			calls.push(["run", command, options, writer]);
			assert.equal(
				context.resolveProviderSessionId("session-1"),
				"native-session-1",
			);
			assert.equal(
				await context.resolveResumeModel("session-1", "sonnet"),
				"sonnet",
			);
			assert.deepEqual(await context.getProviderModels(), {
				OPTIONS: [{ value: "sonnet", label: "sonnet", source: "native" }],
				DEFAULT: "default-model",
			});
			assert.equal(
				context.normalizeMessage("hello", "session-1")[0]?.provider,
				"claude",
			);
			assert.equal(await context.isProviderInstalled(), true);
			assert.deepEqual(context.routing, { source: "native" });
			return "complete";
		},
		async abort(sessionId) {
			calls.push(["abort", sessionId]);
			return true;
		},
	});
	const service = createService(
		[createProvider("claude", runtime)],
		undefined,
		[{ value: "sonnet", source: "native" }],
	);
	const writer = { send() {} };

	assert.equal(service.hasRuntime("claude"), true);
	assert.equal(service.hasRuntime("unknown"), false);
	assert.equal(
		await service.getRunner("claude")("hello", { model: "sonnet" }, writer),
		"complete",
	);
	assert.equal(await service.abort("claude", "session-1"), true);
	assert.deepEqual(calls, [
		["run", "hello", { model: "sonnet" }, writer],
		["abort", "session-1"],
	]);
});

test("Codex rejects runs without a selected routed model", async () => {
	let ran = false;
	const service = createService([
		createProvider(
			"codex",
			createRuntime({
				async run() {
					ran = true;
				},
			}),
		),
	]);

	await assert.rejects(
		() => service.run("codex", "hello", {}, { userId: 7, send() {} }),
		(error: unknown) =>
			error instanceof Error &&
			"code" in error &&
			error.code === "PROVIDER_MODEL_REQUIRED",
	);
	assert.equal(ran, false);
});

test("Codex rejects native model provenance before starting the runtime", async () => {
	let ran = false;
	const service = createService(
		[
			createProvider(
				"codex",
				createRuntime({
					async run() {
						ran = true;
					},
				}),
			),
		],
		undefined,
		[{ value: "gpt-native", source: "native" }],
	);

	await assert.rejects(
		() =>
			service.run(
				"codex",
				"hello",
				{ model: "gpt-native", modelSource: "native" },
				{ userId: 7, send() {} },
			),
		(error: unknown) =>
			error instanceof Error &&
			"code" in error &&
			error.code === "CODEX_ROUTING_REQUIRED",
	);
	assert.equal(ran, false);
});

test("provider model provenance routes an unprefixed selected model through the sidecar", async () => {
	const calls: unknown[][] = [];
	let receivedRouting: unknown;
	const runtime = createRuntime({
		async run(_command, _options, _writer, context) {
			receivedRouting = context.routing;
			return "complete";
		},
	});
	const service = createService(
		[createProvider("codex", runtime)],
		async (model) => {
			calls.push(["model", model]);
			return {
				source: "9router",
				baseUrl: "http://9router:20128/api",
				openAiBaseUrl: "http://9router:20128/v1",
				apiKey: "official-key",
				routeName: "openai/gpt-5",
				model: "openai/gpt-5",
			};
		},
		[{ value: "openai/gpt-5", source: "9router" }],
	);

	await service.run(
		"codex",
		"hello",
		{ sessionId: "app-session-1", model: "openai/gpt-5" },
		{ userId: 7, send() {} },
	);

	assert.deepEqual(calls, [["model", "openai/gpt-5"]]);
	assert.deepEqual(receivedRouting, {
		source: "9router",
		baseUrl: "http://9router:20128/api",
		openAiBaseUrl: "http://9router:20128/v1",
		apiKey: "official-key",
		routeName: "openai/gpt-5",
		model: "openai/gpt-5",
	});
});

test("qualifies a legacy unprefixed routed model from the current catalog", async () => {
	const calls: string[] = [];
	const service = createService(
		[createProvider("codex", createRuntime())],
		async (model) => {
			calls.push(model);
			return {
				source: "9router",
				baseUrl: "http://9router/api",
				openAiBaseUrl: "http://9router/v1",
				apiKey: "key",
				routeName: model,
				model,
			};
		},
		[{ value: "deepseek/deepseek-v4-flash", source: "9router" }],
	);

	await service.run(
		"codex",
		"hello",
		{ model: "deepseek-v4-flash", modelSource: "9router" },
		{ userId: 7, send() {} },
	);

	assert.deepEqual(calls, ["deepseek/deepseek-v4-flash"]);
});

test("rejects an ambiguous legacy unprefixed routed model", async () => {
	const service = createService(
		[createProvider("codex", createRuntime())],
		undefined,
		[
			{ value: "cx/shared-model", source: "9router" },
			{ value: "openai/shared-model", source: "9router" },
		],
	);

	await assert.rejects(
		() =>
			service.run(
				"codex",
				"hello",
				{ model: "shared-model", modelSource: "9router" },
				{ userId: 7, send() {} },
			),
		(error: unknown) =>
			error instanceof Error &&
			"code" in error &&
			error.code === "PROVIDER_MODEL_UNAVAILABLE",
	);
});

test("uses server-supplied routed provenance without rediscovering the catalog", async () => {
	let receivedRouting: RuntimeRoutingConfiguration | null = null;
	const runtime = createRuntime({
		async run(_command, _options, _writer, context) {
			receivedRouting = context.routing;
		},
	});
	const service = createService(
		[createProvider("codex", runtime)],
		async (model) => ({
			source: "9router",
			baseUrl: "http://9router/api",
			openAiBaseUrl: "http://9router/v1",
			apiKey: "key",
			routeName: model,
			model,
		}),
	);

	await service.run(
		"codex",
		"hello",
		{ model: "cx/gpt-5", modelSource: "9router" },
		{ userId: 7, send() {} },
	);
	assert.deepEqual(receivedRouting, {
		source: "9router",
		baseUrl: "http://9router/api",
		openAiBaseUrl: "http://9router/v1",
		apiKey: "key",
		routeName: "cx/gpt-5",
		model: "cx/gpt-5",
	});
});

test("fails closed when a selected model is absent from the current catalog", async () => {
	let ran = false;
	const runtime = createRuntime({
		async run() {
			ran = true;
		},
	});
	const service = createService([createProvider("codex", runtime)]);

	await assert.rejects(
		() =>
			service.run(
				"codex",
				"hello",
				{ model: "cx/gpt-5" },
				{ userId: 7, send() {} },
			),
		(error: unknown) =>
			error instanceof Error &&
			"code" in error &&
			error.code === "PROVIDER_MODEL_UNAVAILABLE",
	);
	assert.equal(ran, false);
});

test("routes permission decisions through provider-owned runtime capabilities", () => {
	const decisions: unknown[][] = [];
	const claudeRuntime = createRuntime({
		permissions: {
			resolve(requestId, decision) {
				decisions.push([requestId, decision]);
			},
			listPending(sessionId) {
				return [{ requestId: "request-1", sessionId }];
			},
		},
	});
	const service = createService([
		createProvider("claude", claudeRuntime),
		createProvider("cursor", createRuntime()),
	]);
	const decision = { allow: true, message: "approved" };

	service.resolveToolApproval("request-1", decision);

	assert.deepEqual(decisions, [["request-1", decision]]);
	assert.deepEqual(service.getPendingApprovalsForSession("session-1"), [
		{ requestId: "request-1", sessionId: "session-1" },
	]);
});
