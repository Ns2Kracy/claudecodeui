import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";

import { createCodexOAuthCallbackBridge } from "../codex-oauth-callback-bridge.js";

type TestResponse = {
	status: number;
	headers: http.IncomingHttpHeaders;
	body: string;
};

function requestLoopback(
	port: number,
	path: string,
	method = "GET",
): Promise<TestResponse> {
	return new Promise((resolve, reject) => {
		const request = http.request(
			{ hostname: "127.0.0.1", port, path, method },
			(response) => {
				const chunks: Buffer[] = [];
				response.on("data", (chunk: Buffer) => chunks.push(chunk));
				response.on("end", () =>
					resolve({
						status: response.statusCode ?? 0,
						headers: response.headers,
						body: Buffer.concat(chunks).toString("utf8"),
					}),
				);
			},
		);
		request.on("error", reject);
		request.end();
	});
}

test("Codex callback bridge is loopback-addressed, bounded, static, and short-lived", async () => {
	const bridge = createCodexOAuthCallbackBridge({
		port: 0,
		idleTimeoutMs: 1_000,
	});
	try {
		const callbackUrl = new URL(await bridge.start());
		assert.equal(callbackUrl.hostname, "localhost");
		const port = Number(callbackUrl.port);

		const response = await requestLoopback(
			port,
			"/auth/callback?code=example-code&state=example-state",
		);
		assert.equal(response.status, 200);
		assert.equal(response.headers["cache-control"], "no-store");
		assert.equal(response.headers["referrer-policy"], "no-referrer");
		const contentSecurityPolicy = response.headers["content-security-policy"];
		assert.ok(typeof contentSecurityPolicy === "string");
		assert.match(contentSecurityPolicy, /default-src 'none'/);
		assert.match(response.body, /routing-oauth-callback/);
		assert.match(response.body, /window\.location\.href/);
		assert.equal(response.body.includes("example-code"), false);
		assert.equal(
			(await requestLoopback(port, "/auth/callback", "POST")).status,
			405,
		);
		assert.equal((await requestLoopback(port, "/other")).status, 404);
		assert.equal(
			(await requestLoopback(port, `/auth/callback?value=${"x".repeat(5_000)}`))
				.status,
			414,
		);
	} finally {
		await bridge.close();
	}
});
