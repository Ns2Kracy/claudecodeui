import assert from "node:assert/strict";
import test from "node:test";

import {
	ACTIVE_PROVIDERS,
	initialCodexModel,
	normalizeActiveProvider,
	resolveCatalogModel,
	readProviderModelsApiData,
	withUnavailableSelectedModel,
} from "./useChatProviderState.js";

test("active chat provider is always Codex, including after legacy stored selections", () => {
	assert.deepEqual(ACTIVE_PROVIDERS, ["codex"]);
	assert.equal(normalizeActiveProvider(null), "codex");
	assert.equal(normalizeActiveProvider("claude"), "codex");
	assert.equal(normalizeActiveProvider("cursor"), "codex");
	assert.equal(normalizeActiveProvider("opencode"), "codex");
	assert.equal(normalizeActiveProvider("codex"), "codex");
});

test("provider model response parsing preserves 9router source metadata as model metadata only", () => {
	const data = readProviderModelsApiData({
		success: true,
		data: {
			models: {
				DEFAULT: "claude-sonnet-4-5",
				OPTIONS: [
					{
						value: "claude-sonnet-4-5",
						label: "Claude Sonnet",
						source: "native",
					},
					{
						value: "9router:anthropic/claude-opus",
						label: "Anthropic · Claude Opus",
						source: "9router",
					},
				],
			},
			cache: {
				updatedAt: "2026-08-05T00:00:00.000Z",
				expiresAt: "2026-08-08T00:00:00.000Z",
				source: "fresh",
			},
		},
	});

	assert.ok(data?.models);
	assert.deepEqual(data.models.OPTIONS, [
		{ value: "claude-sonnet-4-5", label: "Claude Sonnet", source: "native" },
		{
			value: "9router:anthropic/claude-opus",
			label: "Anthropic · Claude Opus",
			source: "9router",
		},
	]);
});

test("does not invent an unavailable option before the first catalog loads", () => {
	assert.deepEqual(withUnavailableSelectedModel([], "gpt-5.4", false), []);
});

test("starts without a model when storage contains a legacy bare id", () => {
	assert.equal(initialCodexModel("gpt-5.4"), "");
	assert.equal(initialCodexModel("codex/gpt-5.4"), "codex/gpt-5.4");
});

test("qualifies a legacy bare session model when the catalog match is unique", () => {
	const options = [
		{ value: "codex/gpt-5.4", label: "GPT 5.4", source: "9router" as const },
	];
	assert.equal(resolveCatalogModel(options, "gpt-5.4"), "codex/gpt-5.4");
	assert.equal(
		resolveCatalogModel(
			[...options, { value: "cx/gpt-5.4", label: "GPT 5.4", source: "9router" }],
			"gpt-5.4",
		),
		"gpt-5.4",
	);
});

test("preserves a disappeared routed session model by its exact upstream ID", () => {
	const options = [
		{ value: "cx/gpt-5.4", label: "GPT 5.4", source: "9router" as const },
	];

	assert.deepEqual(
		withUnavailableSelectedModel(options, "deepseek/deepseek-v3"),
		[
			...options,
			{
				value: "deepseek/deepseek-v3",
				label: "deepseek/deepseek-v3 (Provider unavailable)",
				source: "9router",
			},
		],
	);
	assert.strictEqual(
		withUnavailableSelectedModel(options, "cx/gpt-5.4"),
		options,
	);
});
