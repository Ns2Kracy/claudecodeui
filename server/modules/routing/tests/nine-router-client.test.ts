import assert from "node:assert/strict";
import { once } from "node:events";
import {
	createServer,
	type IncomingMessage,
	type ServerResponse,
} from "node:http";
import test from "node:test";

import { AppError } from "@/shared/utils.js";

import { NineRouterClient } from "../nine-router-client.js";
import { requestNineRouterJson } from "../nine-router-http.js";

type FakeRouterOptions = {
	version?: unknown;
	versionStatus?: number;
	password?: string;
	dataPlaneKey?: string;
	authMode?: "password" | "oidc";
};

type FakeRouterState = {
	loginCount: number;
	accountListCount: number;
	rejectNextAccountList: boolean;
	probePaths: string[];
	receivedBodies: Array<{ path: string; body: unknown }>;
	invalidPollPending?: boolean;
};

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
	const chunks: Buffer[] = [];
	for await (const chunk of request) {
		chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
	}
	try {
		return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
	} catch {
		return undefined;
	}
}

function sendJson(
	response: ServerResponse,
	statusCode: number,
	body: unknown,
): void {
	response.writeHead(statusCode, { "content-type": "application/json" });
	response.end(JSON.stringify(body));
}

function hasValidCookie(
	request: IncomingMessage,
	state: FakeRouterState,
): boolean {
	return request.headers.cookie === `auth_token=session-${state.loginCount}`;
}

async function withFakeRouter(
	options: FakeRouterOptions,
	runTest: (input: {
		baseUrl: string;
		request: typeof requestNineRouterJson;
		state: FakeRouterState;
	}) => Promise<void>,
): Promise<void> {
	const expectedPassword = options.password ?? "admin-password";
	const expectedDataPlaneKey = options.dataPlaneKey ?? "data-plane-key";
	const accounts = [
		{
			id: "account-1",
			provider: "openai",
			name: "Primary",
			authType: "apikey",
			priority: 1,
			isActive: true,
			testStatus: "active",
			expiresAt: null,
			apiKey: "planted-upstream-key",
			accessToken: "planted-access-token",
			refreshToken: "planted-refresh-token",
			idToken: "planted-id-token",
			cookie: "planted-cookie",
			providerSpecificData: { rawSecret: "planted-provider-secret" },
		},
	];
	const state: FakeRouterState = {
		loginCount: 0,
		accountListCount: 0,
		rejectNextAccountList: false,
		probePaths: [],
		receivedBodies: [],
	};

	const server = createServer((request, response) => {
		void (async () => {
			const requestUrl = new URL(request.url ?? "/", "http://router.test");
			const path = requestUrl.pathname;

			if (request.method === "GET" && path === "/api/health") {
				state.probePaths.push(path);
				sendJson(response, 200, { ok: true });
				return;
			}
			if (request.method === "GET" && path === "/api/version") {
				state.probePaths.push(path);
				sendJson(response, options.versionStatus ?? 200, {
					currentVersion: options.version ?? "0.5.45",
				});
				return;
			}
			if (request.method === "GET" && path === "/api/auth/status") {
				sendJson(response, 200, {
					requireLogin: true,
					authMode: options.authMode ?? "password",
				});
				return;
			}
			if (request.method === "POST" && path === "/api/auth/login") {
				const body = (await readJsonBody(request)) as { password?: unknown };
				if (body.password !== expectedPassword || options.authMode === "oidc") {
					sendJson(response, 401, {
						error: `invalid ${String(body.password)}`,
					});
					return;
				}
				state.loginCount += 1;
				response.setHeader("set-cookie", [
					`auth_token=session-${state.loginCount}; Path=/; HttpOnly; SameSite=Lax`,
				]);
				sendJson(response, 200, { success: true });
				return;
			}
			if (request.method === "GET" && path === "/v1/models") {
				if (
					request.headers.authorization !== `Bearer ${expectedDataPlaneKey}`
				) {
					sendJson(response, 401, {
						error: `invalid key ${request.headers.authorization}`,
					});
					return;
				}
				sendJson(response, 200, {
					object: "list",
					data: [{ id: "quality-first", object: "model" }],
				});
				return;
			}

			if (!hasValidCookie(request, state)) {
				sendJson(response, 401, {
					error: `invalid cookie ${request.headers.cookie}`,
				});
				return;
			}

			if (request.method === "GET" && path === "/api/providers") {
				state.accountListCount += 1;
				if (state.rejectNextAccountList) {
					state.rejectNextAccountList = false;
					sendJson(response, 401, { error: "expired cookie" });
					return;
				}
				sendJson(response, 200, { connections: accounts });
				return;
			}
			if (request.method === "POST" && path === "/api/providers") {
				const body = await readJsonBody(request);
				state.receivedBodies.push({ path, body });
				const record = body as Record<string, unknown>;
				const connection = {
					id: `account-${accounts.length + 1}`,
					provider: record.provider,
					name: record.name,
					authType: "apikey",
					priority: record.priority ?? 1,
					isActive: true,
					testStatus: "unknown",
				};
				accounts.push(connection as (typeof accounts)[number]);
				sendJson(response, 201, { connection });
				return;
			}
			const accountMatch = path.match(/^\/api\/providers\/([^/]+)$/);

			if (accountMatch && request.method === "GET") {
				sendJson(response, 200, {
					connection: { ...accounts[0], accessToken: "hidden-token" },
				});
				return;
			}
			if (
				path.match(/^\/api\/providers\/[^/]+\/models$/) &&
				request.method === "GET"
			) {
				sendJson(response, 200, {
					provider: "openai",
					connectionId: "account-1",
					models: [
						{
							provider: "openai",
							id: "gpt-4o",
							apiKey: "hidden",
						},
					],
				});
				return;
			}
			if (accountMatch && request.method === "PUT") {
				const body = await readJsonBody(request);
				state.receivedBodies.push({ path, body });
				sendJson(response, 200, {
					connection: {
						...accounts[0],
						...(body as object),
						apiKey: "response-secret",
					},
				});
				return;
			}
			if (accountMatch && request.method === "DELETE") {
				sendJson(response, 200, { message: "Connection deleted successfully" });
				return;
			}
			if (
				path.match(/^\/api\/providers\/[^/]+\/test$/) &&
				request.method === "POST"
			) {
				sendJson(response, 200, { valid: true, error: null, refreshed: false });
				return;
			}

			if (request.method === "GET" && path === "/api/provider-nodes") {
				sendJson(response, 200, {
					nodes: [
						{
							id: "node-1",
							type: "openai-compatible",
							name: "Node",
							prefix: "openai",
							baseUrl: "https://node.test",
							apiType: "chat",
							apiKey: "hidden",
						},
					],
				});
				return;
			}
			if (request.method === "POST" && path === "/api/provider-nodes") {
				const body = await readJsonBody(request);
				state.receivedBodies.push({ path, body });
				sendJson(response, 201, {
					node: { id: "node-2", ...(body as object) },
				});
				return;
			}
			if (
				request.method === "POST" &&
				path === "/api/provider-nodes/validate"
			) {
				const body = await readJsonBody(request);
				state.receivedBodies.push({ path, body });
				sendJson(response, 200, { valid: true, error: "hidden detail" });
				return;
			}
			if (request.method === "POST" && path === "/api/oauth/openai/poll") {
				sendJson(response, 200, {
					pending: state.invalidPollPending ? "false" : true,
					connection: null,
				});
				return;
			}
			const nodeMatch = path.match(/^\/api\/provider-nodes\/([^/]+)$/);
			if (nodeMatch && request.method === "PUT") {
				const body = await readJsonBody(request);
				state.receivedBodies.push({ path, body });
				sendJson(response, 200, {
					node: {
						id: decodeURIComponent(nodeMatch[1]),
						type: "openai-compatible",
						name: "Node",
						prefix: "openai",
						baseUrl: "https://node.test",
						apiType: "responses",
						...(body as object),
						apiKey: "hidden",
					},
				});
				return;
			}
			if (nodeMatch && request.method === "DELETE") {
				sendJson(response, 200, { success: true });
				return;
			}

			sendJson(response, 404, { error: "Not found" });
		})().catch((error: unknown) => {
			sendJson(response, 500, {
				error: error instanceof Error ? error.message : "test error",
			});
		});
	});

	server.listen(0, "127.0.0.1");
	await once(server, "listening");
	const address = server.address();
	assert.ok(address && typeof address === "object");
	const baseUrl = `http://router.test:${address.port}`;
	const localRequest: typeof requestNineRouterJson = (
		input,
		dependencies = {},
	) =>
		requestNineRouterJson(input, {
			...dependencies,
			targetPolicy: {
				allowLoopbackHttp: true,
				lookup: async () => [{ address: "127.0.0.1", family: 4 }],
			},
		});

	try {
		await runTest({ baseUrl, request: localRequest, state });
	} finally {
		server.closeAllConnections();
		await new Promise<void>((resolve, reject) => {
			server.close((error) => (error ? reject(error) : resolve()));
		});
	}
}

function assertClientError(
	run: () => Promise<unknown>,
	code: string,
	forbidden?: string,
) {
	return assert.rejects(run, (error: unknown) => {
		assert.ok(error instanceof AppError);
		assert.equal(error.code, code);
		if (forbidden) {
			assert.equal(error.message.includes(forbidden), false);
		}
		return true;
	});
}

test("validates the pinned version, management login, and data-plane key", async () => {
	await withFakeRouter({}, async ({ baseUrl, request, state }) => {
		const client = new NineRouterClient({
			baseUrl,
			adminPassword: "admin-password",
			dataPlaneKey: "data-plane-key",
			request,
		});

		const validation = await client.validateConnection();
		assert.equal(validation.version, "0.5.50");
		assert.equal(validation.knownVersion, true);
		assert.equal(validation.capabilities.writeRoutes, true);
		assert.equal(validation.capabilities.cursorRuntime, false);
		assert.equal(state.loginCount, 1);
		assert.deepEqual(state.probePaths, []);

		await client.listAccounts();
		assert.equal(state.loginCount, 1);
	});
});

test("lists accounts when the version endpoint fails but real APIs work", async () => {
	await withFakeRouter({ versionStatus: 500 }, async ({ baseUrl, request }) => {
		const client = new NineRouterClient({
			baseUrl,
			adminPassword: "admin-password",
			dataPlaneKey: "data-plane-key",
			request,
		});

		const accounts = await client.listAccounts();

		assert.equal(accounts.length, 1);
		assert.equal(accounts[0]?.id, "account-1");
	});
});

test("maps accounts and models into secret-free DTOs", async () => {
	await withFakeRouter({}, async ({ baseUrl, request }) => {
		const client = new NineRouterClient({
			baseUrl,
			adminPassword: "admin-password",
			dataPlaneKey: "data-plane-key",
			request,
		});
		await client.validateConnection();

		const accounts = await client.listAccounts();
		const models = await client.listModels();

		assert.deepEqual(accounts, [
			{
				id: "account-1",
				provider: "openai",
				name: "Primary",
				authType: "apikey",
				priority: 1,
				active: true,
				status: "healthy",
				lastError: null,
				expiresAt: null,
			},
		]);
		assert.deepEqual(models, [
			{ id: "openai/gpt-4o", provider: "openai", name: "gpt-4o" },
		]);
	});
});

test("refreshes an expired management cookie once for GET operations", async () => {
	await withFakeRouter({}, async ({ baseUrl, request, state }) => {
		const client = new NineRouterClient({
			baseUrl,
			adminPassword: "admin-password",
			dataPlaneKey: "data-plane-key",
			request,
		});
		await client.validateConnection();
		state.rejectNextAccountList = true;

		const accounts = await client.listAccounts();
		assert.equal(accounts.length, 1);
		assert.equal(state.accountListCount, 2);
		assert.equal(state.loginCount, 2);
	});
});

test("maps invalid passwords and data-plane keys to redacted errors", async () => {
	await withFakeRouter({}, async ({ baseUrl, request }) => {
		const badPassword = "wrong-admin-password";
		const client = new NineRouterClient({
			baseUrl,
			adminPassword: badPassword,
			dataPlaneKey: "data-plane-key",
			request,
		});
		await assertClientError(
			() => client.validateConnection(),
			"ROUTING_AUTH_FAILED",
			badPassword,
		);
	});

	await withFakeRouter({}, async ({ baseUrl, request }) => {
		const badKey = "wrong-data-plane-key";
		const client = new NineRouterClient({
			baseUrl,
			adminPassword: "admin-password",
			dataPlaneKey: badKey,
			request,
		});
		await assertClientError(
			() => client.validateConnection(),
			"ROUTING_API_KEY_REJECTED",
			badKey,
		);
	});
});

test("uses packaged capabilities without probing a reported Router version", async () => {
	await withFakeRouter({ version: 545 }, async ({ baseUrl, request }) => {
		const client = new NineRouterClient({
			baseUrl,
			adminPassword: "admin-password",
			dataPlaneKey: "data-plane-key",
			request,
		});

		const validation = await client.validateConnection();
		const accounts = await client.listAccounts();

		assert.equal(validation.version, "0.5.50");
		assert.equal(validation.knownVersion, true);
		assert.equal(validation.capabilities.writeRoutes, true);
		assert.equal(accounts.length, 1);
	});
});

test("sends only pinned write fields and returns sanitized mutation results", async () => {
	await withFakeRouter({}, async ({ baseUrl, request, state }) => {
		const client = new NineRouterClient({
			baseUrl,
			adminPassword: "admin-password",
			dataPlaneKey: "data-plane-key",
			request,
		});
		await client.validateConnection();

		const created = await client.createApiKeyAccount({
			provider: "openai",
			name: "Secondary",
			apiKey: "account-input-key",
			priority: 2,
		});
		const updated = await client.updateAccount("account-1", {
			name: "Renamed",
			apiKey: "replacement-key",
			priority: 3,
			active: false,
		});
		const tested = await client.testAccount("account-1");
		await client.deleteAccount("account-1");

		assert.equal(JSON.stringify(created).includes("account-input-key"), false);
		assert.equal(JSON.stringify(updated).includes("replacement-key"), false);
		assert.deepEqual(tested, { healthy: true, error: null, refreshed: false });
		assert.deepEqual(state.receivedBodies, [
			{
				path: "/api/providers",
				body: {
					provider: "openai",
					name: "Secondary",
					apiKey: "account-input-key",
					priority: 2,
				},
			},
			{
				path: "/api/providers/account-1",
				body: {
					name: "Renamed",
					apiKey: "replacement-key",
					priority: 3,
					isActive: false,
				},
			},
		]);
	});
});

test("maps provider detail, provider models, and provider nodes into safe DTOs", async () => {
	await withFakeRouter({}, async ({ baseUrl, request, state }) => {
		const client = new NineRouterClient({
			baseUrl,
			adminPassword: "admin-password",
			dataPlaneKey: "data-plane-key",
			request,
		});
		assert.equal((await client.getProvider("account/1")).id, "account-1");
		assert.equal(
			(await client.listProviderModels("account/1")).models[0].id,
			"openai/gpt-4o",
		);
		assert.equal(
			(await client.listProviderNodes())[0].baseUrl,
			"https://node.test",
		);
		assert.equal(
			(
				await client.createProviderNode({
					name: "Node",
					prefix: "openai",
					type: "openai-compatible",
					apiType: "chat",
					baseUrl: "https://node.test",
				})
			).id,
			"node-2",
		);
		assert.equal(
			(
				await client.validateProviderNode({
					baseUrl: "https://node.test",
					apiKey: "secret",
					type: "custom-embedding",
					modelId: "embed-1",
				})
			).message,
			null,
		);
		assert.equal(
			(
				await client.updateProviderNode("node/1", {
					name: "Node 2",
					prefix: "openai",
					baseUrl: "https://node.test",
					apiType: "responses",
				})
			).id,
			"node/1",
		);
		await client.deleteProviderNode("node/1");
		assert.deepEqual(
			state.receivedBodies
				.filter((item) => item.path.includes("provider-nodes"))
				.map((item) => item.body),
			[
				{
					name: "Node",
					prefix: "openai",
					type: "openai-compatible",
					baseUrl: "https://node.test",
					apiType: "chat",
				},
				{
					baseUrl: "https://node.test",
					type: "custom-embedding",
					apiKey: "secret",
					modelId: "embed-1",
				},
				{
					name: "Node 2",
					prefix: "openai",
					baseUrl: "https://node.test",
					apiType: "responses",
				},
			],
		);
	});
});

test("returns safe Router provider validation failures even with non-success HTTP status", async () => {
	const scenarios = [
		{
			statusCode: 400,
			data: { error: "URL not allowed" },
			expected: "URL not allowed",
		},
		{
			statusCode: 500,
			data: { error: "DNS lookup failed - invalid domain or network issue" },
			expected: "DNS lookup failed - invalid domain or network issue",
		},
		{
			statusCode: 500,
			data: {
				error: "upstream leaked sk-secret at https://private.example",
			},
			expected: "The upstream provider validation failed",
		},
	] as const;

	for (const scenario of scenarios) {
		const client = new NineRouterClient({
			baseUrl: "https://router.example",
			adminPassword: "admin-password",
			dataPlaneKey: "data-plane-key",
			request: async (input) => {
				if (input.operation === "authStatus") {
					return {
						statusCode: 200,
						headers: {},
						data: { requireLogin: false, authMode: "password" },
					};
				}
				assert.equal(input.operation, "providerNodeValidate");
				return {
					statusCode: scenario.statusCode,
					headers: {},
					data: scenario.data,
				};
			},
		});

		assert.deepEqual(
			await client.validateProviderNode({
				baseUrl: "https://provider.example/v1",
				apiKey: "never-display-this-key",
				type: "openai-compatible",
			}),
			{ valid: false, message: scenario.expected },
		);
	}
});

test("does not treat authentication failures as provider validation results", async () => {
	const client = new NineRouterClient({
		baseUrl: "https://router.example",
		adminPassword: "admin-password",
		dataPlaneKey: "data-plane-key",
		request: async (input) => {
			if (input.operation === "authStatus") {
				return {
					statusCode: 200,
					headers: {},
					data: { requireLogin: false, authMode: "password" },
				};
			}
			return {
				statusCode: 403,
				headers: {},
				data: { valid: false, error: "API key unauthorized" },
			};
		},
	});

	await assert.rejects(
		client.validateProviderNode({
			baseUrl: "https://provider.example/v1",
			apiKey: "never-display-this-key",
			type: "openai-compatible",
		}),
		(error: unknown) =>
			error instanceof AppError &&
			error.code === "ROUTING_AUTH_FAILED" &&
			error.message === "Router authentication failed",
	);
});

test("does not treat non-validation error envelopes as validation results", async () => {
	const client = new NineRouterClient({
		baseUrl: "https://router.example",
		adminPassword: "admin-password",
		dataPlaneKey: "data-plane-key",
		request: async (input) => {
			if (input.operation === "authStatus") {
				return {
					statusCode: 200,
					headers: {},
					data: { requireLogin: false, authMode: "password" },
				};
			}
			return {
				statusCode: 500,
				headers: {},
				data: { error: "URL not allowed" },
			};
		},
	});

	await assert.rejects(
		client.createProviderNode({
			name: "Provider",
			prefix: "provider",
			type: "openai-compatible",
			apiType: "chat",
			baseUrl: "https://provider.example/v1",
		}),
		(error: unknown) =>
			error instanceof AppError &&
			error.code === "ROUTING_OPERATION_FAILED" &&
			error.message === "The Router operation failed",
	);
});

test("maps current OpenAI-compatible provider model rows using the envelope provider", async () => {
	await withFakeRouter({}, async ({ baseUrl, request }) => {
		const client = new NineRouterClient({
			baseUrl,
			adminPassword: "admin-password",
			dataPlaneKey: "data-plane-key",
			request: async (input, dependencies) => {
				if (input.operation === "providerModels") {
					return {
						statusCode: 200,
						headers: {},
						data: {
							provider: "deepseek",
							connectionId: "account-1",
							models: [
								{
									id: "deepseek/deepseek-v4-pro",
									object: "model",
									owned_by: "deepseek",
								},
							],
						},
					};
				}
				return request(input, dependencies);
			},
		});

		assert.deepEqual(await client.listProviderModels("account-1"), {
			provider: "deepseek",
			connectionId: "account-1",
			models: [
				{
					id: "deepseek/deepseek-v4-pro",
					provider: "deepseek",
					name: "deepseek/deepseek-v4-pro",
				},
			],
		});
	});
});

test("rejects provider models without an authoritative upstream id", async () => {
	await withFakeRouter({}, async ({ baseUrl, request }) => {
		const client = new NineRouterClient({
			baseUrl,
			adminPassword: "admin-password",
			dataPlaneKey: "data-plane-key",
			request: async (input, dependencies) => {
				if (input.operation === "providerModels") {
					return {
						statusCode: 200,
						headers: {},
						data: {
							provider: "openai",
							connectionId: "account-1",
							models: [{ provider: "openai", model: "gpt-4o" }],
						},
					};
				}
				return request(input, dependencies);
			},
		});

		await assertClientError(
			() => client.listProviderModels("account-1"),
			"ROUTING_UPSTREAM_RESPONSE_INVALID",
		);
	});
});

test("rejects invalid upstream pending states instead of coercing", async () => {
	await withFakeRouter({}, async ({ baseUrl, request, state }) => {
		const client = new NineRouterClient({
			baseUrl,
			adminPassword: "admin-password",
			dataPlaneKey: "data-plane-key",
			request,
		});
		state.invalidPollPending = true;
		await assertClientError(
			() =>
				client.pollDeviceCode("openai", { deviceCode: "d", codeVerifier: "v" }),
			"ROUTING_UPSTREAM_RESPONSE_INVALID",
		);
	});
});
