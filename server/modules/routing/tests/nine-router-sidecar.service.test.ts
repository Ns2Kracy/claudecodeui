import assert from "node:assert/strict";
import test from "node:test";

import { createNineRouterSidecarService } from "../nine-router-sidecar.service.js";

test("exposes configured Router state without a network probe", () => {
	const service = createNineRouterSidecarService({
		baseUrl: "http://9router:20128",
	});

	assert.deepEqual(service.getStatus(), {
		state: "ready",
		origin: "http://9router:20128",
		version: "0.5.50",
		lastError: null,
	});
	assert.equal("refresh" in service, false);
	assert.equal("start" in service, false);
	assert.equal("stop" in service, false);
	assert.equal("restart" in service, false);
});

test("stores internal credentials without exposing mutable references", () => {
	const service = createNineRouterSidecarService({
		credentials: {
			initialPassword: "admin",
			dataPlaneKey: "data-key",
		},
	});

	const first = service.getInternalCredentials();
	first.dataPlaneKey = "mutated";
	assert.equal(service.getInternalCredentials().dataPlaneKey, "data-key");

	service.updateInternalCredentials({
		initialPassword: "admin-2",
		dataPlaneKey: "data-key-2",
	});
	assert.deepEqual(service.getInternalCredentials(), {
		initialPassword: "admin-2",
		dataPlaneKey: "data-key-2",
	});
});

test("accepts only http and https origins without credentials, query, or fragment", () => {
	for (const baseUrl of [
		"http://9router:20128",
		"https://router.example.com/base",
	]) {
		assert.equal(
			createNineRouterSidecarService({ baseUrl }).getStatus().origin,
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
			() => createNineRouterSidecarService({ baseUrl }),
			/Router URL/,
			baseUrl,
		);
	}
});
