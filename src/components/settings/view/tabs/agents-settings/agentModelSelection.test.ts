import assert from "node:assert/strict";
import test from "node:test";

import { selectConfiguredAgentModel } from "./agentModelSelection.js";

const models = [
	{ id: "openai/gpt-5", provider: "openai", name: "GPT-5" },
	{ id: "deepseek/deepseek-chat", provider: "deepseek", name: "DeepSeek Chat" },
];

test("agent configuration selects the first available model when none was chosen", () => {
	assert.equal(selectConfiguredAgentModel(null, models), "openai/gpt-5");
	assert.equal(selectConfiguredAgentModel("   ", models), "openai/gpt-5");
});

test("agent configuration preserves an existing model choice", () => {
	assert.equal(
		selectConfiguredAgentModel(" deepseek/deepseek-chat ", models),
		"deepseek/deepseek-chat",
	);
});

test("agent configuration remains blank until models are available", () => {
	assert.equal(selectConfiguredAgentModel(null, []), "");
});
