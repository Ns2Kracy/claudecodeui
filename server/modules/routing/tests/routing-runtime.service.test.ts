import assert from "node:assert/strict";
import test from "node:test";

import { AppError } from "@/shared/utils.js";

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
			openAiBaseUrl: "http://127.0.0.1:20128/api/v1",
			apiKey: "sidecar-runtime-key",
			routeName: "anthropic/claude-sonnet-4",
			model: "anthropic/claude-sonnet-4",
		},
	);
	assert.equal(harness.state.credentialReads, 1);
});

test("selected 9router model fails safely when the sidecar is unavailable", async () => {
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

	await assert.rejects(
		() => harness.service.resolveForModel("openai/gpt-5"),
		(error: unknown) =>
			error instanceof AppError && error.code === "ROUTING_RUNTIME_UNAVAILABLE",
	);
	assert.equal(harness.state.credentialReads, 0);
});
