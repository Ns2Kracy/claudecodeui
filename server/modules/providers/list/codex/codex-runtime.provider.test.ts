import assert from "node:assert/strict";
import test from "node:test";

import type { Codex } from "@openai/codex-sdk";

import { createCodexClientForRouting } from "./codex-runtime.provider.js";

class FakeCodex {
	static constructorCalls: unknown[][] = [];

	constructor(...args: unknown[]) {
		FakeCodex.constructorCalls.push(args);
	}
}

const FakeCodexConstructor = FakeCodex as unknown as typeof Codex;

test("Codex runtime rejects native dispatch before constructing the SDK", () => {
	FakeCodex.constructorCalls = [];

	assert.throws(
		() =>
			createCodexClientForRouting({ source: "native" }, FakeCodexConstructor),
		Error,
	);
	assert.deepEqual(FakeCodex.constructorCalls, []);
});

test("Codex runtime rejects incomplete routed credentials", () => {
	FakeCodex.constructorCalls = [];
	assert.throws(
		() =>
			createCodexClientForRouting(
				{
					source: "9router",
					baseUrl: "https://router.example/api",
					openAiBaseUrl: "",
					apiKey: "",
					routeName: "",
				},
				FakeCodexConstructor,
			),
		Error,
	);
	assert.deepEqual(FakeCodex.constructorCalls, []);
});

test("routed Codex runtime constructs one isolated SDK client and route model", () => {
	FakeCodex.constructorCalls = [];

	const result = createCodexClientForRouting(
		{
			source: "9router",
			baseUrl: "https://router.example",
			openAiBaseUrl: "https://router.example/v1",
			apiKey: "router-runtime-key",
			routeId: "route-1",
			routeName: "quality-first",
		},
		FakeCodexConstructor,
	);

	assert.ok((result.client as unknown) instanceof FakeCodex);
	assert.equal(result.model, "quality-first");
	assert.equal(FakeCodex.constructorCalls.length, 1);
	const clientOptions = FakeCodex.constructorCalls[0]?.[0] as {
		baseUrl?: unknown;
		apiKey?: unknown;
		env?: NodeJS.ProcessEnv;
	};
	assert.equal(clientOptions.baseUrl, "https://router.example/v1");
	assert.equal(clientOptions.apiKey, "router-runtime-key");
	assert.notEqual(clientOptions.env, process.env);
	assert.equal(clientOptions.env?.PATH, process.env.PATH);
});
