import assert from "node:assert/strict";
import test from "node:test";

import { CHAT_MODEL_PROVIDER } from "./providerSelectionState.js";

test("new chat model selection is bound to Codex without a provider choice", () => {
	assert.equal(CHAT_MODEL_PROVIDER, "codex");
});
