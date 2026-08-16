import assert from "node:assert/strict";
import test from "node:test";

import type { NineRouterSidecarStatus } from "../nine-router-sidecar.service.js";
import { createRoutingRuntimeService } from "../routing-runtime.service.js";

function createHarness() {
	const state = { credentialReads: 0 };
	const runtime = {
		getStatus: (): NineRouterSidecarStatus => ({
			state: "ready",
			origin: "http://127.0.0.1:20128",
			version: "0.5.45",
			lastError: null,
		}),
		getInternalCredentials: () => {
			state.credentialReads += 1;
			return {
				initialPassword: "sidecar-admin",
				dataPlaneKey: "sidecar-runtime-key",
			};
		},
	};
	const service = createRoutingRuntimeService({ runtime });
	return { state, runtime, service };
}

test("selected Provider Router model resolves sidecar REST credentials without rewriting its id", async () => {
	const harness = createHarness();

	assert.deepEqual(
		await harness.service.resolveForModel("anthropic/claude-sonnet-4"),
		{
			source: "9router",
			baseUrl: "http://127.0.0.1:20128/api",
			openAiBaseUrl: "http://127.0.0.1:20128/v1",
			apiKey: "sidecar-runtime-key",
			routeName: "anthropic/claude-sonnet-4",
			model: "anthropic/claude-sonnet-4",
		},
	);
	assert.equal(harness.state.credentialReads, 1);
});


test("routed model refreshes the 9Router data-plane key before returning Codex credentials", async () => {
	let dataPlaneKey = "unregistered-startup-key";
	let provisionCalls = 0;
	const runtime = {
		getStatus: (): NineRouterSidecarStatus => ({
			state: "ready",
			origin: "http://9router:20128",
			version: "0.5.50",
			lastError: null,
		}),
		getInternalCredentials: () => ({
			initialPassword: "sidecar-admin",
			dataPlaneKey,
		}),
		async ensureDataPlaneKey() {
			provisionCalls += 1;
			dataPlaneKey = "registered-router-key";
			return true;
		},
	};
	const service = createRoutingRuntimeService({ runtime });

	const result = await service.resolveForModel("openai/gpt-5");
	await service.resolveForModel("openai/gpt-5-mini");

	assert.equal(provisionCalls, 1);
	assert.equal(result.source, "9router");
	if (result.source !== "9router") assert.fail("expected Router configuration");
	assert.equal(result.apiKey, "registered-router-key");
});

test("failed 9Router key refresh is retried on the next routed request", async () => {
	let dataPlaneKey = "unregistered-startup-key";
	let provisionCalls = 0;
	const service = createRoutingRuntimeService({
		runtime: {
			getStatus: () => ({
				state: "ready" as const,
				origin: "http://9router:20128",
				version: "0.5.50",
				lastError: null,
			}),
			getInternalCredentials: () => ({
				initialPassword: "sidecar-admin",
				dataPlaneKey,
			}),
			async ensureDataPlaneKey() {
				provisionCalls += 1;
				if (provisionCalls === 1) return false;
				dataPlaneKey = "registered-router-key";
				return true;
			},
		},
	});

	await assert.rejects(
		() => service.resolveForModel("openai/gpt-5"),
		(error: unknown) =>
			error instanceof Error &&
			"code" in error &&
			error.code === "ROUTING_OPERATION_FAILED",
	);
	const second = await service.resolveForModel("openai/gpt-5");

	assert.equal(provisionCalls, 2);
	assert.equal(second.source, "9router");
	if (second.source !== "9router") assert.fail("expected Router configuration");
	assert.equal(second.apiKey, "registered-router-key");
});

test("selected Router model resolves real request credentials despite stale unavailable status", async () => {
	const harness = createHarness();
	harness.runtime.getStatus = () => ({
		state: "unavailable",
		origin: "http://127.0.0.1:20128",
		version: null,
		lastError: {
			code: "ROUTING_SIDECAR_UNAVAILABLE",
			message: "down",
			retryable: true,
		},
	});

	const result = await harness.service.resolveForModel("openai/gpt-5");

	assert.equal(result.source, "9router");
	if (result.source !== "9router") assert.fail("expected Router configuration");
	assert.equal(result.baseUrl, "http://127.0.0.1:20128/api");
	assert.equal(result.apiKey, "sidecar-runtime-key");
	assert.equal(harness.state.credentialReads, 1);
});
