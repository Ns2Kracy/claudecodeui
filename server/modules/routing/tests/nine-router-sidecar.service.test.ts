import assert from "node:assert/strict";
import test from "node:test";

import { createNineRouterSidecarService } from "../nine-router-sidecar.service.js";

test("reports ready only for a valid official health response", async () => {
	const service = createNineRouterSidecarService({
		baseUrl: "http://9router:20128",
		health: async () => ({ ok: true, version: "0.5.45" }),
	});

	assert.deepEqual(await service.refresh(), {
		state: "ready",
		origin: "http://9router:20128",
		version: "0.5.45",
		lastError: null,
	});
	assert.deepEqual(service.getStatus(), {
		state: "ready",
		origin: "http://9router:20128",
		version: "0.5.45",
		lastError: null,
	});
});

test("reports unavailable without spawning or killing a process", async () => {
	let calls = 0;
	const service = createNineRouterSidecarService({
		baseUrl: "https://9router.internal:20128",
		health: async () => {
			calls += 1;
			throw new Error("connect ECONNREFUSED secret-token");
		},
	});

	assert.deepEqual(await service.refresh(), {
		state: "unavailable",
		origin: "https://9router.internal:20128",
		version: null,
		lastError: {
			code: "ROUTING_SIDECAR_UNAVAILABLE",
			message: "Router health check failed",
			retryable: true,
		},
	});
	assert.equal(calls, 1);
	assert.equal("start" in service, false);
	assert.equal("stop" in service, false);
	assert.equal("restart" in service, false);
});

test("rejects unofficial or malformed health responses", async () => {
	const scenarios = [
		{ ok: true },
		{ ok: false, version: "0.5.45" },
		{ ok: true, version: "" },
		{ ok: true, version: "0.5.45\nsecret" },
	];

	for (const response of scenarios) {
		const service = createNineRouterSidecarService({
			baseUrl: "http://9router:20128",
			health: async () => response,
		});

		assert.equal((await service.refresh()).state, "unavailable");
	}
});

test("accepts only http and https origins without credentials, query, or fragment", () => {
	for (const baseUrl of [
		"http://9router:20128",
		"https://router.example.com/base",
	]) {
		assert.equal(
			createNineRouterSidecarService({
				baseUrl,
				health: async () => ({ ok: true, version: "0.5.45" }),
			}).getStatus().origin,
			baseUrl,
		);
	}

	for (const baseUrl of [
		"ftp://9router:20128",
		"http://user:pass@9router:20128",
		"http://9router:20128?token=secret",
		"http://9router:20128#fragment",
		"http://",
	]) {
		assert.throws(
			() =>
				createNineRouterSidecarService({
					baseUrl,
					health: async () => ({ ok: true, version: "0.5.45" }),
				}),
			/Router URL/,
			baseUrl,
		);
	}
});
