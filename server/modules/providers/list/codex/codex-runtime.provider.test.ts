import assert from "node:assert/strict";
import test from "node:test";

import type { Codex, ThreadEvent } from "@openai/codex-sdk";

import { createCodexVisibleEventBuffer } from "./codex-visible-event-buffer.provider.js";
import { createCodexClientForRouting } from "./codex-runtime.provider.js";

class FakeCodex {
	static constructorCalls: unknown[][] = [];

	constructor(...args: unknown[]) {
		FakeCodex.constructorCalls.push(args);
	}
}

const FakeCodexConstructor = FakeCodex as unknown as typeof Codex;

const completed: ThreadEvent = {
	type: "turn.completed",
	usage: {
		input_tokens: 0,
		cache_write_input_tokens: 0,
		cached_input_tokens: 0,
		output_tokens: 0,
		reasoning_output_tokens: 0,
	},
};

test("Codex live output publishes only the final agent message", () => {
	const buffer = createCodexVisibleEventBuffer();
	const commentary: ThreadEvent = {
		type: "item.completed",
		item: {
			id: "commentary-1",
			type: "agent_message",
			text: "I will inspect the files first.",
		},
	};
	const reasoning: ThreadEvent = {
		type: "item.completed",
		item: {
			id: "reasoning-1",
			type: "reasoning",
			text: "Inspecting the relevant files",
		},
	};
	const finalAnswer: ThreadEvent = {
		type: "item.completed",
		item: {
			id: "final-1",
			type: "agent_message",
			text: "Fixed the duplicate output.",
		},
	};
	assert.deepEqual(buffer.push(commentary), []);
	assert.deepEqual(buffer.push(reasoning), [reasoning]);
	assert.deepEqual(buffer.push(finalAnswer), []);
	assert.deepEqual(buffer.push(completed), [finalAnswer, completed]);
});

test("Codex live output drops pending commentary when a turn fails", () => {
	const buffer = createCodexVisibleEventBuffer();
	const commentary: ThreadEvent = {
		type: "item.completed",
		item: { id: "commentary-1", type: "agent_message", text: "Still working." },
	};
	const failed: ThreadEvent = {
		type: "turn.failed",
		error: { message: "Provider failed" },
	};

	assert.deepEqual(buffer.push(commentary), []);
	assert.deepEqual(buffer.push(failed), [failed]);
	assert.deepEqual(buffer.push(completed), [completed]);
});

test("Codex live output completes cleanly without an agent message", () => {
	const buffer = createCodexVisibleEventBuffer();

	assert.deepEqual(buffer.push(completed), [completed]);
});

test("Codex runtime rejects native dispatch before constructing the SDK", () => {
	FakeCodex.constructorCalls = [];

	assert.throws(
		() => createCodexClientForRouting({ source: "native" }, FakeCodexConstructor),
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
