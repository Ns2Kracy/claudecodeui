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
