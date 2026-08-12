import assert from "node:assert/strict";
import test from "node:test";

import { emptyRoutingSettingsView } from "../../../../../../shared/routing.js";

import { createRoutingApiClient, RoutingApiError } from "./routingApi.js";

function jsonResponse(payload: unknown, status = 200): Response {
	return new Response(JSON.stringify(payload), {
		status,
		headers: { "content-type": "application/json" },
	});
}

test("parses a standard routing settings success envelope", async () => {
	const expected = emptyRoutingSettingsView();
	const api = createRoutingApiClient(async () =>
		jsonResponse({ success: true, data: expected }),
	);

	assert.deepEqual(await api.getSettings(), expected);
});

test("maps standard AppError envelopes into a safe RoutingApiError", async () => {
	const api = createRoutingApiClient(async () =>
		jsonResponse(
			{
				success: false,
				error: {
					code: "ROUTING_RATE_LIMITED",
					message: "Too many routing requests",
					details: { upstreamBody: "must-not-propagate" },
				},
			},
			429,
		),
	);

	await assert.rejects(api.getSettings(), (error: unknown) => {
		assert.ok(error instanceof RoutingApiError);
		assert.equal(error.code, "ROUTING_RATE_LIMITED");
		assert.equal(error.message, "Too many routing requests");
		assert.equal(error.status, 429);
		assert.equal(error.retryable, true);
		assert.equal("details" in error, false);
		return true;
	});
});

test("rejects malformed success data instead of trusting a type assertion", async () => {
	const api = createRoutingApiClient(async () =>
		jsonResponse({
			success: true,
			data: { connection: { configured: false } },
		}),
	);

	await assert.rejects(
		api.getSettings(),
		(error: unknown) =>
			error instanceof RoutingApiError &&
			error.code === "ROUTING_INVALID_RESPONSE" &&
			error.retryable === false,
	);
});

test("builds allowlisted detail queries and encodes dynamic resource ids once", async () => {
	const requests: Array<{ url: string; init?: RequestInit }> = [];
	const settings = {
		...emptyRoutingSettingsView(),
		accounts: [],
		models: [],
	};
	const api = createRoutingApiClient(async (url, init) => {
		requests.push({ url: String(url), init });
		if (init?.method === "DELETE") {
			return jsonResponse({ success: true, data: { deleted: true } });
		}
		return jsonResponse({ success: true, data: settings });
	});

	await api.getSettings({ accounts: true, models: true });
	await api.deleteAccount("account/name");

	assert.equal(requests[0]?.url, "/api/routing?details=accounts%2Cmodels");
	assert.equal(requests[1]?.url, "/api/routing/accounts/account%2Fname");
	assert.equal(requests[1]?.init?.method, "DELETE");
});

test("applies the Custom provider to Codex through the protected routing endpoint", async () => {
	const requests: Array<{ url: string; init?: RequestInit }> = [];
	const api = createRoutingApiClient(async (url, init) => {
		requests.push({ url: String(url), init });
		return jsonResponse({
			success: true,
			data: { provider: "Custom", apiKey: "must-not-pass" },
		});
	});

	assert.deepEqual(await api.applyToCodex(), { provider: "Custom" });
	assert.deepEqual(requests, [
		{
			url: "/api/routing/codex/applications",
			init: { method: "POST" },
		},
	]);
});

test("rejects an invalid Codex application response", async () => {
	const api = createRoutingApiClient(async () =>
		jsonResponse({
			success: true,
			data: { provider: "Other" },
		}),
	);
	await assert.rejects(
		api.applyToCodex(),
		(error: unknown) =>
			error instanceof RoutingApiError &&
			error.code === "ROUTING_INVALID_RESPONSE",
	);
});

test("parses OAuth and device-code views while keeping every request same-origin", async () => {
	const requests: Array<{ url: string; init?: RequestInit }> = [];
	const responses = [
		{
			provider: "claude",
			transactionId: "oauth-transaction",
			authUrl: "https://auth.example.test/authorize",
			redirectUri: "http://127.0.0.1:3001/api/routing/oauth/claude/callback",
			expiresAt: "2030-01-02T03:04:05.000Z",
		},
		{
			provider: "github",
			transactionId: "device-transaction",
			userCode: "ABCD-EFGH",
			verificationUri: "https://github.com/login/device",
			verificationUriComplete: null,
			expiresAt: "2030-01-02T03:04:05.000Z",
			interval: 5,
		},
		{ provider: "github", pending: true, account: null },
		{ cancelled: true },
	];
	const api = createRoutingApiClient(async (url, init) => {
		requests.push({ url: String(url), init });
		return jsonResponse({ success: true, data: responses.shift() });
	});

	assert.equal(
		(await api.startOAuth("claude")).transactionId,
		"oauth-transaction",
	);
	assert.equal((await api.startDeviceCode("github")).userCode, "ABCD-EFGH");
	assert.equal(
		(await api.pollDeviceCode("github", "device-transaction")).pending,
		true,
	);
	assert.deepEqual(await api.cancelDeviceCode("github", "device-transaction"), {
		cancelled: true,
	});

	assert.deepEqual(
		requests.map(({ url, init }) => [url, init?.method]),
		[
			["/api/routing/oauth/claude/authorize", "POST"],
			["/api/routing/oauth/github/device-code", "POST"],
			["/api/routing/oauth/github/poll", "POST"],
			["/api/routing/oauth/github/cancel", "POST"],
		],
	);
	let pollBody: unknown;
	try {
		pollBody = JSON.parse(String(requests[2]?.init?.body));
	} catch (error) {
		assert.fail(`Expected valid polling JSON: ${String(error)}`);
	}
	assert.deepEqual(pollBody, { transactionId: "device-transaction" });
});

test("rejects malformed OAuth URLs and polling responses at the browser boundary", async () => {
	const malformed = [
		{
			provider: "claude",
			transactionId: "oauth-transaction",
			authUrl: 42,
			redirectUri: "http://127.0.0.1/callback",
			expiresAt: "2030-01-02T03:04:05.000Z",
		},
		{
			provider: "github",
			pending: false,
			account: null,
			accessToken: "must-not-pass",
		},
	];
	const api = createRoutingApiClient(async () =>
		jsonResponse({ success: true, data: malformed.shift() }),
	);

	await assert.rejects(
		api.startOAuth("claude"),
		(error: unknown) =>
			error instanceof RoutingApiError &&
			error.code === "ROUTING_INVALID_RESPONSE",
	);
	await assert.rejects(
		api.pollDeviceCode("github", "transaction"),
		(error: unknown) =>
			error instanceof RoutingApiError &&
			error.code === "ROUTING_INVALID_RESPONSE",
	);
});

test("validates and creates custom provider nodes through allowlisted routing paths", async () => {
	const requests: Array<{ url: string; init?: RequestInit }> = [];
	const node = {
		id: "node-1",
		type: "openai-compatible",
		name: "Internal gateway",
		prefix: "internal",
		baseUrl: "https://gateway.example.test/v1",
		apiType: "responses",
		createdAt: null,
		updatedAt: null,
	};
	const responses = [{ valid: true, message: null }, node, [node]];
	const api = createRoutingApiClient(async (url, init) => {
		requests.push({ url: String(url), init });
		return jsonResponse({ success: true, data: responses.shift() });
	});

	assert.deepEqual(
		await api.validateProviderNode({
			baseUrl: "https://gateway.example.test/v1",
			apiKey: "write-only-key",
			type: "openai-compatible",
		}),
		{ valid: true, message: null },
	);
	assert.equal(
		(
			await api.createProviderNode({
				name: "Internal gateway",
				prefix: "internal",
				type: "openai-compatible",
				apiType: "responses",
				baseUrl: "https://gateway.example.test/v1",
			})
		).id,
		"node-1",
	);
	assert.equal((await api.listProviderNodes())[0]?.prefix, "internal");

	assert.deepEqual(
		requests.map(({ url, init }) => [url, init?.method]),
		[
			["/api/routing/provider-nodes/validations", "POST"],
			["/api/routing/provider-nodes", "POST"],
			["/api/routing/provider-nodes", undefined],
		],
	);
});
