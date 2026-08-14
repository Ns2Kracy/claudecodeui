import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { createServer } from "node:http";
import test from "node:test";

import {
	configureNineRouterSidecarForTesting,
	getNineRouterSidecarStatus,
	provisionNineRouterDataPlaneKeyForTesting,
	resetNineRouterSidecarForTesting,
} from "../routing.module.js";

test.afterEach(() => {
	resetNineRouterSidecarForTesting();
});

test("data-plane provisioning reuses an official CloudCLI key from management REST", async () => {
	const calls: Array<{ operation: string; body?: unknown; cookie?: string }> =
		[];
	const originalLoopback = process.env.ROUTING_ALLOW_LOOPBACK_HTTP;
	process.env.ROUTING_ALLOW_LOOPBACK_HTTP = "true";
	const server = createServer((request, response) => {
		let raw = "";
		request.setEncoding("utf8");
		request.on("data", (chunk) => {
			raw += chunk;
		});
		request.on("end", () => {
			let body: unknown;
			try {
				body = raw ? JSON.parse(raw) : undefined;
			} catch {
				response.statusCode = 400;
				response.end(JSON.stringify({ error: "invalid JSON" }));
				return;
			}
			const cookie = request.headers.cookie;
			response.setHeader("content-type", "application/json");
			if (request.url === "/api/auth/status") {
				calls.push({ operation: "authStatus" });
				response.end(
					JSON.stringify({ requireLogin: true, authMode: "password" }),
				);
				return;
			}
			if (request.url === "/api/auth/login") {
				calls.push({ operation: "login", body });
				response.setHeader(
					"set-cookie",
					"auth_token=session; Path=/; HttpOnly",
				);
				response.end(JSON.stringify({ success: true }));
				return;
			}
			if (request.url === "/api/keys") {
				calls.push({
					operation: request.method === "POST" ? "keyCreate" : "keysList",
					body,
					cookie,
				});
				response.end(
					JSON.stringify({ keys: [{ name: "CloudCLI", key: "sk_existing" }] }),
				);
				return;
			}
			response.statusCode = 404;
			response.end(JSON.stringify({ error: "not found" }));
		});
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const address = server.address();
	assert.notEqual(address, null);
	assert.notEqual(typeof address, "string");
	const port = (address as AddressInfo).port;

	try {
		assert.equal(
			await provisionNineRouterDataPlaneKeyForTesting(
				`http://127.0.0.1:${port}`,
				"shared-admin",
			),
			"sk_existing",
		);
		assert.deepEqual(calls, [
			{ operation: "authStatus" },
			{ operation: "login", body: { password: "shared-admin" } },
			{ operation: "keysList", body: undefined, cookie: "auth_token=session" },
		]);
	} finally {
		await new Promise<void>((resolve) => server.close(() => resolve()));
		if (originalLoopback === undefined)
			delete process.env.ROUTING_ALLOW_LOOPBACK_HTTP;
		else process.env.ROUTING_ALLOW_LOOPBACK_HTTP = originalLoopback;
	}
});

test("sidecar configuration uses a singleton adapter without health or process lifecycle operations", () => {
	const calls: string[] = [];
	const sidecar = {
		getStatus() {
			calls.push("status");
			return {
				state: "ready" as const,
				origin: "http://9router:20128",
				version: "0.5.50",
				lastError: null,
			};
		},
		getInternalCredentials() {
			throw new Error("credentials must stay private");
		},
	};
	let factories = 0;
	configureNineRouterSidecarForTesting(() => {
		factories += 1;
		return sidecar;
	});

	assert.equal(getNineRouterSidecarStatus().state, "ready");
	assert.equal(getNineRouterSidecarStatus().version, "0.5.50");

	assert.equal(factories, 1);
	assert.deepEqual(calls, ["status", "status"]);
	assert.equal("refresh" in sidecar, false);
	assert.equal("restart" in sidecar, false);
	assert.equal("stop" in sidecar, false);
});
