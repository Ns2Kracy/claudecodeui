import assert from "node:assert/strict";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import test from "node:test";

import express from "express";

import { createCommandsRouter } from "../commands.routes.js";

/**
 * Stands in for `providerModelsService`. `resolveSessionModel` mirrors the real
 * precedence closely enough for the command handlers: a model recorded for the
 * session wins, otherwise the client's requested model, otherwise the catalog
 * default.
 */
function createModelsService(sessionModels: Record<string, string> = {}) {
	return {
		getProviderModels: async () => ({
			models: {
				OPTIONS: [{ value: "default", label: "Default" }],
				DEFAULT: "default",
			},
			cache: {
				updatedAt: "2026-01-01T00:00:00.000Z",
				expiresAt: "2026-01-02T00:00:00.000Z",
				source: "fresh" as const,
			},
		}),
		getCurrentActiveModel: async () => ({ model: "default" }),
		setSessionModel: () => null,
		resolveSessionModel: async (
			provider: string,
			options: {
				sessionId?: string | null;
				requestedModel?: string | null;
			} = {},
		) => {
			const recorded = options.sessionId
				? sessionModels[options.sessionId]
				: undefined;
			const model = recorded || options.requestedModel || "default";
			return {
				provider,
				sessionId: options.sessionId ?? null,
				model,
				source: model === "default" ? "default" : "session",
			};
		},
		resolveResumeModel: async () => undefined,
		clearCache: () => undefined,
	};
}

async function executeCommand(
	commandName: string,
	context: Record<string, unknown>,
	sessionModels: Record<string, string> = {},
): Promise<Record<string, unknown>> {
	const router = createCommandsRouter({
		fileSystem: {
			readFile: async () =>
				JSON.stringify({ name: "claude-code-ui", version: "0.0.0-test" }),
		} as unknown as typeof import("node:fs/promises"),
		homeDirectory: () => "/home/test",
		appRoot: "/app",
		models: createModelsService(sessionModels) as never,
		runtime: {
			uptime: () => 0,
			memoryUsage: () => ({
				rss: 0,
				heapTotal: 0,
				heapUsed: 0,
				external: 0,
				arrayBuffers: 0,
			}),
			version: "v22",
			platform: "linux",
			pid: 1,
		},
	});
	const app = express().use(express.json()).use("/api/commands", router);
	const server = app.listen(0, "127.0.0.1");
	await once(server, "listening");
	try {
		const address = server.address() as AddressInfo;
		const response = await fetch(
			`http://127.0.0.1:${address.port}/api/commands/execute`,
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ commandName, context }),
			},
		);
		assert.equal(response.status, 200);
		return (await response.json()) as Record<string, unknown>;
	} finally {
		await new Promise<void>((resolve) => server.close(() => resolve()));
	}
}

test("models command returns models only for the active provider using injected catalog", async () => {
	const result = await executeCommand("/models", { provider: "codex" });
	const data = result.data as Record<string, unknown>;
	assert.deepEqual(Object.keys(data.available as object), ["codex"]);
});

test("models command normalizes every provider value to codex", async () => {
	for (const provider of ["claude", "cursor", "opencode", "unknown-provider"]) {
		const result = await executeCommand("/models", { provider });
		const data = result.data as {
			current: { provider: string; providerLabel: string };
		};
		assert.equal(data.current.provider, "codex");
		assert.equal(data.current.providerLabel, "Codex");
	}
});

test("models command reports the model recorded for the session", async () => {
	const result = await executeCommand(
		"/models",
		{ provider: "codex", sessionId: "session-1", model: "gpt-5" },
		{ "session-1": "gpt-5-mini" },
	);

	const data = result.data as { current: { model: string } };
	assert.equal(data.current.model, "gpt-5-mini");
});

test("models command reports the composer model for a chat with no session yet", async () => {
	const result = await executeCommand("/models", {
		provider: "codex",
		model: "gpt-5-mini",
	});

	const data = result.data as { current: { model: string } };
	assert.equal(data.current.model, "gpt-5-mini");
});

test("cost and status commands report the same resolved model as /models", async () => {
	const context = { provider: "codex", sessionId: "session-1", model: "gpt-5" };
	const sessionModels = { "session-1": "gpt-5-mini" };

	const cost = await executeCommand("/cost", context, sessionModels);
	const status = await executeCommand("/status", context, sessionModels);

	assert.equal((cost.data as { model: string }).model, "gpt-5-mini");
	assert.equal((status.data as { model: string }).model, "gpt-5-mini");
});

test("help and memory describe Codex instruction files", async () => {
	const help = await executeCommand("/help", {});
	const helpContent = (help.data as { content: string }).content;
	assert.match(helpContent, /Codex Commands/);
	assert.match(helpContent, /\.codex\/commands/);
	assert.doesNotMatch(helpContent, /Claude|CLAUDE\.md|\.claude\/commands/);

	const memory = await executeCommand("/memory", {
		projectPath: "/workspace/project",
	});
	const memoryData = memory.data as { path: string; message: string };
	assert.equal(memoryData.path, "/workspace/project/AGENTS.md");
	assert.match(memoryData.message, /AGENTS\.md/);
});
