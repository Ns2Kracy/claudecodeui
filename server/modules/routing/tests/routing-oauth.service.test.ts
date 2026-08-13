import assert from "node:assert/strict";
import test from "node:test";

import { AppError } from "@/shared/utils.js";

import { createRoutingOAuthService } from "../routing-oauth.service.js";

function harness() {
	let now = 1_000_000;
	let seq = 0;
	let pollCount = 0;
	const calls: unknown[] = [];
	const client = {
		async startOAuth(provider: string, redirectUri: string) {
			calls.push({ op: "startOAuth", provider, redirectUri });
			return {
				provider,
				authUrl: `https://auth.example.test/${provider}?redirect_uri=${encodeURIComponent(redirectUri)}`,
				state: `upstream-${++seq}`,
				redirectUri,
				codeVerifier: `verifier-${seq}`,
			};
		},
		async exchangeOAuth(provider: string, input: unknown) {
			calls.push({ op: "exchangeOAuth", provider, input });
			return {
				id: "acct-1",
				provider,
				name: "OAuth",
				authType: "oauth" as const,
				priority: null,
				active: true,
				status: "healthy" as const,
				lastError: null,
				expiresAt: null,
			};
		},
		async startDeviceCode(provider: string) {
			calls.push({ op: "startDeviceCode", provider });
			return {
				provider,
				deviceCode: `device-${++seq}`,
				codeVerifier: `device-verifier-${seq}`,
				extraData: { secret: `extra-${seq}` },
				userCode: `USER-${seq}`,
				verificationUri: "https://verify.example.test",
				verificationUriComplete: "https://verify.example.test/complete",
				expiresIn: 30,
				interval: 1,
			};
		},
		async pollDeviceCode(provider: string, input: unknown) {
			calls.push({ op: "pollDeviceCode", provider, input });
			pollCount += 1;
			return {
				provider,
				pending: pollCount === 1,
				account:
					pollCount === 1
						? null
						: {
								id: "acct-device",
								provider,
								name: "Device",
								authType: "oauth" as const,
								priority: null,
								active: true,
								status: "healthy" as const,
								lastError: null,
								expiresAt: null,
							},
			};
		},
	};
	const service = createRoutingOAuthService({
		clientForRuntime: () => client,
		now: () => new Date(now),
		randomId: () => `random-${++seq}`,
		topology: { kind: "local", serverPort: 3333 },
		maxEntries: 2,
		transactionTtlMs: 10_000,
		minPollIntervalMs: 2_000,
	});
	return {
		service,
		calls,
		advance: (ms: number) => {
			now += ms;
		},
	};
}

async function rejectsCode(fn: () => Promise<unknown>, code: string) {
	await assert.rejects(
		fn,
		(error) => error instanceof AppError && error.code === code,
	);
}

test("authorization-code transaction is opaque, user/provider bound, expires, and consumed once before exchange", async () => {
	const h = harness();
	const started = await h.service.startAuthorizationCode(7, "openai");

	assert.equal(started.provider, "openai");
	assert.match(started.transactionId, /^random-/);
	assert.match(started.authUrl, /^https:\/\/auth\.example\.test/);
	assert.equal(
		started.redirectUri,
		"http://127.0.0.1:3333/api/routing/oauth/openai/callback",
	);
	assert.equal("state" in started, false);
	assert.equal("codeVerifier" in started, false);

	await rejectsCode(
		() =>
			h.service.completeAuthorizationCode(8, "openai", {
				transactionId: started.transactionId,
				state: "upstream-1",
				code: "code",
			}),
		"ROUTING_OAUTH_STATE_INVALID",
	);
	await rejectsCode(
		() =>
			h.service.completeAuthorizationCode(7, "codex", {
				transactionId: started.transactionId,
				state: "upstream-1",
				code: "code",
			}),
		"ROUTING_OAUTH_STATE_INVALID",
	);
	await rejectsCode(
		() =>
			h.service.completeAuthorizationCode(7, "openai", {
				transactionId: started.transactionId,
				state: "wrong-upstream-state",
				code: "code",
			}),
		"ROUTING_OAUTH_STATE_INVALID",
	);

	const completed = await h.service.completeAuthorizationCode(7, "openai", {
		transactionId: started.transactionId,
		state: "upstream-1",
		code: "code",
	});
	assert.equal(completed.id, "acct-1");
	assert.deepEqual(h.calls.at(-1), {
		op: "exchangeOAuth",
		provider: "openai",
		input: {
			code: "code",
			redirectUri: "http://127.0.0.1:3333/api/routing/oauth/openai/callback",
			codeVerifier: "verifier-1",
			state: "upstream-1",
		},
	});
	await rejectsCode(
		() =>
			h.service.completeAuthorizationCode(7, "openai", {
				transactionId: started.transactionId,
				state: "upstream-1",
				code: "code",
			}),
		"ROUTING_OAUTH_STATE_INVALID",
	);

	const expired = await h.service.startAuthorizationCode(7, "openai");
	h.advance(10_001);
	await rejectsCode(
		() =>
			h.service.completeAuthorizationCode(7, "openai", {
				transactionId: expired.transactionId,
				state: "upstream-2",
				code: "code",
			}),
		"ROUTING_OAUTH_STATE_INVALID",
	);
});

test("remote topology rejects auth-code without trusted HTTPS public origin", async () => {
	const service = createRoutingOAuthService({
		clientForRuntime: () => harness().service as never,
		now: () => new Date(0),
		randomId: () => "random-state",
		topology: { kind: "remote" },
	});
	await rejectsCode(
		() => service.startAuthorizationCode(7, "openai"),
		"ROUTING_OAUTH_TOPOLOGY_UNSUPPORTED",
	);
});

test("default topology uses the local server callback when CLOUDCLI_PUBLIC_URL is absent", async () => {
	const previousPublicUrl = process.env.CLOUDCLI_PUBLIC_URL;
	const previousServerPort = process.env.SERVER_PORT;
	delete process.env.CLOUDCLI_PUBLIC_URL;
	process.env.SERVER_PORT = "3444";
	try {
		const service = createRoutingOAuthService({
			clientForRuntime: () =>
				({
					startOAuth: (provider: string, redirectUri: string) => ({
						provider,
						authUrl: "https://auth.example.test",
						state: "upstream",
						redirectUri,
						codeVerifier: "verifier",
					}),
				}) as never,
			now: () => new Date(0),
			randomId: () => "transaction",
		});

		const started = await service.startAuthorizationCode(7, "openai");
		assert.equal(
			started.redirectUri,
			"http://127.0.0.1:3444/api/routing/oauth/openai/callback",
		);
	} finally {
		if (previousPublicUrl === undefined) delete process.env.CLOUDCLI_PUBLIC_URL;
		else process.env.CLOUDCLI_PUBLIC_URL = previousPublicUrl;
		if (previousServerPort === undefined) delete process.env.SERVER_PORT;
		else process.env.SERVER_PORT = previousServerPort;
	}
});

test("remote topology accepts only explicit trusted HTTPS public origin", async () => {
	const h = harness();
	const service = createRoutingOAuthService({
		clientForRuntime: () =>
			({
				startOAuth: (provider: string, redirectUri: string) => ({
					provider,
					authUrl: "https://auth.example.test",
					state: "upstream",
					redirectUri,
					codeVerifier: "verifier",
				}),
			}) as never,
		now: () => new Date(0),
		randomId: () => "transaction",
		topology: {
			kind: "remote",
			publicUrl: "https://cloudcli.example.test/root/",
		},
	});
	const started = await service.startAuthorizationCode(7, "openai");
	assert.equal(
		started.redirectUri,
		"https://cloudcli.example.test/api/routing/oauth/openai/callback",
	);
	assert.equal(h.calls.length, 0);
});

test("codex auth-code starts a bounded localhost callback bridge without exposing secrets", async () => {
	const calls: unknown[] = [];
	const service = createRoutingOAuthService({
		clientForRuntime: () =>
			({
				startOAuth: (provider: string, redirectUri: string) => {
					calls.push({ provider, redirectUri });
					return {
						provider,
						authUrl: "https://auth.openai.example/authorize",
						state: "upstream-state",
						redirectUri,
						codeVerifier: "example-verifier",
					};
				},
			}) as never,
		now: () => new Date(0),
		randomId: () => "codex-transaction",
		topology: { kind: "local", serverPort: 3001 },
		codexCallback: { start: async () => "http://localhost:1455/auth/callback" },
	});

	const started = await service.startAuthorizationCode(7, "codex");

	assert.deepEqual(calls, [
		{ provider: "codex", redirectUri: "http://localhost:1455/auth/callback" },
	]);
	assert.equal(started.redirectUri, "http://localhost:1455/auth/callback");
	assert.equal("state" in started, false);
	assert.equal("codeVerifier" in started, false);
});

test("transaction storage enforces max entries by evicting oldest entries", async () => {
	const h = harness();
	const first = await h.service.startDeviceCode(7, "openai");
	const second = await h.service.startDeviceCode(7, "openai");
	const third = await h.service.startDeviceCode(7, "openai");

	await rejectsCode(
		() =>
			h.service.pollDeviceCode(7, "openai", {
				transactionId: first.transactionId,
			}),
		"ROUTING_OAUTH_STATE_INVALID",
	);
	assert.equal(
		(
			await h.service.pollDeviceCode(7, "openai", {
				transactionId: second.transactionId,
			})
		).pending,
		true,
	);
	assert.equal(
		(
			await h.service.pollDeviceCode(7, "openai", {
				transactionId: third.transactionId,
			})
		).account?.id,
		"acct-device",
	);
});

test("transaction storage bounds random ID collision retries", async () => {
	const service = createRoutingOAuthService({
		clientForRuntime: () =>
			({
				startDeviceCode: () => ({
					provider: "openai",
					deviceCode: "d",
					codeVerifier: "v",
					userCode: "u",
					verificationUri: "https://verify.example.test",
					verificationUriComplete: null,
					expiresIn: 10,
					interval: 1,
				}),
			}) as never,
		now: () => new Date(0),
		randomId: () => "same-id",
		topology: { kind: "local", serverPort: 3333 },
		maxEntries: 10,
	});
	await service.startDeviceCode(7, "openai");
	await rejectsCode(
		() => service.startDeviceCode(7, "openai"),
		"ROUTING_OAUTH_CAPACITY_EXCEEDED",
	);
});

test("device-code expiry is capped to transaction TTL", async () => {
	const service = createRoutingOAuthService({
		clientForRuntime: () =>
			({
				startDeviceCode: () => ({
					provider: "openai",
					deviceCode: "d",
					codeVerifier: "v",
					userCode: "u",
					verificationUri: "https://verify.example.test",
					verificationUriComplete: null,
					expiresIn: 9999,
					interval: 1,
				}),
			}) as never,
		now: () => new Date(1_000_000),
		randomId: () => "ttl-id",
		topology: { kind: "local", serverPort: 3333 },
		transactionTtlMs: 5_000,
	});
	const challenge = await service.startDeviceCode(7, "openai");
	assert.equal(challenge.expiresAt, new Date(1_005_000).toISOString());
});

test("device-code poll rejects nonpending result without account", async () => {
	const service = createRoutingOAuthService({
		clientForRuntime: () =>
			({
				startDeviceCode: () => ({
					provider: "openai",
					deviceCode: "d",
					codeVerifier: "v",
					userCode: "u",
					verificationUri: "https://verify.example.test",
					verificationUriComplete: null,
					expiresIn: 10,
					interval: 1,
				}),
				pollDeviceCode: () => ({
					provider: "openai",
					pending: false,
					account: null,
				}),
			}) as never,
		now: () => new Date(0),
		randomId: () => "poll-null",
		topology: { kind: "local", serverPort: 3333 },
	});
	const challenge = await service.startDeviceCode(7, "openai");
	await rejectsCode(
		() =>
			service.pollDeviceCode(7, "openai", {
				transactionId: challenge.transactionId,
			}),
		"ROUTING_OAUTH_POLL_FAILED",
	);
});

test("device-code transaction hides secrets and enforces interval expiry and cancellation", async () => {
	const h = harness();
	const challenge = await h.service.startDeviceCode(7, "openai");
	assert.deepEqual(
		Object.keys(challenge).sort(),
		[
			"expiresAt",
			"interval",
			"provider",
			"transactionId",
			"userCode",
			"verificationUri",
			"verificationUriComplete",
		].sort(),
	);
	assert.equal(challenge.interval, 2);

	const pending = await h.service.pollDeviceCode(7, "openai", {
		transactionId: challenge.transactionId,
	});
	assert.equal(pending.pending, true);
	await rejectsCode(
		() =>
			h.service.pollDeviceCode(7, "openai", {
				transactionId: challenge.transactionId,
			}),
		"ROUTING_OAUTH_POLL_INTERVAL",
	);
	h.advance(2_000);
	const stillSafe = await h.service.pollDeviceCode(7, "openai", {
		transactionId: challenge.transactionId,
	});
	assert.equal(stillSafe.pending, false);
	assert.equal("deviceCode" in stillSafe, false);
	assert.deepEqual(h.calls.at(-1), {
		op: "pollDeviceCode",
		provider: "openai",
		input: {
			deviceCode: "device-1",
			codeVerifier: "device-verifier-1",
			extraData: { secret: "extra-1" },
		},
	});

	const cancelled = await h.service.startDeviceCode(7, "openai");
	await h.service.cancelDeviceCode(7, "openai", {
		transactionId: cancelled.transactionId,
	});
	await rejectsCode(
		() =>
			h.service.pollDeviceCode(7, "openai", {
				transactionId: cancelled.transactionId,
			}),
		"ROUTING_OAUTH_STATE_INVALID",
	);

	const expired = await h.service.startDeviceCode(7, "openai");
	h.advance(31_000);
	await rejectsCode(
		() =>
			h.service.pollDeviceCode(7, "openai", {
				transactionId: expired.transactionId,
			}),
		"ROUTING_OAUTH_STATE_INVALID",
	);
});

test("callback input has strict maximum lengths", async () => {
	const h = harness();
	const started = await h.service.startAuthorizationCode(7, "openai");
	await rejectsCode(
		() =>
			h.service.completeAuthorizationCode(7, "openai", {
				transactionId: started.transactionId,
				state: "x".repeat(513),
				code: "code",
			}),
		"ROUTING_INVALID_REQUEST",
	);
	await rejectsCode(
		() =>
			h.service.completeAuthorizationCode(7, "openai", {
				transactionId: started.transactionId,
				state: "upstream-1",
				code: "x".repeat(4097),
			}),
		"ROUTING_INVALID_REQUEST",
	);
});

test("server returned authorization and verification URLs must be HTTPS or loopback HTTP", async () => {
	const authService = createRoutingOAuthService({
		clientForRuntime: () =>
			({
				startOAuth: () => ({
					provider: "openai",
					authUrl: "http://evil.example.test",
					state: "s",
					redirectUri:
						"http://127.0.0.1:3001/api/routing/oauth/openai/callback",
					codeVerifier: "v",
				}),
			}) as never,
		randomId: () => "t",
		topology: { kind: "local", serverPort: 3001 },
	});
	await rejectsCode(
		() => authService.startAuthorizationCode(7, "openai"),
		"ROUTING_INVALID_UPSTREAM_URL",
	);

	const deviceService = createRoutingOAuthService({
		clientForRuntime: () =>
			({
				startDeviceCode: () => ({
					provider: "openai",
					deviceCode: "d",
					codeVerifier: "v",
					userCode: "u",
					verificationUri: "ftp://verify.example.test",
					verificationUriComplete: null,
					expiresIn: 10,
					interval: 1,
				}),
			}) as never,
		randomId: () => "t",
		topology: { kind: "remote" },
	});
	await rejectsCode(
		() => deviceService.startDeviceCode(7, "openai"),
		"ROUTING_INVALID_UPSTREAM_URL",
	);
});
